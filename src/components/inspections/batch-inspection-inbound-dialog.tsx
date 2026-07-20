"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Location = { id: string; name: string; isActive: boolean };
type Warehouse = { id: string; name: string; isActive: boolean; locations: Location[] };
type PreparedItem = {
  inspectionId: string;
  sequence: number;
  productName: string;
  sku: string | null;
  purchaseOrderNo: string;
  sellerNickname: string | null;
  productionDate: string | null;
  shelfLifeMonths: number | null;
  expiryDate: string | null;
};
type Draft = {
  sku: string;
  warehouseId: string;
  storageLocationId: string;
  condition: string;
  saleMode: string | null;
  productionDate: string;
  shelfLifeMonths: string;
  expiryDate: string;
  note: string;
  shelfLifeChangeReason: string;
};

const conditions = [
  ["NEW", "全新"],
  ["LIKE_NEW", "近全新"],
  ["LIGHTLY_USED", "轻微使用"],
  ["USED", "已使用"],
  ["FLAWED", "瑕疵"],
] as const;
const saleModes = [
  ["NONE", "暂不规划"],
  ["DEWU_LIGHTNING", "得物闪电"],
  ["DEWU_STANDARD", "得物普通"],
  ["NINETY_FIVE", "95分"],
  ["XIANYU", "闲鱼"],
  ["OTHER", "其他"],
] as const;

const emptyDraft = (item: PreparedItem): Draft => ({
  sku: item.sku ?? "",
  warehouseId: "",
  storageLocationId: "",
  condition: "",
  saleMode: null,
  productionDate: item.productionDate ?? "",
  shelfLifeMonths: item.shelfLifeMonths?.toString() ?? "",
  expiryDate: item.expiryDate ?? "",
  note: "",
  shelfLifeChangeReason: "",
});

function hasShelfLifeChange(item: PreparedItem, draft: Draft) {
  return item.productionDate !== (draft.productionDate || null)
    || item.shelfLifeMonths !== (draft.shelfLifeMonths ? Number(draft.shelfLifeMonths) : null)
    || item.expiryDate !== (draft.expiryDate || null);
}

export function BatchInspectionInboundDialog({
  open,
  inspectionIds,
  onOpenChange,
  onCompleted,
  onRefreshRequired,
}: {
  open: boolean;
  inspectionIds: string[];
  onOpenChange: (open: boolean) => void;
  onCompleted: (processedCount: number) => Promise<void>;
  onRefreshRequired: () => Promise<void>;
}) {
  const [prepared, setPrepared] = useState<PreparedItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [common, setCommon] = useState<Pick<Draft, "warehouseId" | "storageLocationId" | "condition" | "saleMode" | "note">>({ warehouseId: "", storageLocationId: "", condition: "", saleMode: null, note: "" });
  const [appliedCommonNote, setAppliedCommonNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  const commonLocations = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === common.warehouseId)?.locations ?? [],
    [common.warehouseId, warehouses],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      setLoading(true);
      setRefreshRequired(false);
      setErrors({});
      setConfirming(false);
      setCommon({ warehouseId: "", storageLocationId: "", condition: "", saleMode: null, note: "" });
      setAppliedCommonNote("");
      try {
        const response = await fetch("/api/inspections/batch-pass/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inspectionIds }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message || "无法读取最新待验货资料");
        if (!active) return;
        const preparedPayload = payload as { items: PreparedItem[]; warehouses: Warehouse[] };
        setPrepared(preparedPayload.items);
        setWarehouses(preparedPayload.warehouses);
        setDrafts(Object.fromEntries(preparedPayload.items.map((item) => [item.inspectionId, emptyDraft(item)])));
        setExpanded(Object.fromEntries(preparedPayload.items.map((item, index) => [item.inspectionId, index === 0])));
      } catch (error) {
        if (!active) return;
        setRefreshRequired(true);
        toast.error(error instanceof Error ? error.message : "选中记录已变化，请刷新列表。");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [inspectionIds, open]);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => {
      const draft = current[id];
      const next = { ...draft, ...patch };
      if (patch.warehouseId !== undefined && patch.warehouseId !== draft.warehouseId) {
        const valid = warehouses.find((warehouse) => warehouse.id === patch.warehouseId)?.locations.some((location) => location.id === draft.storageLocationId);
        if (!valid) next.storageLocationId = "";
      }
      return { ...current, [id]: next };
    });
  }

  function applyCommon() {
    if (common.warehouseId && !common.storageLocationId) {
      setErrors({ common: "请选择要应用的标准库位。" });
      return;
    }
    setDrafts((current) => Object.fromEntries(prepared.map((item) => [item.inspectionId, {
      ...current[item.inspectionId],
      warehouseId: common.warehouseId || current[item.inspectionId].warehouseId,
      storageLocationId: common.storageLocationId || current[item.inspectionId].storageLocationId,
      condition: common.condition || current[item.inspectionId].condition,
      saleMode: common.saleMode ?? current[item.inspectionId].saleMode,
      note: common.note || current[item.inspectionId].note,
    }])));
    setAppliedCommonNote(common.note);
    setErrors({});
    toast.success("公共资料已应用到全部选中商品，仍可逐件调整。");
  }

  function validate() {
    const next: Record<string, string> = {};
    for (const item of prepared) {
      const draft = drafts[item.inspectionId];
      if (!draft.warehouseId || !draft.storageLocationId || !draft.condition) {
        next[item.inspectionId] = "仓库、库位和成色均为必填项。";
      } else if (hasShelfLifeChange(item, draft) && !draft.shelfLifeChangeReason.trim()) {
        next[item.inspectionId] = "保质期资料与采购录入不一致，请说明实物修正依据。";
      }
    }
    setErrors(next);
    if (Object.keys(next).length) {
      setExpanded((current) => ({ ...current, ...Object.fromEntries(Object.keys(next).map((id) => [id, true])) }));
      return false;
    }
    return true;
  }

  async function submit() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/inspections/batch-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commonNote: appliedCommonNote.trim() || null,
          items: prepared.map((item) => {
            const draft = drafts[item.inspectionId];
            return {
              inspectionId: item.inspectionId,
              sku: draft.sku.trim() || null,
              warehouseId: draft.warehouseId,
              storageLocationId: draft.storageLocationId,
              condition: draft.condition,
              saleMode: draft.saleMode,
              productionDate: draft.productionDate || null,
              shelfLifeMonths: draft.shelfLifeMonths ? Number(draft.shelfLifeMonths) : null,
              expiryDate: draft.expiryDate || null,
              note: draft.note.trim() === appliedCommonNote.trim() ? null : draft.note.trim() || null,
              shelfLifeChangeReason: draft.shelfLifeChangeReason.trim() || null,
            };
          }),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "批量验货并入库失败");
      setConfirming(false);
      onOpenChange(false);
      await onCompleted(payload.processedCount);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量验货并入库失败");
    } finally {
      setSubmitting(false);
    }
  }

  return <>
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl" showCloseButton={!submitting}>
        <DialogHeader className="border-b px-4 py-4 pr-12">
          <DialogTitle>批量验货并入库</DialogTitle>
          <DialogDescription>共 {inspectionIds.length} 件。先核对入库资料，确认后将分别创建独立库存。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-4 py-4">
          {loading ? <p className="py-10 text-center text-sm text-muted-foreground">正在读取最新资料…</p> : null}
          {refreshRequired ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"><p className="font-medium">选中记录已变化，请刷新列表后重试。</p><Button className="mt-3 min-h-11" variant="outline" onClick={() => void onRefreshRequired()}>刷新列表</Button></div> : null}
          {!loading && !refreshRequired ? <div className="space-y-5">
            <section className="rounded-lg border bg-muted/30 p-3 sm:p-4">
              <div className="mb-3"><h3 className="font-medium">应用于全部选中商品</h3><p className="mt-1 text-xs text-muted-foreground">不会立即保存；确认“应用到全部”后才会覆盖对应的逐件草稿字段。</p></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="仓库"><select className="h-11 w-full rounded-md border bg-background px-3" value={common.warehouseId} onChange={(event) => setCommon((current) => ({ ...current, warehouseId: event.target.value, storageLocationId: "" }))}><option value="">选择仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></Field>
                <Field label="标准库位"><select className="h-11 w-full rounded-md border bg-background px-3 disabled:bg-muted" disabled={!common.warehouseId} value={common.storageLocationId} onChange={(event) => setCommon((current) => ({ ...current, storageLocationId: event.target.value }))}><option value="">选择库位</option>{commonLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
                <Field label="成色"><select className="h-11 w-full rounded-md border bg-background px-3" value={common.condition} onChange={(event) => setCommon((current) => ({ ...current, condition: event.target.value }))}><option value="">选择成色</option>{conditions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                <Field label="计划出售方式"><select className="h-11 w-full rounded-md border bg-background px-3" value={common.saleMode ?? ""} onChange={(event) => setCommon((current) => ({ ...current, saleMode: event.target.value || null }))}><option value="">不覆盖</option>{saleModes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                <Field label="公共备注"><Input value={common.note} onChange={(event) => setCommon((current) => ({ ...current, note: event.target.value }))} placeholder="可选" /></Field>
              </div>
              {errors.common ? <p className="mt-2 text-sm text-destructive">{errors.common}</p> : null}
              <Button type="button" className="mt-3 min-h-11" variant="outline" onClick={applyCommon}>应用到全部</Button>
            </section>
            <section className="space-y-3">
              <div><h3 className="font-medium">逐件确认</h3><p className="mt-1 text-xs text-muted-foreground">逐件修改优先于公共资料。SKU 允许留空，但需核对货架期和入库位置。</p></div>
              {prepared.map((item) => {
                const draft = drafts[item.inspectionId];
                if (!draft) return null;
                const locations = warehouses.find((warehouse) => warehouse.id === draft.warehouseId)?.locations ?? [];
                const shelfChanged = hasShelfLifeChange(item, draft);
                const itemError = errors[item.inspectionId];
                return <article key={item.inspectionId} className="rounded-lg border bg-card">
                  <button type="button" className="flex min-h-12 w-full items-start justify-between gap-3 p-3 text-left" onClick={() => setExpanded((current) => ({ ...current, [item.inspectionId]: !current[item.inspectionId] }))} aria-expanded={Boolean(expanded[item.inspectionId])}>
                    <span className="min-w-0"><span className="block break-words font-medium">{item.productName}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{item.purchaseOrderNo} · {item.sellerNickname || "未填写卖家"} · SKU：{draft.sku || "未填写"}</span><span className="mt-1 block text-xs text-muted-foreground">生产：{draft.productionDate || "—"} · 到期：{draft.expiryDate || "—"}</span></span>
                    {expanded[item.inspectionId] ? <ChevronUp className="mt-1 size-4 shrink-0" /> : <ChevronDown className="mt-1 size-4 shrink-0" />}
                  </button>
                  {expanded[item.inspectionId] ? <div className="space-y-3 border-t p-3">
                    {itemError ? <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive" role="alert">{itemError}</p> : null}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="SKU"><Input value={draft.sku} onChange={(event) => updateDraft(item.inspectionId, { sku: event.target.value })} placeholder="可留空" /></Field>
                      <Field label="仓库 *"><select className="h-11 w-full rounded-md border bg-background px-3" aria-invalid={!draft.warehouseId} value={draft.warehouseId} onChange={(event) => updateDraft(item.inspectionId, { warehouseId: event.target.value })}><option value="">选择仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></Field>
                      <Field label="标准库位 *"><select className="h-11 w-full rounded-md border bg-background px-3 disabled:bg-muted" aria-invalid={!draft.storageLocationId} disabled={!draft.warehouseId} value={draft.storageLocationId} onChange={(event) => updateDraft(item.inspectionId, { storageLocationId: event.target.value })}><option value="">选择库位</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
                      <Field label="成色 *"><select className="h-11 w-full rounded-md border bg-background px-3" aria-invalid={!draft.condition} value={draft.condition} onChange={(event) => updateDraft(item.inspectionId, { condition: event.target.value })}><option value="">选择成色</option>{conditions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                      <Field label="计划出售方式"><select className="h-11 w-full rounded-md border bg-background px-3" value={draft.saleMode ?? ""} onChange={(event) => updateDraft(item.inspectionId, { saleMode: event.target.value || null })}><option value="">不规划</option>{saleModes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                      <Field label="生产日期"><Input type="date" value={draft.productionDate} onChange={(event) => updateDraft(item.inspectionId, { productionDate: event.target.value })} /></Field>
                      <Field label="保质期（月）"><Input type="number" min="1" max="600" value={draft.shelfLifeMonths} onChange={(event) => updateDraft(item.inspectionId, { shelfLifeMonths: event.target.value })} /></Field>
                      <Field label="到期日期"><Input type="date" value={draft.expiryDate} onChange={(event) => updateDraft(item.inspectionId, { expiryDate: event.target.value })} /></Field>
                    </div>
                    <Field label="单件备注"><Textarea value={draft.note} onChange={(event) => updateDraft(item.inspectionId, { note: event.target.value })} placeholder="可选；将写入验货备注审计" /></Field>
                    {shelfChanged ? <Field label="实物修正依据 *"><Textarea aria-invalid={!draft.shelfLifeChangeReason.trim()} value={draft.shelfLifeChangeReason} onChange={(event) => updateDraft(item.inspectionId, { shelfLifeChangeReason: event.target.value })} placeholder="以实物包装标注为准" /><p className="mt-1 text-xs text-destructive">保质期资料与采购录入不一致，请说明实物修正依据。</p></Field> : null}
                  </div> : null}
                </article>;
              })}
            </section>
          </div> : null}
        </div>
        {!loading && !refreshRequired ? <DialogFooter className="sticky bottom-0"><Button variant="outline" className="min-h-11" disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button><Button className="min-h-11" disabled={submitting} onClick={() => validate() && setConfirming(true)}>{submitting ? "处理中…" : "确认验货并入库"}</Button></DialogFooter> : null}
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirming} onOpenChange={(next) => !submitting && setConfirming(next)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认验货并入库？</AlertDialogTitle><AlertDialogDescription>将创建 {prepared.length} 件独立 InventoryItem。请确认仓库、库位、成色、SKU 和保质期资料均已核对；此操作不会创建销售、发货或写入 SOLD。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={submitting}>返回检查</AlertDialogCancel><AlertDialogAction disabled={submitting} onClick={() => void submit()}>{submitting ? "处理中…" : "确认验货并入库"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
