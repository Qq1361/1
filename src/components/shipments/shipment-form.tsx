"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export function ShipmentForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
interface AvailItem { id: string; name: string; inventoryCode: string; skuText: string | null; unitCost: string; saleMode: string; storageLocation: string | null; itemStatus: string; }
  const [availableItems, setAvailableItems] = useState<AvailItem[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [form, setForm] = useState({
    platform: "DEWU",
    purpose: "DEWU_LIGHTNING_INBOUND",
    carrierCode: "",
    trackingNo: "",
    shippedAt: new Date().toISOString().slice(0, 16),
    note: "",
  });

  useEffect(() => {
    fetch("/api/inventory?itemStatus=STOCKED&pageSize=100")
      .then(r => r.json())
      .then(d => setAvailableItems(d.data || []));
  }, []);

  function toggleItem(id: string) {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIds.size === 0) { setError("请至少选择一件库存。"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          itemIds: [...selectedIds],
        }),
      });
      if (!r.ok) { const err = await r.json(); setError(err.message); return; }
      const batch = await r.json();
      toast.success("寄送批次已创建");
      router.push(`/shipments/${batch.id}`);
    } catch { setError("网络异常，请重试。"); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/shipments" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft />返回寄送批次</Link>
      <div><h1 className="text-2xl font-semibold">新建寄送批次</h1></div>

      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div> : null}

      <form onSubmit={submit} className="space-y-5">
        <Card>
          <CardHeader><CardTitle className="text-base">批次信息</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>平台</Label>
              <select className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}>
                <option value="DEWU">得物</option><option value="NINETY_FIVE">95分</option><option value="OTHER">其他</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>寄送目的</Label>
              <select className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}>
                <option value="DEWU_LIGHTNING_INBOUND">得物闪电入仓</option>
                <option value="DEWU_STANDARD_FULFILLMENT">得物普通寄送</option>
                <option value="NINETY_FIVE_INBOUND">95分寄送</option>
                <option value="OTHER">其他</option>
              </select>
            </div>
            <div className="space-y-2"><Label>快递公司</Label><Input value={form.carrierCode} onChange={e => setForm({ ...form, carrierCode: e.target.value })} placeholder="SF" /></div>
            <div className="space-y-2"><Label>快递单号</Label><Input value={form.trackingNo} onChange={e => setForm({ ...form, trackingNo: e.target.value })} /></div>
            <div className="space-y-2"><Label>发货时间</Label><Input type="datetime-local" value={form.shippedAt} onChange={e => setForm({ ...form, shippedAt: e.target.value })} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>备注</Label><Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">选择库存（{selectedIds.size} 件已选）</CardTitle>
          </CardHeader>
          <CardContent>
            {!availableItems ? <Skeleton className="h-40" /> : availableItems.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">没有可用的本地库存</p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {availableItems.map(item => (
                  <div key={item.id} className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${selectedIds.has(item.id) ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`} onClick={() => toggleItem(item.id)}>
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.inventoryCode} · {item.skuText || "无SKU"} · ¥{item.unitCost} · {item.saleMode === "NONE" ? "未选择" : item.saleMode}</p>
                      {item.storageLocation ? <p className="text-xs text-muted-foreground">库位：{item.storageLocation}</p> : null}
                    </div>
                    <Badge variant={selectedIds.has(item.id) ? "default" : "outline"}>{selectedIds.has(item.id) ? "已选" : "可选"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="sticky bottom-0 flex justify-end border-t bg-background/95 py-4 backdrop-blur">
          <button type="submit" className={buttonVariants({ size: "lg" })} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
            {submitting ? "正在创建" : "创建寄送批次"}
          </button>
        </div>
      </form>
    </div>
  );
}
