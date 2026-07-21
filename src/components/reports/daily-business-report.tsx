"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CalendarDays, ChevronRight, RefreshCw, Send, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatDailyPriority,
  formatDailyRisk,
  formatDailyTodo,
} from "./daily-business-report-labels";

type ReportItem = {
  code: string;
  priority?: string;
  severity?: string;
  count: number;
  href: string;
  oldestAt?: string | null;
  samples: { id: string; label: string; at: string | null }[];
};

type DailyBusinessReport = {
  reportDate: string;
  timezone: "Asia/Shanghai";
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  sales: {
    confirmedOrderCount: number;
    confirmedItemCount: number;
    grossSalesAmount: string;
    expectedIncomeAmount: string;
    actualReceivedAmount: string;
    actualRefundAmount: string;
    netReceivedAmount: string;
    originalProfitAmount: string;
    afterSaleNetProfitAmount: string;
  };
  purchases: {
    createdOrderCount: number;
    arrivedOrderCount: number;
    inspectedItemCount: number;
    createdInventoryItemCount: number;
    purchaseRefundAmount: string;
  };
  inventory: {
    stockedCount: number;
    stockedAssetCost: string;
    platformProcessingCount: number;
    platformReturningCount: number;
    platformReturnedPendingCount: number;
    pendingDecisionCount: number;
    problemCount: number;
    problemAssetCost: string;
    totalUnsoldAssetCount: number;
    totalUnsoldAssetCost: string;
  };
  inventoryExpiry: {
    businessDate: string;
    counts: Record<"EXPIRED" | "WITHIN_30_DAYS" | "WITHIN_90_DAYS" | "WITHIN_180_DAYS", number>;
    samples: { id: string; name: string; skuText: string | null; displayStorageLocation: string; expiryDate: string | null; risk: "EXPIRED" | "WITHIN_30_DAYS" | "WITHIN_90_DAYS" | "WITHIN_180_DAYS" }[];
  };
  todos: { items: ReportItem[]; totalCount: number; priorityCounts: Record<string, number> };
  risks: { items: ReportItem[]; totalCount: number; severityCounts: Record<string, number> };
  market: {
    activeMarketItemCount: number;
    withCurrentExpectedIncomeCount: number;
    withoutCurrentExpectedIncomeCount: number;
    quotesCreatedInPeriodCount: number;
    quotesConfirmedInPeriodCount: number;
    expiringQuoteCount: number;
    expiredQuoteCount: number;
  };
};

type DeliveryStatus = {
  status: "NOT_SENT" | "PENDING" | "SENDING" | "SENT" | "FAILED";
  attemptCount: number;
  requestedAt: string | null;
  startedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  retryable: boolean;
  nextAction: "SEND" | "RETRY" | "NONE";
};

const salesMetrics: { label: string; key: keyof DailyBusinessReport["sales"]; kind: "money" | "count" }[] = [
  { label: "确认销售订单", key: "confirmedOrderCount", kind: "count" },
  { label: "销售商品件数", key: "confirmedItemCount", kind: "count" },
  { label: "销售总额", key: "grossSalesAmount", kind: "money" },
  { label: "预计收入", key: "expectedIncomeAmount", kind: "money" },
  { label: "实际到账", key: "actualReceivedAmount", kind: "money" },
  { label: "实际退款", key: "actualRefundAmount", kind: "money" },
  { label: "净到账", key: "netReceivedAmount", kind: "money" },
  { label: "原始利润", key: "originalProfitAmount", kind: "money" },
  { label: "售后净利润", key: "afterSaleNetProfitAmount", kind: "money" },
];

const purchaseMetrics: { label: string; key: keyof DailyBusinessReport["purchases"]; kind: "money" | "count" }[] = [
  { label: "新建采购单", key: "createdOrderCount", kind: "count" },
  { label: "到货采购单", key: "arrivedOrderCount", kind: "count" },
  { label: "完成验货商品", key: "inspectedItemCount", kind: "count" },
  { label: "新形成库存件数", key: "createdInventoryItemCount", kind: "count" },
  { label: "上游采购退款", key: "purchaseRefundAmount", kind: "money" },
];

const inventoryMetrics: { label: string; hint?: string; href: string; key: keyof DailyBusinessReport["inventory"]; kind: "money" | "count" }[] = [
  { label: "正常在库件数", href: "/inventory?status=STOCKED", key: "stockedCount", kind: "count" },
  { label: "正常在库资产成本", href: "/inventory?status=STOCKED", key: "stockedAssetCost", kind: "money" },
  { label: "平台处理中件数", href: "/shipments", key: "platformProcessingCount", kind: "count" },
  { label: "平台退回途中件数", href: "/platform-returns?category=RETURNING", key: "platformReturningCount", kind: "count" },
  { label: "已退回待处理件数", href: "/platform-returns?category=PENDING_INSPECTION", key: "platformReturnedPendingCount", kind: "count" },
  { label: "待进一步判断件数", hint: "属于已退回待处理的子集，不重复计入总未售资产。", href: "/platform-returns?category=PENDING_DECISION", key: "pendingDecisionCount", kind: "count" },
  { label: "问题件件数", href: "/inventory?status=PROBLEM", key: "problemCount", kind: "count" },
  { label: "问题件资产成本", href: "/inventory?status=PROBLEM", key: "problemAssetCost", kind: "money" },
  { label: "总未售资产件数", href: "/inventory", key: "totalUnsoldAssetCount", kind: "count" },
  { label: "总未售资产成本", href: "/inventory", key: "totalUnsoldAssetCost", kind: "money" },
];

const inventoryExpiryLabels: Record<keyof DailyBusinessReport["inventoryExpiry"]["counts"], string> = {
  EXPIRED: "已过期",
  WITHIN_30_DAYS: "30天内到期",
  WITHIN_90_DAYS: "90天内到期",
  WITHIN_180_DAYS: "180天内到期",
};

function formatMoney(value: string) {
  const source = String(value ?? "0.00").trim();
  const negative = source.startsWith("-");
  const unsigned = negative ? source.slice(1) : source;
  const [integer = "0", fraction = "00"] = unsigned.split(".");
  const grouped = integer.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") || "0";
  return `¥${negative ? "-" : ""}${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "未填写";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未填写";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatReportDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]}年${match[2]}月${match[3]}日` : value;
}

function safeHref(href: string) {
  return href.startsWith("/") ? href : "/";
}

function MetricCard({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const content = (
    <Card size="sm" className="h-full transition-colors hover:bg-muted/40">
      <CardContent className="space-y-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-words text-lg font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</Link> : content;
}

function SectionHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-6" aria-label="正在加载每日经营报告">
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export function DailyBusinessReportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryDate = searchParams.get("date") ?? "";
  const [report, setReport] = useState<DailyBusinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendDate, setSendDate] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryStatus | null>(null);

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({ timezone: "Asia/Shanghai" });
    if (queryDate) params.set("date", queryDate);
    return `/api/reports/daily-business?${params.toString()}`;
  }, [queryDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    setDelivery(null);
    try {
      const response = await fetch(requestUrl);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 400) setError("报告日期或时区参数无效。");
        else if (response.status >= 500) setError("每日经营报告生成失败，请稍后重试。");
        else setError(body?.message ?? "每日经营报告加载失败，请稍后重试。");
        return;
      }
      const nextReport = body as DailyBusinessReport;
      setReport(nextReport);
      const statusResponse = await fetch(`/api/reports/daily-business/delivery-status?date=${encodeURIComponent(nextReport.reportDate)}&timezone=Asia%2FShanghai`);
      const statusBody = await statusResponse.json().catch(() => null);
      if (statusResponse.ok) setDelivery(statusBody?.delivery ?? null);
    } catch {
      setError("无法连接到报告服务，请检查系统和网络状态。");
    } finally {
      setLoading(false);
    }
  }, [requestUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function updateDate(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("date", value);
    else params.delete("date");
    router.replace(params.size ? `/reports/daily?${params.toString()}` : "/reports/daily", { scroll: false });
  }

  function openSendDialog() {
    if (!report) return;
    if (delivery?.status === "SENT") {
      toast.message("该日期日报已发送，无需重复发送。");
      return;
    }
    if (delivery?.status === "SENDING") {
      toast.message("该日期日报正在发送中，请稍后刷新状态。");
      return;
    }
    setSendDate(report.reportDate);
    setSendDialogOpen(true);
  }

  async function sendToFeishu() {
    if (!sendDate || sending) return;
    setSending(true);
    try {
      const response = await fetch("/api/reports/daily-business/send-feishu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: sendDate, timezone: "Asia/Shanghai" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message ?? "发送每日经营报告失败，请稍后重试。");
      }
      setSendDialogOpen(false);
      if (body?.outcome === "ALREADY_SENT") toast.message("该日期日报已发送，无需重复发送。");
      else if (body?.outcome === "IN_PROGRESS") toast.message("该日期日报正在发送中，请稍后刷新状态。");
      else if (body?.outcome === "NOT_RETRYABLE") toast.error(body?.delivery?.lastErrorMessage ?? "该日报发送失败且当前不能自动重试。");
      else toast.success("每日经营报告已发送到飞书。");
      await load();
    } catch (sendError) {
      toast.error(sendError instanceof Error ? sendError.message : "发送每日经营报告失败，请稍后重试。");
    } finally {
      setSending(false);
    }
  }

  const effectiveDate = report?.reportDate ?? queryDate;
  const canSend = !delivery || delivery.nextAction === "SEND" || delivery.nextAction === "RETRY";
  const deliveryLabel = delivery?.status === "SENT" ? "已发送"
    : delivery?.status === "SENDING" ? "发送中"
      : delivery?.status === "FAILED" ? "发送失败"
        : "尚未发送";

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">经营分析</p>
          <h1 className="text-2xl font-semibold">每日经营报告</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">汇总所选日期发生的经营事件，以及报告生成时的当前库存、待办、风险和人工行情快照。</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">报告日期</span>
            <Input aria-label="报告日期" type="date" value={queryDate || report?.reportDate || ""} onInput={(event) => updateDate(event.currentTarget.value)} className="min-w-40" disabled={loading || sending} />
          </label>
          <Button type="button" variant="outline" onClick={() => updateDate("")} disabled={loading || sending}>查看昨日</Button>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading || sending}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            刷新
          </Button>
          <Button type="button" onClick={openSendDialog} disabled={loading || !report || sending || !canSend}>
            <Send />
            {delivery?.nextAction === "RETRY" ? "重新发送" : "发送到飞书"}
          </Button>
        </div>
      </div>

      <Dialog open={sendDialogOpen} onOpenChange={(open) => !sending && setSendDialogOpen(open)}>
        <DialogContent showCloseButton={!sending}>
          <DialogHeader>
            <DialogTitle>发送每日经营报告</DialogTitle>
            <DialogDescription>
              将发送 {sendDate ?? "所选日期"} 的经营结果，以及发送时刻的当前库存、待办和风险快照。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-6 text-muted-foreground">同一日期已发送的日报会自动跳过；失败且可重试时才允许再次发送。</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSendDialogOpen(false)} disabled={sending}>取消</Button>
            <Button type="button" onClick={() => void sendToFeishu()} disabled={sending || !sendDate}>
              <Send className={sending ? "animate-pulse" : ""} />
              {sending ? "发送中" : "确认发送"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? <ReportSkeleton /> : null}

      {error ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive"><AlertCircle className="size-4" />无法加载每日经营报告</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent><Button type="button" variant="outline" onClick={() => void load()}>重新加载</Button></CardContent>
        </Card>
      ) : null}

      {report && !loading ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CalendarDays className="size-4" />报告时间信息</CardTitle>
              <CardDescription>所选日期事件按北京时间统计；当前快照不等同于历史库存快照。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div><p className="text-muted-foreground">报告日期</p><p className="mt-1 font-medium">{formatReportDate(report.reportDate)}</p></div>
              <div><p className="text-muted-foreground">事件统计区间</p><p className="mt-1 leading-6">{formatDateTime(report.periodStart)} 至 {formatDateTime(report.periodEnd)}</p></div>
              <div><p className="text-muted-foreground">报告生成时间</p><p className="mt-1">{formatDateTime(report.generatedAt)}</p></div>
              <div><p className="text-muted-foreground">时区</p><p className="mt-1">北京时间（Asia/Shanghai）</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">飞书发送状态</CardTitle>
              <CardDescription>发送记录只保存状态和安全错误，不保存机器人配置或日报正文。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div><p className="text-muted-foreground">当前状态</p><p className="mt-1 font-medium">{deliveryLabel}</p></div>
              <div><p className="text-muted-foreground">尝试次数</p><p className="mt-1 font-medium">{delivery?.attemptCount ?? 0}</p></div>
              <div><p className="text-muted-foreground">发送时间</p><p className="mt-1">{formatDateTime(delivery?.sentAt)}</p></div>
              <div><p className="text-muted-foreground">最后尝试</p><p className="mt-1">{formatDateTime(delivery?.startedAt ?? delivery?.failedAt ?? delivery?.requestedAt)}</p></div>
              {delivery?.status === "FAILED" ? <div className="sm:col-span-2 xl:col-span-4"><p className="text-destructive">{delivery.lastErrorMessage ?? "日报发送失败。"}{delivery.retryable ? " 可重新发送。" : " 请检查配置或数据后处理。"}</p></div> : null}
            </CardContent>
          </Card>

          <section className="space-y-4" aria-labelledby="daily-events-heading">
            <SectionHeading title="所选日期经营结果" description={`${effectiveDate ? formatReportDate(effectiveDate) : "所选日期"}发生的销售、采购和真实退款事件。`} />
            <div className="space-y-3">
              <h3 id="daily-events-heading" className="text-base font-medium">销售摘要</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{salesMetrics.map((metric) => <MetricCard key={metric.key} label={metric.label} value={metric.kind === "money" ? formatMoney(String(report.sales[metric.key])) : String(report.sales[metric.key])} />)}</div>
              <p className="text-xs leading-5 text-muted-foreground">预计收入是销售时预计可到账；实际到账仅来自已登记到账；实际退款仅统计真实退款流水；售后净利润复用既有售后财务口径。</p>
            </div>
            <div className="space-y-3">
              <h3 className="text-base font-medium">采购摘要</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{purchaseMetrics.map((metric) => <MetricCard key={metric.key} label={metric.label} value={metric.kind === "money" ? formatMoney(String(report.purchases[metric.key])) : String(report.purchases[metric.key])} />)}</div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeading title="当前库存与资产" description="以下为报告生成时间的当前快照，不代表所选历史日期当天的库存状态。" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{inventoryMetrics.map((metric) => <MetricCard key={metric.key} label={metric.label} hint={metric.hint} href={metric.href} value={metric.kind === "money" ? formatMoney(String(report.inventory[metric.key])) : String(report.inventory[metric.key])} />)}</div>
          </section>

          <section className="space-y-4">
            <SectionHeading title="库存效期风险" description={`按北京时间 ${report.inventoryExpiry.businessDate} 的到期日实时判断，仅提醒，不会自动下架、报废或改变库存状态。`} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(report.inventoryExpiry.counts).map(([risk, count]) => (
                <MetricCard key={risk} label={inventoryExpiryLabels[risk as keyof DailyBusinessReport["inventoryExpiry"]["counts"]]} href={`/inventory?expiryRisk=${risk}`} value={`${count} 件`} />
              ))}
            </div>
            {report.inventoryExpiry.samples.length ? (
              <Card>
                <CardHeader><CardTitle className="text-base">最近到期库存</CardTitle><CardDescription>最多展示 5 件；仓库、标准库位、手动库位和历史自由文本均使用统一位置文案。</CardDescription></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {report.inventoryExpiry.samples.map((item) => <div key={item.id} className="grid gap-1 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><p className="break-words font-medium">{item.name}{item.skuText ? ` / ${item.skuText}` : ""}</p><p className="break-words text-xs text-muted-foreground">{item.displayStorageLocation}</p></div><p className="text-sm text-muted-foreground">{item.expiryDate ?? "未填写"} · {inventoryExpiryLabels[item.risk]}</p></div>)}
                </CardContent>
              </Card>
            ) : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">暂无效期风险库存</CardContent></Card>}
          </section>

          <section className="space-y-4">
            <SectionHeading title="当前待办" description="按服务端返回顺序展示，优先级和处理入口由日报聚合层提供。" />
            {report.todos.items.length ? <div className="grid gap-3 lg:grid-cols-2">{report.todos.items.map((item) => {
              const labels = formatDailyTodo(item.code);
              const priority = formatDailyPriority(item.priority ?? "");
              return <Card key={item.code} size="sm"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{labels.title}</CardTitle><CardDescription>{labels.description}</CardDescription></div><Badge variant={priority.variant}>{priority.label}</Badge></div></CardHeader><CardContent className="space-y-3"><p className="text-2xl font-semibold tabular-nums">{item.count}</p>{item.samples.length ? <ul className="space-y-1 text-sm text-muted-foreground">{item.samples.map((sample) => <li key={sample.id} className="break-words">{sample.label}{sample.at ? ` · ${formatDateTime(sample.at)}` : ""}</li>)}</ul> : null}<Link href={safeHref(item.href)} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">查看处理入口 <ChevronRight className="size-4" /></Link></CardContent></Card>;
            })}</div> : <Card><CardContent className="py-10 text-center text-muted-foreground">暂无待办</CardContent></Card>}
          </section>

          <section className="space-y-4">
            <SectionHeading title="当前风险" description="风险阈值由服务端统一判断，页面仅展示当前结果。" />
            {report.risks.items.length ? <div className="grid gap-3 lg:grid-cols-2">{report.risks.items.map((item) => {
              const labels = formatDailyRisk(item.code);
              const severity = formatDailyPriority(item.severity ?? "");
              return <Card key={item.code} size="sm" className="border-amber-500/20"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{labels.title}</CardTitle><CardDescription>{labels.description}</CardDescription></div><Badge variant={severity.variant}>{severity.label}</Badge></div></CardHeader><CardContent className="space-y-3"><p className="text-2xl font-semibold tabular-nums">{item.count}</p><p className="text-sm text-muted-foreground">最早等待时间：{formatDateTime(item.oldestAt)}</p>{item.samples.length ? <ul className="space-y-1 text-sm text-muted-foreground">{item.samples.map((sample) => <li key={sample.id} className="break-words">{sample.label}{sample.at ? ` · ${formatDateTime(sample.at)}` : ""}</li>)}</ul> : null}<Link href={safeHref(item.href)} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">查看处理入口 <ChevronRight className="size-4" /></Link></CardContent></Card>;
            })}</div> : <Card><CardContent className="py-10 text-center text-muted-foreground">暂无需要重点关注的经营风险。</CardContent></Card>}
          </section>

          <section className="space-y-4">
            <SectionHeading title="人工行情摘要" description="当前行情由人工录入，不代表系统已自动读取得物或 95 分数据。" action={<Link href="/market" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">进入行情管理 <TrendingUp className="size-4" /></Link>} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <MetricCard label="启用中的行情商品" value={String(report.market.activeMarketItemCount)} />
              <MetricCard label="有当前有效预计收入" value={String(report.market.withCurrentExpectedIncomeCount)} />
              <MetricCard label="无当前有效预计收入" value={String(report.market.withoutCurrentExpectedIncomeCount)} />
              <MetricCard label="所选日期新增报价" value={String(report.market.quotesCreatedInPeriodCount)} />
              <MetricCard label="所选日期确认报价" value={String(report.market.quotesConfirmedInPeriodCount)} />
              <MetricCard label="即将过期报价" value={String(report.market.expiringQuoteCount)} />
              <MetricCard label="已过期报价" value={String(report.market.expiredQuoteCount)} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
