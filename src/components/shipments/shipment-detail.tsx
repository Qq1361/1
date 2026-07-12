"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, PackageCheck, Save, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { getAvailableActions, getActionLabel, type ShipmentLineAction } from "@/lib/shipment-status-machine";
import { formatItemStatus, formatLineStatus, formatBatchStatus, formatPurpose, formatPlatform } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";


interface LineDetail { id: string; lineStatus: string; inventoryCodeSnapshot: string; productNameSnapshot: string; skuSnapshot: string | null; unitCostSnapshot: string; packedChecked: boolean; rejectedReason: string | null; returnCarrierCode: string | null; returnTrackingNo: string | null; returnedStorageLocation: string | null; inventoryItemId: string; inventoryItem: { storageLocation: string | null; purchaseOrderItem: { purchaseOrder: { id: string } } } | null; group: { groupName: string | null; platformOrderNo: string | null } | null; }
interface ActionLog { id: string; createdAt: string; actionType: string; note: string | null; }
interface BatchDetail { id: string; batchNo: string; platform: string; defaultPurpose: string; status: string; carrierCode: string | null; trackingNo: string | null; shippedAt: string | null; receivedAt: string | null; outboundShippingCost: string | null; packagingCost: string | null; otherShipmentCost: string | null; note: string | null; lines: LineDetail[]; actionLogs: ActionLog[]; }
interface LineAction { label: string; fn: () => void; }

export function ShipmentDetail({ id }: { id: string }) {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showShipDialog, setShowShipDialog] = useState(false);
  const [linePending, setLinePending] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [shipForm, setShipForm] = useState<Record<string, string>>({});

  const reload = () => { fetch(`/api/shipments/${id}`).then(r => r.json()).then(setBatch).catch(() => {}); };
  useEffect(() => { reload(); }, [id]);

  function startEditing() {
    if (!batch) return;
    setEditForm({
      platform: batch.platform, defaultPurpose: batch.defaultPurpose,
      carrierCode: batch.carrierCode || "", trackingNo: batch.trackingNo || "",
      shippedAt: batch.shippedAt ? new Date(batch.shippedAt).toISOString().slice(0, 16) : "",
      outboundShippingCost: batch.outboundShippingCost || "", packagingCost: batch.packagingCost || "",
      otherShipmentCost: batch.otherShipmentCost || "", note: batch.note || "",
    });
    setEditing(true);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      const r = await fetch(`/api/shipments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) });
      if (r.ok) { toast.success("批次信息已保存"); setEditing(false); await reload(); }
      else toast.error((await r.json()).message);
    } catch { toast.error("网络异常"); }
    finally { setSaving(false); }
  }

  function startShipping() {
    if (!batch) return;
    const unchecked = batch.lines?.filter(l => !l.packedChecked).length || 0;
    if (unchecked > 0 && !confirm(`还有 ${unchecked} 件库存未核对装箱，是否继续发货？`)) return;
    setShipForm({
      carrierCode: batch.carrierCode || "", trackingNo: batch.trackingNo || "",
      shippedAt: batch.shippedAt ? new Date(batch.shippedAt).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
      outboundShippingCost: batch.outboundShippingCost || "", packagingCost: batch.packagingCost || "",
      otherShipmentCost: batch.otherShipmentCost || "", note: batch.note || "",
    });
    setShowShipDialog(true);
  }

  async function confirmShip() {
    if (!shipForm.carrierCode.trim() || !shipForm.trackingNo.trim()) { toast.error("请填写快递公司和快递单号"); return; }
    setConfirming(true);
    try {
      const needSave = shipForm.carrierCode !== (batch?.carrierCode || "") || shipForm.trackingNo !== (batch?.trackingNo || "");
      if (needSave) await fetch(`/api/shipments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(shipForm) });
      const r = await fetch(`/api/shipments/${id}/confirm-shipped`, { method: "POST" });
      if (r.ok) { toast.success("已确认发货"); setShowShipDialog(false); await reload(); }
      else toast.error((await r.json()).message);
    } catch { toast.error("网络异常"); }
    finally { setConfirming(false); }
  }

  async function updateLine(lineId: string, body: Record<string, unknown>) {
    setLinePending(lineId);
    try {
      const r = await fetch(`/api/shipments/lines/${lineId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) await reload();
      else toast.error((await r.json()).message);
    } catch { toast.error("网络异常"); }
    finally { setLinePending(null); }
  }

  async function removeLine(lineId: string) {
    if (!confirm("确认从草稿移除该库存？")) return;
    setLinePending(lineId);
    try {
      const r = await fetch(`/api/shipments/lines/${lineId}`, { method: "DELETE" });
      if (r.ok) { toast.success("已移除"); await reload(); }
      else toast.error((await r.json()).message);
    } catch { toast.error("网络异常"); }
    finally { setLinePending(null); }
  }

  // Execute state machine action via dedicated API
  async function executeAction(line: LineDetail, action: ShipmentLineAction) {
    setLinePending(line.id);
    try {
      const routeMap: Record<string, string> = {
        markReceived: "mark-received", markInWarehouse: "mark-in-warehouse",
        markListed: "mark-listed", markRejected: "mark-rejected",
        markReturning: "mark-returning", markReturned: "mark-returned",
        confirmRestocked: "confirm-restocked",
      };
      const route = routeMap[action.key];
      if (!route) { toast.error("未知操作"); return; }

      let body: Record<string, unknown> | undefined;
      if (action.key === "markRejected") {
        const reason = prompt("拒收原因（必填）："); if (!reason?.trim()) { toast.error("拒收原因不能为空"); return; }
        body = { rejectedReason: reason.trim() };
      } else if (action.key === "markReturning") {
        const c = prompt("退回快递公司：") || ""; const t = prompt("退回单号：") || "";
        if (!c && !t) { toast.error("请至少填写退回快递公司或退回单号"); return; }
        body = { returnCarrierCode: c || undefined, returnTrackingNo: t || undefined };
      } else if (action.key === "markReturned") {
        const loc = prompt("退回后存放库位（必填）："); if (!loc?.trim()) { toast.error("库位不能为空"); return; }
        body = { returnedStorageLocation: loc.trim() };
      } else if (action.key === "confirmRestocked") {
        const loc = prompt("重新入库库位（必填）："); if (!loc?.trim()) { toast.error("库位不能为空"); return; }
        body = { storageLocation: loc.trim() };
      }

      const r = await fetch(`/api/shipments/lines/${line.id}/${route}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.ok) { toast.success(action.label); await reload(); }
      else toast.error((await r.json()).message);
    } catch { toast.error("网络异常"); }
    finally { setLinePending(null); }
  }

  function getLineActions(l: LineDetail): LineAction[] {
    const actions: LineAction[] = [];
    if (l.lineStatus === "DRAFT") {
      actions.push({ label: l.packedChecked ? "取消核对" : "核对装箱", fn: () => updateLine(l.id, { packedChecked: !l.packedChecked }) });
      actions.push({ label: "移除", fn: () => removeLine(l.id) });
      return actions;
    }
    const purpose = batch!.defaultPurpose;
    for (const action of getAvailableActions(l.lineStatus, purpose)) {
      const label = getActionLabel(action.key, purpose);
      actions.push({ label, fn: () => executeAction(l, action) });
    }
    return actions;
  }

  if (!batch) return <Skeleton className="h-96 w-full" />;

  const isDraft = batch.status === "DRAFT";
  const totalCost = (parseFloat(batch.outboundShippingCost ?? "0") + parseFloat(batch.packagingCost ?? "0") + parseFloat(batch.otherShipmentCost ?? "0")).toFixed(2);

  return (
    <div className="space-y-5">
      <Link href="/shipments" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft />返回寄送批次</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold">{batch.batchNo}</h1><p className="text-sm text-muted-foreground">{formatPlatform(batch.platform)} · {formatPurpose(batch.defaultPurpose)}</p></div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{formatBatchStatus(batch.status)}</Badge>
          {isDraft ? <Button size="sm" onClick={startShipping}><Truck />确认发货</Button> : null}
          {isDraft ? <Button variant="outline" size="sm" onClick={() => { if (confirm("确认取消批次？")) { fetch(`/api/shipments/${id}/cancel`, { method: "POST" }).then(async r => { if (r.ok) { toast.success("已取消"); reload(); } else { const d = await r.json(); toast.error(d.message); } }).catch(() => toast.error("网络异常")); } }}><X />取消批次</Button> : null}
          {["SHIPPED", "PARTIALLY_RECEIVED"].includes(batch.status) ? <Button size="sm" variant="outline" onClick={() => { fetch(`/api/shipments/${id}/mark-received`, { method: "POST" }).then(async r => { if (r.ok) { toast.success("整批已签收"); reload(); } else { const d = await r.json(); toast.error(d.message); } }).catch(() => toast.error("网络异常")); }}><PackageCheck />整批签收</Button> : null}
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">批次信息</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => editing ? setEditing(false) : startEditing()}><Pencil className="size-3.5" />{editing ? "取消编辑" : "编辑批次信息"}</Button>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {isDraft ? (<>
                <div className="space-y-1"><Label className="text-xs">平台</Label><select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={editForm.platform} onChange={e => setEditForm({ ...editForm, platform: e.target.value })}><option value="DEWU">得物</option><option value="NINETY_FIVE">95分</option><option value="OTHER">其他</option></select></div>
                <div className="space-y-1"><Label className="text-xs">寄送目的</Label><select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={editForm.defaultPurpose} onChange={e => setEditForm({ ...editForm, defaultPurpose: e.target.value })}><option value="DEWU_LIGHTNING_INBOUND">得物闪电入仓</option><option value="DEWU_STANDARD_FULFILLMENT">得物普通寄送</option><option value="NINETY_FIVE_INBOUND">95分寄送</option><option value="OTHER">其他</option></select></div>
              </>) : null}
              <div className="space-y-1"><Label className="text-xs">快递公司</Label><Input value={editForm.carrierCode} onChange={e => setEditForm({ ...editForm, carrierCode: e.target.value })} placeholder="SF" /></div>
              <div className="space-y-1"><Label className="text-xs">快递单号</Label><Input value={editForm.trackingNo} onChange={e => setEditForm({ ...editForm, trackingNo: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">发货时间</Label><Input type="datetime-local" value={editForm.shippedAt} onChange={e => setEditForm({ ...editForm, shippedAt: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">发往平台运费</Label><Input value={editForm.outboundShippingCost} onChange={e => setEditForm({ ...editForm, outboundShippingCost: e.target.value })} placeholder="0.00" /></div>
              <div className="space-y-1"><Label className="text-xs">包材成本</Label><Input value={editForm.packagingCost} onChange={e => setEditForm({ ...editForm, packagingCost: e.target.value })} placeholder="0.00" /></div>
              <div className="space-y-1"><Label className="text-xs">其他寄送成本</Label><Input value={editForm.otherShipmentCost} onChange={e => setEditForm({ ...editForm, otherShipmentCost: e.target.value })} placeholder="0.00" /></div>
              <div className="space-y-1 sm:col-span-2"><Label className="text-xs">备注</Label><Input value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} /></div>
              <div className="flex gap-2 sm:col-span-2"><Button size="sm" onClick={saveEdit} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />}保存</Button><Button size="sm" variant="outline" onClick={() => setEditing(false)}>取消</Button></div>
            </div>
          ) : (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label="快递公司" text={batch.carrierCode || "未填写"} /><Info label="快递单号" text={batch.trackingNo || "未填写"} />
              <Info label="发货时间" text={batch.shippedAt ? new Date(batch.shippedAt).toLocaleString("zh-CN") : "未发货"} />
              <Info label="签收时间" text={batch.receivedAt ? new Date(batch.receivedAt).toLocaleString("zh-CN") : "未签收"} />
              <Info label="发往平台运费" text={batch.outboundShippingCost ? `¥${batch.outboundShippingCost}` : "未填写"} /><Info label="包材成本" text={batch.packagingCost ? `¥${batch.packagingCost}` : "未填写"} />
              <Info label="其他寄送成本" text={batch.otherShipmentCost ? `¥${batch.otherShipmentCost}` : "未填写"} />
              <Info label="寄送成本合计" text={`¥${totalCost}`} extra="仅记录，暂不计入利润" />
              <Info label="备注" text={batch.note || "无"} />
            </div>
          )}
        </CardContent>
      </Card>

      {showShipDialog ? (
        <Card className="border-primary">
          <CardHeader><CardTitle className="text-base">确认发货信息</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">快递公司 *</Label><Input value={shipForm.carrierCode} onChange={e => setShipForm({ ...shipForm, carrierCode: e.target.value })} placeholder="SF" /></div>
              <div className="space-y-1"><Label className="text-xs">快递单号 *</Label><Input value={shipForm.trackingNo} onChange={e => setShipForm({ ...shipForm, trackingNo: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">发货时间</Label><Input type="datetime-local" value={shipForm.shippedAt} onChange={e => setShipForm({ ...shipForm, shippedAt: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">发往平台运费</Label><Input value={shipForm.outboundShippingCost} onChange={e => setShipForm({ ...shipForm, outboundShippingCost: e.target.value })} placeholder="0.00" /></div>
              <div className="space-y-1"><Label className="text-xs">包材成本</Label><Input value={shipForm.packagingCost} onChange={e => setShipForm({ ...shipForm, packagingCost: e.target.value })} placeholder="0.00" /></div>
              <div className="space-y-1"><Label className="text-xs">其他寄送成本</Label><Input value={shipForm.otherShipmentCost} onChange={e => setShipForm({ ...shipForm, otherShipmentCost: e.target.value })} placeholder="0.00" /></div>
              <div className="space-y-1 sm:col-span-2"><Label className="text-xs">备注</Label><Input value={shipForm.note} onChange={e => setShipForm({ ...shipForm, note: e.target.value })} /></div>
            </div>
            <div className="mt-4 flex gap-2"><Button size="sm" onClick={confirmShip} disabled={confirming}>{confirming ? <Loader2 className="animate-spin" /> : <Truck />}确认发货</Button><Button size="sm" variant="outline" onClick={() => setShowShipDialog(false)}>取消</Button></div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-base">库存明细（{batch.lines?.length || 0} 件）</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {batch.lines?.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">暂无库存</p> : null}
          {batch.lines?.map((line) => {
            const actions = getLineActions(line);
            return (
              <div key={line.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{line.productNameSnapshot}</p>
                      <Badge variant="outline">{formatLineStatus(line.lineStatus)}</Badge>
                      {line.packedChecked ? <Badge variant="default" className="text-[10px]">已核对</Badge> : isDraft ? <Badge variant="outline" className="text-[10px]">未核对</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{line.inventoryCodeSnapshot} · {line.skuSnapshot || "无SKU"} · ¥{line.unitCostSnapshot}</p>
                    {line.inventoryItem?.purchaseOrderItem?.purchaseOrder ? (
                      <p className="text-xs text-muted-foreground">来源：<Link href={`/purchases/${line.inventoryItem.purchaseOrderItem.purchaseOrder.id}`} className="underline">查看订单</Link> · 库位：{line.inventoryItem.storageLocation || "未填写"}</p>
                    ) : null}
                    {line.group?.groupName ? <p className="text-xs">组：{line.group.groupName}{line.group.platformOrderNo ? ` · 平台单号：${line.group.platformOrderNo}` : ""}</p> : null}
                    {line.rejectedReason ? <p className="text-xs text-destructive">拒收：{line.rejectedReason}</p> : null}
                    {line.returnTrackingNo ? <p className="text-xs text-muted-foreground">退回：{line.returnCarrierCode} {line.returnTrackingNo} · 库位：{line.returnedStorageLocation}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {actions.map((a) => (
                      <Button key={a.label} size="xs" variant="outline" disabled={linePending !== null} onClick={a.fn}>{a.label}</Button>
                    ))}
                    {linePending === line.id ? <Loader2 className="size-4 animate-spin" /> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {batch.actionLogs?.length > 0 ? (
        <Card><CardHeader><CardTitle className="text-base">操作日志</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {batch.actionLogs.slice(0, 30).map((log) => (<div key={log.id}>{new Date(log.createdAt).toLocaleString("zh-CN")} · {log.actionType}{log.note ? ` · ${log.note}` : ""}</div>))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Info({ label, text, extra }: { label: string; text: string; extra?: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1">{text}</p>{extra ? <p className="text-xs text-muted-foreground">{extra}</p> : null}</div>;
}
