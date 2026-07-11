"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, PackageCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const platformLabels: Record<string, string> = { DEWU: "得物", NINETY_FIVE: "95分", OTHER: "其他" };
const purposeLabels: Record<string, string> = { DEWU_LIGHTNING_INBOUND: "闪电入仓", DEWU_STANDARD_FULFILLMENT: "普通寄送", NINETY_FIVE_INBOUND: "95分寄送", OTHER: "其他" };
const statusLabels: Record<string, string> = { DRAFT: "草稿", SHIPPED: "已发货", RECEIVED: "已签收", PARTIALLY_RECEIVED: "部分签收", PARTIALLY_LISTED: "部分上架", LISTED: "已上架", PARTIALLY_REJECTED: "部分拒收", RETURNING: "退回中", COMPLETED: "已完成", CANCELLED: "已取消" };
const lineStatusLabels: Record<string, string> = { SHIPPED: "已发货", RECEIVED: "平台已签收", IN_WAREHOUSE: "入仓成功", LISTED: "平台已上架/可售", REJECTED: "平台拒收", RETURNING: "退回中", RETURNED: "已退回" };

interface BatchDetail {
  id: string; batchNo: string; platform: string; purpose: string; status: string;
  carrierCode: string | null; trackingNo: string | null;
  shippedAt: string | null; receivedAt: string | null; note: string | null;
  lines: LineDetail[]; groups: { id: string; groupName: string | null }[];
}

interface LineDetail {
  id: string; lineStatus: string; inventoryCodeSnapshot: string;
  productNameSnapshot: string; skuSnapshot: string | null;
  unitCostSnapshot: string; inventoryItemId: string;
  sourcePurchaseOrderId: string; rejectedReason: string | null;
  returnCarrierCode: string | null; returnTrackingNo: string | null;
  returnedStorageLocation: string | null;
  saleModeSnapshot: string;
  group: { groupName: string | null } | null;
  inventoryItem: { purchaseOrderItem: { purchaseOrder: { id: string } } } | null;
}

export function ShipmentDetail({ id }: { id: string }) {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await fetch(`/api/shipments/${id}`);
    setBatch(await r.json());
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/shipments/${id}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setBatch(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  async function markReceived() {
    setPending("received");
    const r = await fetch(`/api/shipments/${id}/mark-received`, { method: "POST" });
    if (r.ok) { toast.success("批次已标记为签收"); await reload(); }
    else toast.error((await r.json()).message);
    setPending(null);
  }

  async function cancelBatch() {
    if (!confirm("确认取消该批次？所有库存将恢复为本地库存。")) return;
    setPending("cancel");
    const r = await fetch(`/api/shipments/${id}/cancel`, { method: "POST" });
    if (r.ok) { toast.success("批次已取消"); await reload(); }
    else toast.error((await r.json()).message);
    setPending(null);
  }

  async function updateLine(lineId: string, body: Record<string, unknown>) {
    setPending(lineId);
    const r = await fetch(`/api/shipments/lines/${lineId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { toast.success("已更新"); await reload(); }
    else toast.error((await r.json()).message);
    setPending(null);
  }

  if (!batch) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-5">
      <Link href="/shipments" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft />返回寄送批次</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{batch.batchNo}</h1>
          <p className="text-sm text-muted-foreground">{platformLabels[batch.platform] ?? batch.platform} · {purposeLabels[batch.purpose] ?? batch.purpose}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary">{statusLabels[batch.status] ?? batch.status}</Badge>
          {["DRAFT", "SHIPPED"].includes(batch.status) ? (
            <Button variant="outline" size="sm" onClick={cancelBatch} disabled={pending !== null}><X />取消批次</Button>
          ) : null}
          {!["RECEIVED", "LISTED", "COMPLETED", "CANCELLED"].includes(batch.status) ? (
            <Button size="sm" onClick={markReceived} disabled={pending !== null}>{pending === "received" ? <Loader2 className="animate-spin" /> : <PackageCheck />}标记整批已签收</Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">批次信息</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="快递公司" text={batch.carrierCode || "未填写"} />
          <Info label="快递单号" text={batch.trackingNo || "未填写"} />
          <Info label="发货时间" text={batch.shippedAt ? new Date(batch.shippedAt).toLocaleString("zh-CN") : "未填写"} />
          <Info label="签收时间" text={batch.receivedAt ? new Date(batch.receivedAt).toLocaleString("zh-CN") : "未签收"} />
          <Info label="备注" text={batch.note || "无"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">库存明细（{batch.lines?.length || 0} 件）</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {batch.lines?.map((line: LineDetail) => (
            <div key={line.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{line.productNameSnapshot}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.inventoryCodeSnapshot} · {line.skuSnapshot || "无SKU"} · 成本 ¥{line.unitCostSnapshot}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    来源订单：{line.sourcePurchaseOrderId ? (
                      <Link href={`/purchases/${line.inventoryItem?.purchaseOrderItem?.purchaseOrder?.id}`} className="underline">查看</Link>
                    ) : "—"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="outline">{lineStatusLabels[line.lineStatus] ?? line.lineStatus}</Badge>
                    {line.group?.groupName ? <span className="text-xs text-muted-foreground">组：{line.group.groupName}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {line.lineStatus === "SHIPPED" ? (
                    <Button size="xs" variant="outline" disabled={pending !== null} onClick={() => updateLine(line.id, { lineStatus: "RECEIVED" })}><Check />平台签收</Button>
                  ) : null}
                  {["SHIPPED", "RECEIVED"].includes(line.lineStatus) ? (
                    <Button size="xs" variant="outline" disabled={pending !== null} onClick={() => updateLine(line.id, { lineStatus: "IN_WAREHOUSE" })}><Check />入仓成功</Button>
                  ) : null}
                  {["SHIPPED", "RECEIVED", "IN_WAREHOUSE"].includes(line.lineStatus) ? (
                    <Button size="xs" variant="outline" disabled={pending !== null} onClick={() => updateLine(line.id, { lineStatus: "LISTED" })}><Check />上架</Button>
                  ) : null}
                  {["SHIPPED", "RECEIVED", "IN_WAREHOUSE", "LISTED"].includes(line.lineStatus) ? (
                    <Button size="xs" variant="outline" disabled={pending !== null} onClick={() => {
                      const reason = prompt("拒收原因："); if (reason !== null) updateLine(line.id, { lineStatus: "REJECTED", rejectedReason: reason });
                    }}><X />拒收</Button>
                  ) : null}
                  {["REJECTED"].includes(line.lineStatus) ? (
                    <Button size="xs" variant="outline" disabled={pending !== null} onClick={() => updateLine(line.id, { lineStatus: "RETURNING", returnCarrierCode: prompt("退回快递公司：") || undefined, returnTrackingNo: prompt("退回单号：") || undefined })}>退回中</Button>
                  ) : null}
                  {["RETURNING"].includes(line.lineStatus) ? (
                    <Button size="xs" variant="outline" disabled={pending !== null} onClick={() => updateLine(line.id, { lineStatus: "RETURNED", returnedStorageLocation: prompt("退回后存放库位：") || undefined })}>已退回</Button>
                  ) : null}
                  {pending === line.id ? <Loader2 className="size-4 animate-spin" /> : null}
                </div>
              </div>
              {line.rejectedReason ? <p className="mt-2 text-xs text-destructive">拒收原因：{line.rejectedReason}</p> : null}
              {line.returnTrackingNo ? <p className="mt-1 text-xs text-muted-foreground">退回快递：{line.returnCarrierCode} {line.returnTrackingNo}</p> : null}
              {line.returnedStorageLocation ? <p className="mt-1 text-xs text-muted-foreground">退回库位：{line.returnedStorageLocation}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, text }: { label: string; text: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1">{text}</p></div>;
}
