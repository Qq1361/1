"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Summary = {
  totalOrderCount: number;
  totalSoldItemCount: number;
  grossAmountTotal: string;
  expectedIncomeTotal: string;
  actualReceivedAmountTotal: string;
  unsettledExpectedAmountTotal: string;
  inventoryCostTotal: string;
  feeTotal: string;
  shippingCostTotal: string;
  otherCostTotal: string;
  profitTotal: string;
  grossMarginRate: number | null;
  averageProfitPerItem: number | null;
  unsettledOrderCount: number;
  overdueUnsettledOrderCount: number;
};

type PlatformRow = {
  platform: string;
  orderCount: number;
  soldItemCount: number;
  grossAmountTotal: string;
  expectedIncomeTotal: string;
  actualReceivedAmountTotal: string;
  profitTotal: string;
  grossMarginRate: number | null;
};

type ProductRow = {
  productName: string;
  sku: string | null;
  soldItemCount: number;
  costTotal: string;
  grossAmountTotal: string;
  expectedIncomeTotal: string;
  actualReceivedAmountTotal: string;
  profitTotal: string;
  averageProfitPerItem: number | null;
};

type UnsettledOrder = {
  saleOrderId: string;
  saleNo: string;
  platform: string;
  platformOrderNo: string | null;
  soldAt: string;
  confirmedAt: string | null;
  expectedIncome: string | null;
  grossAmount: string;
  daysUnsettled: number;
  isOverdue: boolean;
};

type ReportData = {
  summary: Summary;
  platformBreakdown: PlatformRow[];
  productBreakdown: ProductRow[];
  unsettledOrders: UnsettledOrder[];
};

const platformParam: Record<string, string> = {
  dewu: "DEWU",
  ninetyFive: "NINETY_FIVE",
  xianyu: "XIANYU",
  other: "OTHER",
};

const statusParam: Record<string, string> = {
  confirmed: "CONFIRMED",
  settled: "SETTLED",
};

const settlementParam: Record<string, string> = {
  all: "ALL",
  settled: "SETTLED",
  unsettled: "UNSETTLED",
};

function formatPlatform(platform: string) {
  const map: Record<string, string> = {
    DEWU: "得物",
    NINETY_FIVE: "95分",
    XIANYU: "闲鱼",
    OTHER: "其他",
  };
  return map[platform] ?? "未填写";
}

function money(value: string | null | undefined) {
  if (!value) return "¥0.00";
  return `¥${value}`;
}

function optionalMoney(value: string | null | undefined) {
  return value ? `¥${value}` : "未填写";
}

function rate(value: number | null) {
  if (value == null) return "未填写";
  return `${(value * 100).toFixed(2)}%`;
}

function dateText(value: string | null) {
  if (!value) return "未填写";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfWeek(date: Date) {
  const d = startOfDay(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function resolveRange(range: string, customFrom: string, customTo: string) {
  const now = new Date();
  if (range === "all") return {};
  if (range === "today") return { dateFrom: startOfDay(now), dateTo: endOfDay(now) };
  if (range === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { dateFrom: startOfDay(yesterday), dateTo: endOfDay(yesterday) };
  }
  if (range === "week") return { dateFrom: startOfWeek(now), dateTo: endOfDay(now) };
  if (range === "month") return { dateFrom: startOfMonth(now), dateTo: endOfDay(now) };
  if (range === "custom") {
    return {
      dateFrom: customFrom ? startOfDay(new Date(customFrom)) : undefined,
      dateTo: customTo ? endOfDay(new Date(customTo)) : undefined,
    };
  }
  return {};
}

const metricRows: { key: keyof Summary; label: string; kind?: "money" | "rate" | "number" }[] = [
  { key: "totalOrderCount", label: "总销售单数", kind: "number" },
  { key: "totalSoldItemCount", label: "已售件数", kind: "number" },
  { key: "grossAmountTotal", label: "成交价合计", kind: "money" },
  { key: "expectedIncomeTotal", label: "预计收入合计", kind: "money" },
  { key: "actualReceivedAmountTotal", label: "实际到账合计", kind: "money" },
  { key: "unsettledExpectedAmountTotal", label: "未到账预计金额", kind: "money" },
  { key: "inventoryCostTotal", label: "库存成本合计", kind: "money" },
  { key: "feeTotal", label: "费用合计", kind: "money" },
  { key: "shippingCostTotal", label: "销售侧运费合计", kind: "money" },
  { key: "otherCostTotal", label: "其他成本合计", kind: "money" },
  { key: "profitTotal", label: "利润合计", kind: "money" },
  { key: "grossMarginRate", label: "毛利率", kind: "rate" },
  { key: "averageProfitPerItem", label: "平均单件利润", kind: "money" },
  { key: "unsettledOrderCount", label: "未到账订单数", kind: "number" },
  { key: "overdueUnsettledOrderCount", label: "超期未到账订单数", kind: "number" },
];

function metricValue(summary: Summary, key: keyof Summary, kind?: "money" | "rate" | "number") {
  const value = summary[key];
  if (kind === "money") return typeof value === "number" ? `¥${value.toFixed(2)}` : money(value);
  if (kind === "rate") return rate(typeof value === "number" ? value : null);
  return String(value ?? 0);
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-24 text-center text-sm text-muted-foreground">
        暂无数据
      </TableCell>
    </TableRow>
  );
}

export function SalesReportOverview() {
  const [range, setRange] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [platform, setPlatform] = useState("all");
  const [status, setStatus] = useState("all");
  const [settlementStatus, setSettlementStatus] = useState("all");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => {
    if (range !== "custom" || !customFrom || !customTo) return null;
    return new Date(customFrom) > new Date(customTo)
      ? "自定义开始日期不能晚于结束日期。"
      : null;
  }, [range, customFrom, customTo]);

  const load = useCallback(async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const resolvedRange = resolveRange(range, customFrom, customTo);
      if (resolvedRange.dateFrom) params.set("dateFrom", resolvedRange.dateFrom.toISOString());
      if (resolvedRange.dateTo) params.set("dateTo", resolvedRange.dateTo.toISOString());
      if (platform !== "all") params.set("platform", platformParam[platform]);
      if (status !== "all") params.set("status", statusParam[status]);
      if (settlementStatus !== "all") {
        params.set("settlementStatus", settlementParam[settlementStatus]);
      }

      const response = await fetch(`/api/reports/sales?${params.toString()}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message ?? "销售报表加载失败。");
        return;
      }
      setData(body);
    } catch {
      setError("网络异常，销售报表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [customFrom, customTo, platform, range, settlementStatus, status, validationError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
        <p className="text-sm text-muted-foreground">销售分析</p>
        <h1 className="text-2xl font-semibold tracking-tight">销售报表</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          报表仅统计已确认销售和已到账销售；平台上架 / 可售不等于已售出。
        </p>
        </div>
        <Link href="/reports/sales/orders" className={buttonVariants({ variant: "outline" })}>
          查看销售明细
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">筛选条件</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">时间范围</span>
            <select className="h-9 w-full rounded-lg border bg-background px-2.5" value={range} onChange={(event) => setRange(event.target.value)}>
              <option value="all">全部</option>
              <option value="today">今日</option>
              <option value="yesterday">昨日</option>
              <option value="week">本周</option>
              <option value="month">本月</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">平台</span>
            <select className="h-9 w-full rounded-lg border bg-background px-2.5" value={platform} onChange={(event) => setPlatform(event.target.value)}>
              <option value="all">全部</option>
              <option value="dewu">得物</option>
              <option value="ninetyFive">95分</option>
              <option value="xianyu">闲鱼</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">销售状态</span>
            <select className="h-9 w-full rounded-lg border bg-background px-2.5" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">全部</option>
              <option value="confirmed">已确认销售</option>
              <option value="settled">已到账</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">到账状态</span>
            <select className="h-9 w-full rounded-lg border bg-background px-2.5" value={settlementStatus} onChange={(event) => setSettlementStatus(event.target.value)}>
              <option value="all">全部</option>
              <option value="settled">已到账</option>
              <option value="unsettled">未到账</option>
            </select>
          </label>
          <button type="button" className={buttonVariants({ variant: "outline", className: "self-end" })} onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            刷新
          </button>
          {range === "custom" ? (
            <div className="grid gap-3 md:col-span-5 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">开始日期</span>
                <Input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">结束日期</span>
                <Input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} />
              </label>
            </div>
          ) : null}
          {range !== "custom" ? (
            <input type="hidden" aria-hidden="true" value={toDateInputValue(new Date())} readOnly />
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <Skeleton className="h-96 w-full" />
      ) : data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {metricRows.map((metric) => (
              <Card key={metric.key}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{metric.label}</p>
                  <p className="mt-2 text-xl font-semibold">{metricValue(data.summary, metric.key, metric.kind)}</p>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">平台排行</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>平台</TableHead>
                      <TableHead>销售单数</TableHead>
                      <TableHead>已售件数</TableHead>
                      <TableHead>成交价</TableHead>
                      <TableHead>预计收入</TableHead>
                      <TableHead>实际到账</TableHead>
                      <TableHead>利润</TableHead>
                      <TableHead>毛利率</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.platformBreakdown.length === 0 ? <EmptyRow colSpan={8} /> : data.platformBreakdown.map((row) => (
                      <TableRow key={row.platform}>
                        <TableCell>{formatPlatform(row.platform)}</TableCell>
                        <TableCell>{row.orderCount}</TableCell>
                        <TableCell>{row.soldItemCount}</TableCell>
                        <TableCell>{money(row.grossAmountTotal)}</TableCell>
                        <TableCell>{money(row.expectedIncomeTotal)}</TableCell>
                        <TableCell>{money(row.actualReceivedAmountTotal)}</TableCell>
                        <TableCell>{money(row.profitTotal)}</TableCell>
                        <TableCell>{rate(row.grossMarginRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">商品排行</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>商品名</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>已售件数</TableHead>
                      <TableHead>成本合计</TableHead>
                      <TableHead>成交价合计</TableHead>
                      <TableHead>预计收入合计</TableHead>
                      <TableHead>实际到账合计</TableHead>
                      <TableHead>利润合计</TableHead>
                      <TableHead>平均单件利润</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.productBreakdown.length === 0 ? <EmptyRow colSpan={9} /> : data.productBreakdown.map((row) => (
                      <TableRow key={`${row.productName}-${row.sku ?? ""}`}>
                        <TableCell className="min-w-36 font-medium">{row.productName || "未填写"}</TableCell>
                        <TableCell>{row.sku || "未填写"}</TableCell>
                        <TableCell>{row.soldItemCount}</TableCell>
                        <TableCell>{money(row.costTotal)}</TableCell>
                        <TableCell>{money(row.grossAmountTotal)}</TableCell>
                        <TableCell>{money(row.expectedIncomeTotal)}</TableCell>
                        <TableCell>{money(row.actualReceivedAmountTotal)}</TableCell>
                        <TableCell>{money(row.profitTotal)}</TableCell>
                        <TableCell>{row.averageProfitPerItem == null ? "未填写" : `¥${row.averageProfitPerItem.toFixed(2)}`}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">未到账订单</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>销售单号</TableHead>
                    <TableHead>平台</TableHead>
                    <TableHead>平台订单号</TableHead>
                    <TableHead>销售时间</TableHead>
                    <TableHead>确认时间</TableHead>
                    <TableHead>预计收入</TableHead>
                    <TableHead>成交价</TableHead>
                    <TableHead>未到账天数</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.unsettledOrders.length === 0 ? <EmptyRow colSpan={10} /> : data.unsettledOrders.map((order) => (
                    <TableRow key={order.saleOrderId}>
                      <TableCell className="font-medium">{order.saleNo}</TableCell>
                      <TableCell>{formatPlatform(order.platform)}</TableCell>
                      <TableCell>{order.platformOrderNo || "未填写"}</TableCell>
                      <TableCell>{dateText(order.soldAt)}</TableCell>
                      <TableCell>{dateText(order.confirmedAt)}</TableCell>
                      <TableCell>{optionalMoney(order.expectedIncome)}</TableCell>
                      <TableCell>{money(order.grossAmount)}</TableCell>
                      <TableCell>{order.daysUnsettled} 天</TableCell>
                      <TableCell>
                        <Badge variant={order.isOverdue ? "destructive" : "secondary"}>
                          {order.isOverdue ? "已超期" : "未到账"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/sales/${order.saleOrderId}`}>
                          查看销售订单
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
