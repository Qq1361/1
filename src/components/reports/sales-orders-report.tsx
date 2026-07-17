"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SaleOrderReportRow = {
  saleOrderId: string;
  saleNo: string;
  platform: string;
  status: string;
  platformOrderNo: string | null;
  platformTradeNo: string | null;
  buyerName: string | null;
  soldAt: string;
  confirmedAt: string | null;
  settledAt: string | null;
  grossAmount: string;
  expectedIncome: string | null;
  actualReceivedAmount: string | null;
  inventoryCostTotal: string;
  feeTotal: string;
  shippingCost: string;
  otherCost: string;
  profit: string;
  originalProfit: string;
  totalSalesRefundedAmount: string;
  netReceivedAmount: string;
  restockedCostReversal: string;
  afterSaleNetProfit: string;
  afterSaleCaseCount: number;
  activeAfterSaleCaseCount: number;
  afterSaleStatusSummary: { status: string; count: number }[];
  grossMarginRate: string | null;
  soldItemCount: number;
  isSettled: boolean;
  isUnsettled: boolean;
  isOverdueUnsettled: boolean;
  itemsSummary: string;
};

type ReportData = {
  items: SaleOrderReportRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
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

function formatSaleStatus(status: string) {
  const map: Record<string, string> = {
    CONFIRMED: "已确认销售",
    SETTLED: "已到账",
  };
  return map[status] ?? "未填写";
}

function money(value: string | null | undefined) {
  return value ? `¥${value}` : "未填写";
}

function dateText(value: string | null) {
  if (!value) return "未填写";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
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

function EmptyRow() {
  return (
    <TableRow>
      <TableCell colSpan={20} className="h-24 text-center text-sm text-muted-foreground">
        暂无数据
      </TableCell>
    </TableRow>
  );
}

export function SalesOrdersReport() {
  const searchParams = useSearchParams();
  const productNameExact = searchParams.get("productNameExact")?.trim() || "";
  const skuExact = searchParams.get("skuExact")?.trim() || "";
  const skuEmpty = searchParams.get("skuEmpty") === "true";
  const [range, setRange] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [platform, setPlatform] = useState("all");
  const [status, setStatus] = useState("all");
  const [settlementStatus, setSettlementStatus] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => {
    if (range !== "custom" || !customFrom || !customTo) return null;
    return new Date(customFrom) > new Date(customTo)
      ? "自定义开始日期不能晚于结束日期。"
      : null;
  }, [range, customFrom, customTo]);

  const load = useCallback(async (nextPage = page) => {
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
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (productNameExact) params.set("productNameExact", productNameExact);
      if (skuEmpty) params.set("skuEmpty", "true");
      else if (skuExact) params.set("skuExact", skuExact);
      params.set("page", String(nextPage));
      params.set("pageSize", "20");

      const response = await fetch(`/api/reports/sales/orders?${params.toString()}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message ?? "销售明细加载失败。");
        return;
      }
      setData(body);
      setPage(nextPage);
    } catch {
      setError("网络异常，销售明细加载失败。");
    } finally {
      setLoading(false);
    }
  }, [customFrom, customTo, keyword, page, platform, productNameExact, range, settlementStatus, skuEmpty, skuExact, status, validationError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function updateAndReset(action: () => void) {
    action();
    setPage(1);
  }

  const canPrev = (data?.pagination.page ?? 1) > 1;
  const canNext = data ? data.pagination.page < data.pagination.totalPages : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">销售分析</p>
          <h1 className="text-2xl font-semibold tracking-tight">销售明细</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            只统计已确认销售和已到账销售；草稿和已取消销售不计入报表。
          </p>
          {productNameExact || skuExact || skuEmpty ? (
            <p className="text-sm text-muted-foreground">
              已按商品快照精确筛选：{productNameExact || "全部商品"} / {skuEmpty ? "未填写 SKU" : skuExact || "全部 SKU"}
            </p>
          ) : null}
        </div>
        <Link href="/reports/sales" className={buttonVariants({ variant: "outline" })}>
          返回销售报表
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">筛选条件</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">时间范围</span>
            <select className="h-9 w-full rounded-lg border bg-background px-2.5" value={range} onChange={(event) => updateAndReset(() => setRange(event.target.value))}>
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
            <select className="h-9 w-full rounded-lg border bg-background px-2.5" value={platform} onChange={(event) => updateAndReset(() => setPlatform(event.target.value))}>
              <option value="all">全部</option>
              <option value="dewu">得物</option>
              <option value="ninetyFive">95分</option>
              <option value="xianyu">闲鱼</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">销售状态</span>
            <select className="h-9 w-full rounded-lg border bg-background px-2.5" value={status} onChange={(event) => updateAndReset(() => setStatus(event.target.value))}>
              <option value="all">全部</option>
              <option value="confirmed">已确认销售</option>
              <option value="settled">已到账</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">到账状态</span>
            <select className="h-9 w-full rounded-lg border bg-background px-2.5" value={settlementStatus} onChange={(event) => updateAndReset(() => setSettlementStatus(event.target.value))}>
              <option value="all">全部</option>
              <option value="settled">已到账</option>
              <option value="unsettled">未到账</option>
            </select>
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-muted-foreground">关键词</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                value={keyword}
                onChange={(event) => updateAndReset(() => setKeyword(event.target.value))}
                placeholder="销售单号、平台订单号、买家、商品名、SKU"
              />
            </div>
          </label>
          {range === "custom" ? (
            <div className="grid gap-3 md:col-span-6 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">开始日期</span>
                <Input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => updateAndReset(() => setCustomFrom(event.target.value))} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">结束日期</span>
                <Input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => updateAndReset(() => setCustomTo(event.target.value))} />
              </label>
            </div>
          ) : null}
          <button type="button" className={buttonVariants({ variant: "outline", className: "md:col-span-6 justify-self-start" })} onClick={() => load(1)} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            刷新
          </button>
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
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">销售明细表</CardTitle>
            <p className="text-sm text-muted-foreground">
              共 {data?.pagination.total ?? 0} 条
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>销售单号</TableHead>
                    <TableHead>平台</TableHead>
                    <TableHead>销售状态</TableHead>
                    <TableHead>销售时间</TableHead>
                    <TableHead>成交价</TableHead>
                    <TableHead>预计收入</TableHead>
                    <TableHead>实际到账</TableHead>
                    <TableHead>累计退款</TableHead>
                    <TableHead>净到账</TableHead>
                    <TableHead>成本</TableHead>
                    <TableHead>费用</TableHead>
                    <TableHead>原利润</TableHead>
                    <TableHead>恢复成本</TableHead>
                    <TableHead>售后净利润</TableHead>
                    <TableHead>毛利率</TableHead>
                    <TableHead>件数</TableHead>
                    <TableHead>商品摘要</TableHead>
                    <TableHead>到账状态</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!data || data.items.length === 0 ? <EmptyRow /> : data.items.map((order) => (
                    <TableRow key={order.saleOrderId}>
                      <TableCell className="min-w-36 font-medium">{order.saleNo}</TableCell>
                      <TableCell>{formatPlatform(order.platform)}</TableCell>
                      <TableCell>{formatSaleStatus(order.status)}</TableCell>
                      <TableCell>{dateText(order.soldAt)}</TableCell>
                      <TableCell>{money(order.grossAmount)}</TableCell>
                      <TableCell>{money(order.expectedIncome)}</TableCell>
                      <TableCell>{money(order.actualReceivedAmount)}</TableCell>
                      <TableCell>{money(order.totalSalesRefundedAmount)}</TableCell>
                      <TableCell>{money(order.netReceivedAmount)}</TableCell>
                      <TableCell>{money(order.inventoryCostTotal)}</TableCell>
                      <TableCell>{money(order.feeTotal)}</TableCell>
                      <TableCell>{money(order.originalProfit)}</TableCell>
                      <TableCell>{money(order.restockedCostReversal)}</TableCell>
                      <TableCell>{money(order.afterSaleNetProfit)}</TableCell>
                      <TableCell>{order.grossMarginRate ? `${order.grossMarginRate}%` : "未填写"}</TableCell>
                      <TableCell>{order.soldItemCount}</TableCell>
                      <TableCell className="min-w-64">{order.itemsSummary || "未填写"}</TableCell>
                      <TableCell>
                        <Badge variant={order.isSettled ? "default" : order.isOverdueUnsettled ? "destructive" : "secondary"}>
                          {order.isSettled ? "已到账" : order.isOverdueUnsettled ? "已超期" : "未到账"}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-44">
                        <Link href={`/sales/${order.saleOrderId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                          查看销售订单
                        </Link>
                        <Link href={`/sales-after-sales?saleOrderId=${order.saleOrderId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                          查看售后（{order.afterSaleCaseCount}）
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                第 {data?.pagination.page ?? 1} / {data?.pagination.totalPages ?? 0} 页
              </p>
              <div className="flex gap-2">
                <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!canPrev || loading} onClick={() => load(page - 1)}>
                  <ChevronLeft />
                  上一页
                </button>
                <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!canNext || loading} onClick={() => load(page + 1)}>
                  下一页
                  <ChevronRight />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
