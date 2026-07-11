"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const saleModeLabels: Record<string, string> = { NONE: "未选择", DEWU_LIGHTNING: "得物闪电", DEWU_STANDARD: "得物普通", NINETY_FIVE: "95分", XIANYU: "闲鱼", OTHER: "其他" };
const dayRanges = [
  { label: "全部", value: "" }, { label: "小于60天", value: "60" }, { label: "小于90天", value: "90" },
  { label: "小于365天", value: "365" }, { label: "365～395天", value: "365-395" }, { label: "大于395天", value: "395+" },
];

interface SearchItem {
  id: string; inventoryCode: string; name: string; skuText: string | null;
  storageLocation: string | null; saleMode: string; itemStatus: string;
  expiryDate: string | null; unitCost: string;
  purchaseOrderItem: { purchaseOrder: { orderNo: string; sellerNickname: string | null } };
}

interface SelectedItem extends SearchItem {
  sourceOrderNo: string; sellerNickname: string | null;
}

export function ShipmentForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [query, setQuery] = useState("");
  const [saleModeFilter, setSaleModeFilter] = useState("");
  const [expiryFilter, setExpiryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<{ data: SearchItem[]; total: number; page: number; totalPages: number } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Selected items - persists across searches
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map());

  const [form, setForm] = useState({
    platform: "DEWU",
    defaultPurpose: "DEWU_LIGHTNING_INBOUND",
    carrierCode: "", trackingNo: "",
    shippedAt: new Date().toISOString().slice(0, 16),
    note: "",
  });

  const search = useCallback(async (q: string, sf: string, ef: string, p: number) => {
    setSearchLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: "20" });
      if (q) params.set("query", q);
      const r = await fetch(`/api/inventory/selectable-for-shipment?${params}`);
      const resp = await r.json();
      let items = resp.data as SearchItem[] | undefined;
      if (sf && items) items = items.filter((i: SearchItem) => i.saleMode === sf);
      if (ef && items) {
        if (ef === "60") items = items.filter((i: SearchItem) => i.expiryDate && daysUntil(i.expiryDate) < 60);
        else if (ef === "90") items = items.filter((i: SearchItem) => i.expiryDate && daysUntil(i.expiryDate) < 90);
        else if (ef === "365") items = items.filter((i: SearchItem) => i.expiryDate && daysUntil(i.expiryDate) < 365);
        else if (ef === "365-395") items = items.filter((i: SearchItem) => { const d = daysUntil(i.expiryDate); return d >= 365 && d <= 395; });
        else if (ef === "395+") items = items.filter((i: SearchItem) => i.expiryDate && daysUntil(i.expiryDate) > 395);
      }
      setResults({ ...resp, data: items || [] });
    } catch { setResults(null); }
    finally { setSearchLoading(false); }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query, saleModeFilter, expiryFilter, page), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, saleModeFilter, expiryFilter, page, search]);

  function daysUntil(d: string | null) { if (!d) return 999; return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000); }

  function toggleItem(item: SearchItem) {
    const itemData: SelectedItem = {
      ...item,
      sourceOrderNo: item.purchaseOrderItem?.purchaseOrder?.orderNo ?? "",
      sellerNickname: item.purchaseOrderItem?.purchaseOrder?.sellerNickname ?? null,
    };
    setSelectedItems(prev => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, itemData);
      return next;
    });
  }

  function selectAllInGroup(orderNo: string) {
    if (!results?.data) return;
    const groupItems = results.data.filter(i => i.purchaseOrderItem?.purchaseOrder?.orderNo === orderNo);
    setSelectedItems(prev => {
      const next = new Map(prev);
      for (const item of groupItems) {
        if (!next.has(item.id)) {
          next.set(item.id, { ...item, sourceOrderNo: orderNo, sellerNickname: item.purchaseOrderItem?.purchaseOrder?.sellerNickname ?? null });
        }
      }
      return next;
    });
  }

  function removeSelected(id: string) {
    setSelectedItems(prev => { const next = new Map(prev); next.delete(id); return next; });
  }

  // Group results by purchase order
  const groupedResults = useMemo(() => {
    if (!results?.data) return [];
    const groups = new Map<string, { orderNo: string; sellerNickname: string | null; items: SearchItem[] }>();
    for (const item of results.data) {
      const on = item.purchaseOrderItem?.purchaseOrder?.orderNo ?? "未知订单";
      if (!groups.has(on)) groups.set(on, { orderNo: on, sellerNickname: item.purchaseOrderItem?.purchaseOrder?.sellerNickname ?? null, items: [] });
      groups.get(on)!.items.push(item);
    }
    return [...groups.values()];
  }, [results]);

  // Selected summary stats
  const selectedStats = useMemo(() => {
    const items = [...selectedItems.values()];
    const totalCost = items.reduce((s, i) => s + parseFloat(i.unitCost ?? "0"), 0);
    const byLocation = new Map<string, number>(); const bySaleMode = new Map<string, number>(); const byOrder = new Map<string, number>();
    for (const i of items) {
      const loc = i.storageLocation || "未填写"; byLocation.set(loc, (byLocation.get(loc) || 0) + 1);
      const sm = i.saleMode || "NONE"; bySaleMode.set(sm, (bySaleMode.get(sm) || 0) + 1);
      const on = i.sourceOrderNo || "未知"; byOrder.set(on, (byOrder.get(on) || 0) + 1);
    }
    return { count: items.length, totalCost, byLocation, bySaleMode, byOrder };
  }, [selectedItems]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedItems.size === 0) { setError("请至少选择一件库存。"); return; }
    setSubmitting(true); setError(null);
    try {
      const r = await fetch("/api/shipments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, itemIds: [...selectedItems.keys()] }) });
      if (!r.ok) { const err = await r.json(); setError(err.message); return; }
      const batch = await r.json();
      toast.success("寄送批次已创建");
      router.push(`/shipments/${batch.id}`);
    } catch { setError("网络异常，请重试。"); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/shipments" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft />返回寄送批次</Link>
      <div><h1 className="text-2xl font-semibold">新建寄送批次</h1></div>
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div> : null}

      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Left column: batch info + search + results */}
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">批次信息</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>平台</Label>
                <select className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}>
                  <option value="DEWU">得物</option><option value="NINETY_FIVE">95分</option><option value="OTHER">其他</option>
                </select>
              </div>
              <div className="space-y-2"><Label>寄送目的</Label>
                <select className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm" value={form.defaultPurpose} onChange={e => setForm({ ...form, defaultPurpose: e.target.value })}>
                  <option value="DEWU_LIGHTNING_INBOUND">得物闪电入仓</option><option value="DEWU_STANDARD_FULFILLMENT">得物普通寄送</option><option value="NINETY_FIVE_INBOUND">95分寄送</option><option value="OTHER">其他</option>
                </select>
              </div>
              <div className="space-y-2"><Label>快递公司</Label><Input value={form.carrierCode} onChange={e => setForm({ ...form, carrierCode: e.target.value })} placeholder="SF" /></div>
              <div className="space-y-2"><Label>快递单号</Label><Input value={form.trackingNo} onChange={e => setForm({ ...form, trackingNo: e.target.value })} /></div>
              <div className="space-y-2"><Label>发货时间</Label><Input type="datetime-local" value={form.shippedAt} onChange={e => setForm({ ...form, shippedAt: e.target.value })} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>备注</Label><Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">选择库存</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Search + Filters */}
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="搜索库存编号、商品名、SKU、库位、采购订单号、卖家昵称" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
                </div>
                <select className="h-8 rounded-lg border bg-background px-2 text-xs" value={saleModeFilter} onChange={e => { setSaleModeFilter(e.target.value); setPage(1); }}>
                  <option value="">全部出售方式</option>
                  {Object.entries(saleModeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select className="h-8 rounded-lg border bg-background px-2 text-xs" value={expiryFilter} onChange={e => { setExpiryFilter(e.target.value); setPage(1); }}>
                  {dayRanges.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>

              {/* Results grouped by purchase order */}
              <div className="max-h-[50vh] space-y-3 overflow-y-auto">
                {searchLoading ? <Skeleton className="h-40" /> : groupedResults.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{query ? "没有匹配的库存" : "没有可用的本地库存"}</p>
                ) : (
                  groupedResults.map(group => (
                    <div key={group.orderNo} className="rounded-lg border">
                      <div className="flex items-center justify-between bg-muted/30 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">{group.orderNo}</p>
                          {group.sellerNickname ? <p className="text-xs text-muted-foreground">卖家：{group.sellerNickname}</p> : null}
                        </div>
                        <Button size="xs" variant="outline" onClick={() => selectAllInGroup(group.orderNo)}>全选该订单</Button>
                      </div>
                      <div className="divide-y">
                        {group.items.map(item => {
                          const isSelected = selectedItems.has(item.id);
                          return (
                            <div key={item.id} className={`flex cursor-pointer items-center justify-between px-3 py-2.5 transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/20"}`} onClick={() => toggleItem(item)}>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{item.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.inventoryCode} · {item.skuText || "无SKU"} · ¥{item.unitCost} · {saleModeLabels[item.saleMode] ?? item.saleMode}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  库位：{item.storageLocation || "未填写"} · 效期：{item.expiryDate ? daysUntil(item.expiryDate) + "天" : "未填写"}
                                </p>
                              </div>
                              <Badge variant={isSelected ? "default" : "outline"} className="shrink-0 ml-2">{isSelected ? "已选" : "可选"}</Badge>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Pagination */}
              {results && results.totalPages > 1 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">共 {results.total} 件</span>
                  <div className="flex gap-1">
                    <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
                    <span className="px-2 py-1">{page}/{results.totalPages}</span>
                    <Button size="xs" variant="outline" disabled={page >= results.totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Right column: selected summary */}
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">已选择摘要</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/30 p-3 text-center">
                  <p className="text-2xl font-bold">{selectedStats.count}</p>
                  <p className="text-xs text-muted-foreground">已选件数</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-3 text-center">
                  <p className="text-2xl font-bold">¥{selectedStats.totalCost.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">总成本</p>
                </div>
              </div>

              {selectedStats.byLocation.size > 0 ? (
                <div><p className="text-xs font-medium text-muted-foreground mb-1">按库位</p>
                  {[...selectedStats.byLocation].map(([k, v]) => <p key={k} className="text-xs">{k}：{v} 件</p>)}
                </div>
              ) : null}
              {selectedStats.bySaleMode.size > 0 ? (
                <div><p className="text-xs font-medium text-muted-foreground mb-1">按出售方式</p>
                  {[...selectedStats.bySaleMode].map(([k, v]) => <p key={k} className="text-xs">{saleModeLabels[k] ?? k}：{v} 件</p>)}
                </div>
              ) : null}
              {selectedStats.byOrder.size > 0 ? (
                <div><p className="text-xs font-medium text-muted-foreground mb-1">按来源订单</p>
                  {[...selectedStats.byOrder].map(([k, v]) => <p key={k} className="text-xs truncate">{k}：{v} 件</p>)}
                </div>
              ) : null}

              {selectedItems.size > 0 ? (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  <p className="text-xs font-medium text-muted-foreground">已选清单</p>
                  {[...selectedItems.values()].map(item => (
                    <div key={item.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{item.name}</p>
                        <p className="text-muted-foreground">{item.inventoryCode} · {item.sourceOrderNo}</p>
                      </div>
                      <button type="button" onClick={() => removeSelected(item.id)} className="ml-1 shrink-0 text-muted-foreground hover:text-destructive"><X className="size-3" /></button>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="sticky top-20">
            <button type="submit" className={buttonVariants({ size: "lg", className: "w-full" })} disabled={submitting || selectedItems.size === 0}>
              {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
              {submitting ? "正在创建" : `创建寄送批次（${selectedItems.size} 件）`}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
