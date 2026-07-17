"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPlatform } from "@/lib/status-labels";
import { InventoryStatusBadge, ReturnInspectionBadge, ShipmentReturnStatusBadge } from "./platform-return-status-badge";

type Row = {
  shipmentLineId: string; shipmentBatchId: string; batchNumber: string; platform: string; shipmentLineStatus: string;
  inventoryItemId: string; inventoryCode: string; productName: string; sku: string | null; currentItemStatus: string;
  rejectReason: string | null; returnCarrier: string | null; returnTrackingNo: string | null; returnReceivedAt: string | null;
  inspectionResult: string | null; inspectedAt: string | null; availableActions: string[];
};
type Response = { items: Row[]; page: number; pageSize: number; total: number; totalPages: number };
type Bucket = { count: number; assetCost: string };
type Summary = { counts: { returning: number; pendingInspection: number; pendingDecision: number; restocked: number; problem: number; legacyDirectRestock: number; totalReturnCycles: number }; currentAssets: { platformReturning: Bucket; platformPendingInspection: Bucket; platformPendingDecision: Bucket; platformReturnedPending: Bucket; platformReturnProblem: Bucket } };
const categories = [
  ["", "全部退回"], ["RETURNING", "平台退回途中"], ["PENDING_INSPECTION", "已退回待验货"], ["PENDING_DECISION", "待进一步判断"],
] as const;

function date(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN") : "未填写"; }
function emptyText(category: string | null) {
  return category === "RETURNING" ? "暂无平台退回途中的商品" : category === "PENDING_INSPECTION" ? "暂无已退回待验货商品" : category === "PENDING_DECISION" ? "暂无待进一步判断商品" : "暂无平台退回记录";
}

export function PlatformReturnList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const [data, setData] = useState<Response | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const category = query.get("category");

  const load = useCallback(async () => {
    setLoading(true); setError(null); setData(null);
    const params = new URLSearchParams(query);
    const endpoint = category ? "/api/platform-returns/pending" : "/api/platform-returns";
    if (category) {
      const shipmentBatchId = params.get("shipmentBatchId");
      params.delete("shipmentBatchId");
      if (shipmentBatchId) params.set("batchId", shipmentBatchId);
      params.delete("inventoryStatus");
      params.delete("inspectionResult");
      params.delete("pendingOnly");
      params.set("category", category);
    }
    try {
      const [response, summaryResponse] = await Promise.all([
        fetch(`${endpoint}?${params.toString()}`),
        fetch("/api/platform-returns/summary"),
      ]);
      const [body, summaryBody] = await Promise.all([response.json().catch(() => null), summaryResponse.json().catch(() => null)]);
      if (!response.ok) throw new Error(body?.message ?? "平台退回列表加载失败。");
      if (!summaryResponse.ok) throw new Error(summaryBody?.message ?? "平台退回统计加载失败。");
      setData(body);
      setSummary(summaryBody);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "平台退回列表加载失败。");
    } finally { setLoading(false); }
  }, [category, query]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  function update(values: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (resetPage) next.set("page", "1");
    router.replace(`${pathname}?${next.toString()}`);
  }
  const page = Number(query.get("page") || "1");
  const money = (value: string) => `¥${value}`;
  const summaryCards = summary ? [
    ["平台退回途中", summary.counts.returning, summary.currentAssets.platformReturning.assetCost, "/platform-returns?category=RETURNING", "当前资产"],
    ["已退回待验货", summary.counts.pendingInspection, summary.currentAssets.platformPendingInspection.assetCost, "/platform-returns?category=PENDING_INSPECTION", "当前资产"],
    ["待进一步判断", summary.counts.pendingDecision, summary.currentAssets.platformPendingDecision.assetCost, "/platform-returns?category=PENDING_DECISION", "待处理子集"],
    ["已重新入库（历史）", summary.counts.restocked, null, "/platform-returns?inspectionResult=RESTOCKED", "寄送周期"],
    ["问题件（历史）", summary.counts.problem, summary.currentAssets.platformReturnProblem.assetCost, "/platform-returns?inspectionResult=PROBLEM", "当前问题资产"],
    ["退回待处理资产", summary.currentAssets.platformReturnedPending.count, summary.currentAssets.platformReturnedPending.assetCost, "/platform-returns?pendingOnly=true", "含待进一步判断，不重复加总"],
  ] as const : [];

  return <div className="space-y-5" data-testid="platform-return-list">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-sm text-muted-foreground">寄送平台后的退回处理</p><h1 className="text-2xl font-semibold">平台退回</h1></div>
      <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />刷新</Button>
    </div>
    <p className="text-sm text-muted-foreground">平台已上架 / 可售不等于已售出。退回验货结论与当前库存状态分别展示。</p>
    {summary ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="platform-return-summary">{summaryCards.map(([label, count, cost, href, hint]) => <Link key={label} href={href}><Card className="h-full rounded-lg shadow-none transition-colors hover:bg-muted/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{count} 件</p>{cost ? <p className="mt-1 text-xs text-muted-foreground">资产成本 {money(cost)}</p> : null}<p className="mt-1 text-xs text-muted-foreground">{hint}</p></CardContent></Card></Link>)}</div> : null}
    <Card className="rounded-lg shadow-none"><CardContent className="grid gap-3 p-4 md:grid-cols-4">
      <div className="relative md:col-span-2"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input className="pl-9" defaultValue={query.get("keyword") ?? ""} placeholder="库存编号、商品、SKU、批次号或退回单号" onKeyDown={(event) => { if (event.key === "Enter") update({ keyword: event.currentTarget.value.trim() || null }); }} /></div>
      <select className="h-9 rounded-md border bg-background px-3 text-sm" value={query.get("platform") ?? ""} onChange={(event) => update({ platform: event.target.value || null })}><option value="">全部平台</option><option value="DEWU">得物</option><option value="NINETY_FIVE">95分</option><option value="OTHER">其他</option></select>
      <select disabled={Boolean(category)} className="h-9 rounded-md border bg-background px-3 text-sm disabled:opacity-50" value={query.get("inventoryStatus") ?? ""} onChange={(event) => update({ inventoryStatus: event.target.value || null })}><option value="">全部当前库存状态</option><option value="RETURNING">平台退回途中</option><option value="RETURNED">已退回待验货</option><option value="STOCKED">在库</option><option value="PROBLEM">问题件</option></select>
      <select disabled={Boolean(category)} className="h-9 rounded-md border bg-background px-3 text-sm disabled:opacity-50" value={query.get("inspectionResult") ?? ""} onChange={(event) => update({ inspectionResult: event.target.value || null })}><option value="">全部验货结论</option><option value="RESTOCKED">可重新入库</option><option value="PROBLEM">问题件</option><option value="PENDING_DECISION">待进一步判断</option></select>
      <Input value={query.get("shipmentBatchId") ?? ""} placeholder="寄送批次 ID" onChange={(event) => update({ shipmentBatchId: event.target.value.trim() || null })}/>
      <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm"><input disabled={Boolean(category)} type="checkbox" checked={query.get("pendingOnly") === "true"} onChange={(event) => update({ pendingOnly: event.target.checked ? "true" : null })}/>仅看待处理</label>
      <select className="h-9 rounded-md border bg-background px-3 text-sm" value={String(query.get("pageSize") ?? "20")} onChange={(event) => update({ pageSize: event.target.value })}><option value="20">每页 20 条</option><option value="50">每页 50 条</option><option value="100">每页 100 条</option></select>
    </CardContent></Card>
    <div className="flex flex-wrap gap-2">{categories.map(([value, label]) => <Link key={value} href={`/platform-returns${value ? `?category=${value}` : ""}`} className={buttonVariants({ variant: category === value || (!category && !value) ? "secondary" : "outline", size: "sm" })}>{label}</Link>)}</div>
    {loading ? <Skeleton className="h-96" /> : error ? <Card className="rounded-lg shadow-none"><CardContent className="space-y-3 py-12 text-center"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => void load()}>重试</Button></CardContent></Card> : !data?.items.length ? <Card className="rounded-lg shadow-none"><CardContent className="py-16 text-center text-sm text-muted-foreground">{emptyText(category)}</CardContent></Card> : <>
      <div className="space-y-3 md:hidden">{data.items.map((row) => <ReturnCard key={row.shipmentLineId} row={row}/>)}</div>
      <Card className="hidden overflow-x-auto rounded-lg shadow-none md:block"><CardContent className="p-0"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr><th className="p-3">库存 / 商品</th><th className="p-3">平台 / 批次</th><th className="p-3">寄送历史</th><th className="p-3">当前库存</th><th className="p-3">退回信息</th><th className="p-3">验货结论</th><th className="p-3"/></tr></thead><tbody>{data.items.map((row) => <tr key={row.shipmentLineId} className="border-b last:border-0 hover:bg-muted/20"><td className="p-3"><Link href={`/inventory/${row.inventoryItemId}`} className="font-medium underline">{row.inventoryCode}</Link><p className="mt-1 max-w-52 truncate text-xs text-muted-foreground">{row.productName} · {row.sku ?? "未填写"}</p></td><td className="p-3">{formatPlatform(row.platform)}<br/><Link href={`/shipments/${row.shipmentBatchId}`} className="text-xs underline">{row.batchNumber}</Link></td><td className="p-3"><ShipmentReturnStatusBadge status={row.shipmentLineStatus}/></td><td className="p-3"><InventoryStatusBadge status={row.currentItemStatus}/></td><td className="p-3 text-xs text-muted-foreground">{row.rejectReason ?? "无拒收原因"}<br/>{row.returnCarrier ?? "未填写"} {row.returnTrackingNo ?? ""}<br/>{date(row.returnReceivedAt)}</td><td className="p-3"><ReturnInspectionBadge result={row.inspectionResult}/>{row.inspectedAt ? <p className="mt-1 text-xs text-muted-foreground">{date(row.inspectedAt)}</p> : null}</td><td className="p-3"><Link href={`/platform-returns/${row.shipmentLineId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>查看详情<ExternalLink/></Link></td></tr>)}</tbody></table></CardContent></Card>
      <div className="flex items-center justify-between text-sm"><p className="text-muted-foreground">共 {data.total} 条</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>上一页</Button><Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => update({ page: String(page + 1) }, false)}>下一页</Button></div></div>
    </>}
  </div>;
}

function ReturnCard({ row }: { row: Row }) { return <Card className="rounded-lg shadow-none"><CardContent className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link href={`/platform-returns/${row.shipmentLineId}`} className="font-medium underline">{row.productName}</Link><p className="mt-1 text-xs text-muted-foreground">{row.inventoryCode} · {row.sku ?? "未填写"}</p></div><InventoryStatusBadge status={row.currentItemStatus}/></div><div className="grid grid-cols-2 gap-3 text-xs"><p>平台：{formatPlatform(row.platform)}</p><Link href={`/shipments/${row.shipmentBatchId}`} className="underline">批次：{row.batchNumber}</Link><div><p className="text-muted-foreground">寄送历史</p><ShipmentReturnStatusBadge status={row.shipmentLineStatus}/></div><div><p className="text-muted-foreground">验货结论</p><ReturnInspectionBadge result={row.inspectionResult}/></div></div><Link href={`/platform-returns/${row.shipmentLineId}`} className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>查看退回详情</Link></CardContent></Card>; }
