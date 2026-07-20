"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Search, Wrench } from "lucide-react";
import { toast } from "sonner";
import { BatchInspectionInboundDialog } from "@/components/inspections/batch-inspection-inbound-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Row = {
  id: string;
  sequence: number;
  status: string;
  currentStep: number;
  purchaseOrderItem: {
    name: string;
    skuText: string | null;
    quantity: number;
    purchaseOrder: { orderNo: string; sellerNickname: string | null };
  };
};

export function InspectionList() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [result, setResult] = useState<{ data: Row[]; missingCount: number; page: number; pageSize: number; total: number; totalPages: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const response = await fetch(`/api/inspections?${params}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || "待验货数据加载失败");
    setResult(payload);
  }, [page, pageSize, query]);

  useEffect(() => {
    const timer = setTimeout(() => void load().catch((error) => toast.error(error instanceof Error ? error.message : "待验货数据加载失败")), 200);
    return () => clearTimeout(timer);
  }, [load]);

  function toggleSelection(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...current, id] : current.filter((value) => value !== id));
  }

  async function ensure() {
    const response = await fetch("/api/inspections/ensure-pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) { toast.error(payload?.message || "补建待验货记录失败"); return; }
    toast.success("历史待验货记录已补建");
    await load();
  }

  const busy = batchDialogOpen;
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm text-muted-foreground">收货处理</p><h1 className="text-2xl font-semibold">待验货</h1></div>{result?.missingCount ? <Button variant="outline" className="min-h-11" onClick={ensure}><Wrench />补建历史待验货（{result.missingCount}）</Button> : null}</div>
    <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="搜索采购订单号、商品、SKU 或卖家昵称" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); setSelectedIds([]); }} /></div>
    {!result ? <Skeleton className="h-40" /> : result.data.length ? <>
      <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-5 accent-primary" checked={selectedIds.length === result.data.length} onChange={(event) => setSelectedIds(event.target.checked ? result.data.map((item) => item.id) : [])} disabled={busy} />全选当前页</label>
        <div className="flex min-h-11 items-center justify-between gap-3 sm:justify-end"><span className="text-sm text-muted-foreground">已选择 {selectedIds.length} 件</span><Button className="min-h-11" disabled={selectedIds.length === 0 || busy} onClick={() => setBatchDialogOpen(true)}><Check />批量验货通过</Button></div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">{result.data.map((inspection) => <Card key={inspection.id} className="rounded-lg shadow-none"><CardContent className="flex items-center justify-between gap-4 p-4"><label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center" aria-label={`选择 ${inspection.purchaseOrderItem.name}`}><input type="checkbox" className="size-5 accent-primary" checked={selectedIds.includes(inspection.id)} onChange={(event) => toggleSelection(inspection.id, event.target.checked)} disabled={busy} /></label><div className="min-w-0"><p className="truncate text-sm font-medium">{inspection.purchaseOrderItem.name}</p><p className="text-xs text-muted-foreground">{inspection.purchaseOrderItem.purchaseOrder.orderNo} · 第 {inspection.sequence}/{inspection.purchaseOrderItem.quantity} 件</p><p className="break-words text-xs text-muted-foreground">卖家：{inspection.purchaseOrderItem.purchaseOrder.sellerNickname || "—"}</p><p className="text-xs text-muted-foreground">{inspection.purchaseOrderItem.skuText || "无 SKU"} · 步骤 {inspection.currentStep}/6</p></div><Link href={`/inspections/${inspection.id}`} className={buttonVariants({ size: "sm", className: busy ? "pointer-events-none opacity-50" : "" })} aria-disabled={busy}>开始验货</Link></CardContent></Card>)}</div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">共 {result.total} 件待验货商品</p><div className="flex items-center justify-between gap-2 sm:justify-end"><select className="h-11 rounded-md border bg-background px-3 text-sm" aria-label="每页待验货数量" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); setSelectedIds([]); }}><option value={20}>每页 20 件</option><option value={50}>每页 50 件</option></select><Button variant="outline" disabled={page <= 1 || busy} onClick={() => { setPage((current) => current - 1); setSelectedIds([]); }}>上一页</Button><span className="whitespace-nowrap text-sm text-muted-foreground">{page} / {result.totalPages || 1}</span><Button variant="outline" disabled={page >= result.totalPages || busy} onClick={() => { setPage((current) => current + 1); setSelectedIds([]); }}>下一页</Button></div></div>
    </> : <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">当前没有待验货商品</div>}
    <BatchInspectionInboundDialog open={batchDialogOpen} inspectionIds={selectedIds} onOpenChange={setBatchDialogOpen} onCompleted={async (processedCount) => { setSelectedIds([]); toast.success(`已批量验货并入库 ${processedCount} 件商品`); await load(); }} onRefreshRequired={async () => { setBatchDialogOpen(false); setSelectedIds([]); await load(); }} />
  </div>;
}
