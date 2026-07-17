"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ProductRow = {
  productName: string;
  skuText: string | null;
  orderCount: number;
  soldItemCount: number;
  confirmedItemCount: number;
  settledItemCount: number;
  inventoryCostTotal: string;
  lineSaleAmountTotal: string | null;
  profitTotal: string;
  originalProfitTotal: string;
  refundedAmountTotal: string;
  restockedCostReversal: string;
  afterSaleNetProfit: string;
  refundedItemCount: number;
  restockedItemCount: number;
  problemReturnedItemCount: number;
  averageUnitCost: string;
  averageSaleAmountPerItem: string | null;
  averageProfitPerItem: string;
  profitMarginRate: number | null;
  firstSoldAt: string;
  lastSoldAt: string;
};

type ReportData = {
  items: ProductRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const platformParam: Record<string, string> = { dewu: "DEWU", ninetyFive: "NINETY_FIVE", xianyu: "XIANYU", other: "OTHER" };
const statusParam: Record<string, string> = { confirmed: "CONFIRMED", settled: "SETTLED" };
const sortParam: Record<string, string> = {
  profit: "profitTotal",
  sold: "soldItemCount",
  averageProfit: "averageProfitPerItem",
  cost: "inventoryCostTotal",
  recent: "lastSoldAt",
  afterSaleProfit: "afterSaleNetProfit",
  refunded: "refundedAmountTotal",
  restocked: "restockedItemCount",
};

function normalMoney(value: string) { return `¥${value}`; }
function dateText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function startOfDay(date: Date) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
function endOfDay(date: Date) { const d = new Date(date); d.setHours(23, 59, 59, 999); return d; }
function startOfWeek(date: Date) { const d = startOfDay(date); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return d; }
function resolveRange(range: string, customFrom: string, customTo: string) {
  const now = new Date();
  if (range === "today") return { dateFrom: startOfDay(now), dateTo: endOfDay(now) };
  if (range === "yesterday") { const d = new Date(now); d.setDate(d.getDate() - 1); return { dateFrom: startOfDay(d), dateTo: endOfDay(d) }; }
  if (range === "week") return { dateFrom: startOfWeek(now), dateTo: endOfDay(now) };
  if (range === "month") return { dateFrom: new Date(now.getFullYear(), now.getMonth(), 1), dateTo: endOfDay(now) };
  if (range === "custom") return { dateFrom: customFrom ? startOfDay(new Date(customFrom)) : undefined, dateTo: customTo ? endOfDay(new Date(customTo)) : undefined };
  return {};
}

function detailLink(row: ProductRow) {
  const params = new URLSearchParams({ productNameExact: row.productName });
  if (row.skuText) params.set("skuExact", row.skuText); else params.set("skuEmpty", "true");
  return `/reports/sales/orders?${params.toString()}`;
}
function inventoryLink(row: ProductRow) {
  const params = new URLSearchParams({ tab: "details", productNameExact: row.productName });
  if (row.skuText) params.set("skuExact", row.skuText); else params.set("skuEmpty", "true");
  return `/inventory?${params.toString()}`;
}

export function SalesProductsReport() {
  const [range, setRange] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [platform, setPlatform] = useState("all");
  const [status, setStatus] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState("afterSaleProfit");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const validationError = useMemo(() => range === "custom" && customFrom && customTo && new Date(customFrom) > new Date(customTo) ? "自定义开始日期不能晚于结束日期。" : null, [range, customFrom, customTo]);

  const load = useCallback(async (nextPage = page) => {
    if (validationError) { setError(validationError); return; }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: "20", sortBy: sortParam[sort], sortOrder: "desc" });
      const resolved = resolveRange(range, customFrom, customTo);
      if (resolved.dateFrom) params.set("dateFrom", resolved.dateFrom.toISOString());
      if (resolved.dateTo) params.set("dateTo", resolved.dateTo.toISOString());
      if (platform !== "all") params.set("platform", platformParam[platform]);
      if (status !== "all") params.set("status", statusParam[status]);
      if (keyword.trim()) params.set("keyword", keyword.trim());
      const response = await fetch(`/api/reports/sales/products?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.message ?? "商品利润分析加载失败。"); return; }
      setData(body); setPage(nextPage);
    } catch { setError("网络异常，商品利润分析加载失败。"); }
    finally { setLoading(false); }
  }, [customFrom, customTo, keyword, page, platform, range, sort, status, validationError]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(1); }, 0); return () => window.clearTimeout(timer); }, [load]);
  function update(action: () => void) { action(); setPage(1); }
  const canPrev = (data?.pagination.page ?? 1) > 1;
  const canNext = data ? data.pagination.page < data.pagination.totalPages : false;

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2"><p className="text-sm text-muted-foreground">销售分析</p><h1 className="text-2xl font-semibold tracking-tight">商品 / SKU 利润分析</h1><p className="max-w-3xl text-sm text-muted-foreground">按销售时保存的商品与 SKU 快照统计。草稿和已取消销售不计入；组合销售的实际到账未做 SKU 自动分摊。</p></div>
      <Link href="/reports/sales" className={buttonVariants({ variant: "outline" })}>返回销售报表</Link>
    </div>
    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">实际到账目前记录在销售订单级，组合销售尚无可靠的 SKU 分摊，因此本页不按 SKU 展示实际到账。退款仅来自用户明确登记的行级退款分配。</div>
    <Card><CardHeader><CardTitle className="text-base">筛选条件</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-6">
      <label className="space-y-1 text-sm"><span className="text-muted-foreground">时间范围</span><select className="h-9 w-full rounded-lg border bg-background px-2.5" value={range} onChange={(e) => update(() => setRange(e.target.value))}><option value="all">全部</option><option value="today">今日</option><option value="yesterday">昨日</option><option value="week">本周</option><option value="month">本月</option><option value="custom">自定义</option></select></label>
      <label className="space-y-1 text-sm"><span className="text-muted-foreground">平台</span><select className="h-9 w-full rounded-lg border bg-background px-2.5" value={platform} onChange={(e) => update(() => setPlatform(e.target.value))}><option value="all">全部</option><option value="dewu">得物</option><option value="ninetyFive">95分</option><option value="xianyu">闲鱼</option><option value="other">其他</option></select></label>
      <label className="space-y-1 text-sm"><span className="text-muted-foreground">销售状态</span><select className="h-9 w-full rounded-lg border bg-background px-2.5" value={status} onChange={(e) => update(() => setStatus(e.target.value))}><option value="all">全部</option><option value="confirmed">已确认销售</option><option value="settled">已到账</option></select></label>
      <label className="space-y-1 text-sm"><span className="text-muted-foreground">排序</span><select className="h-9 w-full rounded-lg border bg-background px-2.5" value={sort} onChange={(e) => update(() => setSort(e.target.value))}><option value="afterSaleProfit">按售后净利润</option><option value="refunded">按退款金额</option><option value="restocked">按重新入库件数</option><option value="profit">按原利润</option><option value="sold">按销量</option><option value="averageProfit">按平均单件利润</option><option value="cost">按成本</option><option value="recent">按最近销售时间</option></select></label>
      <label className="space-y-1 text-sm md:col-span-2"><span className="text-muted-foreground">商品或 SKU</span><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={keyword} onChange={(e) => update(() => setKeyword(e.target.value))} placeholder="搜索商品名、SKU / 色号" /></div></label>
      {range === "custom" ? <div className="grid gap-3 md:col-span-6 md:grid-cols-2"><label className="space-y-1 text-sm"><span className="text-muted-foreground">开始日期</span><Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => update(() => setCustomFrom(e.target.value))} /></label><label className="space-y-1 text-sm"><span className="text-muted-foreground">结束日期</span><Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => update(() => setCustomTo(e.target.value))} /></label></div> : null}
      <button type="button" className={buttonVariants({ variant: "outline", className: "md:col-span-6 justify-self-start" })} onClick={() => load(1)} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />刷新</button>
    </CardContent></Card>
    {error ? <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="size-4" />{error}</div> : null}
    <Card className="rounded-lg shadow-none"><CardHeader><CardTitle className="text-base">商品 / SKU 售后净利润排行</CardTitle><p className="text-xs text-muted-foreground">退款只来自明确的行级退款分配，不分摊订单级实际到账。</p></CardHeader><CardContent>{data?.items.length ? <div className="h-80 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart layout="vertical" data={data.items.slice(0, 10).map((row) => ({ name: `${row.productName}${row.skuText ? ` ${row.skuText}` : ""}`, value: Number(sort === "refunded" ? row.refundedAmountTotal : sort === "restocked" ? row.restockedItemCount : row.afterSaleNetProfit) }))} margin={{ left: 100, right: 16, top: 8 }}><CartesianGrid strokeDasharray="3 3"/><XAxis type="number" tickFormatter={(value) => sort === "restocked" ? String(value) : `¥${value}`}/><YAxis type="category" dataKey="name" width={95} tickFormatter={(value) => value.length > 16 ? `${value.slice(0, 16)}…` : value}/><Tooltip formatter={(value) => sort === "restocked" ? [`${value} 件`, "数量"] : [`¥${Number(value).toFixed(2)}`, sort === "refunded" ? "退款分配" : "售后净利润"]}/><Bar dataKey="value" name="排行值" fill="#7c3aed"/></BarChart></ResponsiveContainer></div> : <p className="py-12 text-center text-sm text-muted-foreground">当前筛选条件下暂无商品排行数据</p>}</CardContent></Card>
    {loading && !data ? <Skeleton className="h-96 w-full" /> : <Card><CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="text-base">商品 / SKU 汇总</CardTitle><p className="text-sm text-muted-foreground">共 {data?.pagination.total ?? 0} 条</p></CardHeader><CardContent className="space-y-4">
      <div className="space-y-3 md:hidden">{!data || data.items.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">暂无数据</p> : data.items.map((row) => <article key={`${row.productName}-${row.skuText ?? "empty"}`} className="space-y-2 rounded-lg border p-3 text-sm"><div><p className="font-medium">{row.productName}</p><p className="text-muted-foreground">SKU / 色号：{row.skuText ?? "未填写"}</p></div><div className="grid grid-cols-2 gap-2"><span>已售件数：{row.soldItemCount}</span><span>销售单数：{row.orderCount}</span><span>原利润：{normalMoney(row.originalProfitTotal)}</span><span>退款分配：{normalMoney(row.refundedAmountTotal)}</span><span>恢复成本：{normalMoney(row.restockedCostReversal)}</span><span>售后净利润：{normalMoney(row.afterSaleNetProfit)}</span></div><div className="flex flex-wrap gap-2"><Link href={detailLink(row)} className={buttonVariants({ variant: "outline", size: "sm" })}>查看销售明细</Link><Link href={inventoryLink(row)} className={buttonVariants({ variant: "ghost", size: "sm" })}>查看当前库存</Link></div></article>)}</div>
      <div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow><TableHead>商品名</TableHead><TableHead>SKU / 色号</TableHead><TableHead>销售单数</TableHead><TableHead>已售件数</TableHead><TableHead>原利润</TableHead><TableHead>退款分配</TableHead><TableHead>恢复成本</TableHead><TableHead>售后净利润</TableHead><TableHead>退款 / 入库 / 问题件</TableHead><TableHead>最近销售</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{!data || data.items.length === 0 ? <TableRow><TableCell colSpan={11} className="h-24 text-center text-sm text-muted-foreground">暂无数据</TableCell></TableRow> : data.items.map((row) => <TableRow key={`${row.productName}-${row.skuText ?? "empty"}`}><TableCell className="min-w-40 font-medium">{row.productName}</TableCell><TableCell>{row.skuText ?? "未填写"}</TableCell><TableCell>{row.orderCount}</TableCell><TableCell>{row.soldItemCount}</TableCell><TableCell>{normalMoney(row.originalProfitTotal)}</TableCell><TableCell>{normalMoney(row.refundedAmountTotal)}</TableCell><TableCell>{normalMoney(row.restockedCostReversal)}</TableCell><TableCell>{normalMoney(row.afterSaleNetProfit)}</TableCell><TableCell>{row.refundedItemCount} / {row.restockedItemCount} / {row.problemReturnedItemCount}</TableCell><TableCell>{dateText(row.lastSoldAt)}</TableCell><TableCell className="min-w-52"><Link href={detailLink(row)} className={buttonVariants({ variant: "ghost", size: "sm" })}>销售明细</Link><Link href={inventoryLink(row)} className={buttonVariants({ variant: "ghost", size: "sm" })}>当前库存</Link></TableCell></TableRow>)}</TableBody></Table></div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">第 {data?.pagination.page ?? 1} / {data?.pagination.totalPages ?? 0} 页</p><div className="flex gap-2"><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!canPrev || loading} onClick={() => load(page - 1)}><ChevronLeft />上一页</button><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!canNext || loading} onClick={() => load(page + 1)}><ChevronRight />下一页</button></div></div>
    </CardContent></Card>}
  </div>;
}
