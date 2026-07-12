"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { AttachmentUploader } from "@/components/purchases/attachment-uploader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Inspection = {
  id: string;
  sequence: number;
  currentStep: number;
  status: string;
  hasBox: boolean | null;
  capCondition: string | null;
  paintCondition: string | null;
  leakageCondition: string | null;
  isNew: boolean | null;
  hasUsageTrace: boolean | null;
  batchCode: string | null;
  expiryDate: string | null;
  appearanceNotes: string | null;
  notes: string | null;
  result: string | null;
  completedAt: string | null;
  inventoryItem?: { id: string; storageLocation: string | null; itemStatus: string } | null;
  purchaseOrderItem: {
    name: string;
    skuText: string | null;
    quantity: number;
    purchaseOrder: { orderNo: string; allocationStatus: string };
  };
};

export function InspectionWizard({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const isEditMode = searchParams.get("edit") === "true";

  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});

  useEffect(() => {
    fetch(`/api/inspections/${id}`)
      .then((r) => r.json())
      .then((data: Inspection) => {
        setInspection(data);
        setStep(data.currentStep);
        setForm({
          hasBox: data.hasBox,
          capCondition: data.capCondition ?? "",
          paintCondition: data.paintCondition ?? "",
          leakageCondition: data.leakageCondition ?? "",
          isNew: data.isNew,
          hasUsageTrace: data.hasUsageTrace,
          batchCode: data.batchCode ?? "",
          expiryDate: data.expiryDate?.slice(0, 10) ?? "",
          storageLocation: data.inventoryItem?.storageLocation ?? "",
          appearanceNotes: data.appearanceNotes ?? "",
          notes: data.notes ?? "",
          result: data.result ?? undefined,
        });
      });
  }, [id]);

  async function save(nextStep = step) {
    setPending(true);
    const response = await fetch(`/api/inspections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        currentStep: nextStep,
        expiryDate: form.expiryDate
          ? new Date(`${form.expiryDate}T00:00:00+08:00`).toISOString()
          : null,
      }),
    });
    setPending(false);
    if (!response.ok) {
      const error = await response.json();
      toast.error(error.message);
      return false;
    }
    setStep(nextStep);
    return true;
  }

  async function saveEdit() {
    setPending(true);
    const response = await fetch(`/api/inspections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        expiryDate: form.expiryDate
          ? new Date(`${form.expiryDate}T00:00:00+08:00`).toISOString()
          : null,
      }),
    });
    setPending(false);
    if (!response.ok) {
      const error = await response.json();
      toast.error(error.message);
      return;
    }
    toast.success("验货信息已更新");
    // Go back to inventory detail if we have one
    if (inspection?.inventoryItem?.id) {
      window.location.href = `/inventory/${inspection.inventoryItem.id}`;
    }
  }

  async function complete(result: "PASS" | "PROBLEM") {
    setPending(true);
    const response = await fetch(`/api/inspections/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        result,
        expiryDate: form.expiryDate
          ? new Date(`${form.expiryDate}T00:00:00+08:00`).toISOString()
          : null,
      }),
    });
    const data = await response.json();
    setPending(false);
    if (!response.ok) return toast.error(data.message);
    toast.success("验货已完成并生成单件库存");
    window.location.href = `/inventory/${data.inventory.id}`;
  }

  if (!inspection) return <Skeleton className="h-[30rem]" />;
  const set = (key: string, value: unknown) =>
    setForm((current) => ({ ...current, [key]: value }));

  // --------------- EDIT MODE (completed inspection) ---------------
  if (isEditMode && inspection.completedAt) {
    return (
      <div className="mx-auto min-h-[calc(100dvh-4rem)] max-w-2xl space-y-4 py-4">
        <Link
          href={inspection.inventoryItem ? `/inventory/${inspection.inventoryItem.id}` : "/inspections"}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft /> {inspection.inventoryItem ? "返回库存详情" : "返回待验货"}
        </Link>
        <div>
          <p className="text-xs text-muted-foreground">
            编辑已完成验货 · {inspection.purchaseOrderItem.purchaseOrder.orderNo}
          </p>
          <h1 className="text-xl font-semibold">编辑验货信息</h1>
        </div>

        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              {inspection.purchaseOrderItem.name}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                第 {inspection.sequence}/{inspection.purchaseOrderItem.quantity} 件
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Appearance — hasBox + isNew */}
            <BooleanField label="是否有盒" value={form.hasBox} onChange={(v) => set("hasBox", v)} />
            <div className="space-y-2">
              <Label>是否全新</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={form.isNew === true ? "default" : "outline"} onClick={() => { set("isNew", true); set("hasUsageTrace", null); set("capCondition", ""); set("paintCondition", ""); set("leakageCondition", ""); }}>是，全新</Button>
                <Button type="button" variant={form.isNew === false ? "default" : "outline"} onClick={() => set("isNew", false)}>否，不是全新</Button>
              </div>
            </div>
            {/* Usage/flaw fields — only when not new */}
            {form.isNew === false ? (
              <>
                <BooleanField label="是否有使用痕迹" value={form.hasUsageTrace} onChange={(v) => set("hasUsageTrace", v)} />
                {form.hasUsageTrace === true ? (
                  <div className="space-y-2 pl-2 border-l-2 border-muted">
                    <Label className="text-xs">使用痕迹备注（可选）</Label>
                    <Textarea value={String(form.usageTraceNotes ?? "")} onChange={(e) => set("usageTraceNotes", e.target.value)} placeholder="请简单描述使用痕迹" rows={2} />
                  </div>
                ) : null}
                <ConditionYesNo label="是否有盖子" yesLabel="有" noLabel="无" value={form.capCondition} remarkLabel="缺盖备注（可选）" remarkPlaceholder="请说明缺盖情况" form={form} onChange={set} />
                <ConditionYesNo label="是否有掉漆" yesLabel="有" noLabel="无" value={form.paintCondition} remarkLabel="掉漆备注（可选）" remarkPlaceholder="请说明掉漆位置" form={form} onChange={set} reverseRemark />
                <ConditionYesNo label="是否有漏液" yesLabel="有" noLabel="无" value={form.leakageCondition} remarkLabel="漏液备注（可选）" remarkPlaceholder="请说明漏液情况" form={form} onChange={set} reverseRemark />
              </>
            ) : null}
            {/* Batch / expiry / storage */}
            <div className="space-y-2"><Label>批号</Label><Input value={String(form.batchCode ?? "")} onChange={(e) => set("batchCode", e.target.value)} /></div>
            <div className="space-y-2"><Label>效期</Label><Input type="date" value={String(form.expiryDate ?? "")} onChange={(e) => set("expiryDate", e.target.value)} /></div>
            <div className="space-y-2"><Label>库位</Label><Input value={String(form.storageLocation ?? "")} onChange={(e) => set("storageLocation", e.target.value)} placeholder="例如 A箱、B箱、货架1层" /></div>
            {/* Notes */}
            <div className="space-y-2"><Label>外观备注</Label><Textarea value={String(form.appearanceNotes ?? "")} onChange={(e) => set("appearanceNotes", e.target.value)} /></div>
            <div className="space-y-2"><Label>验货备注 / 问题说明</Label><Textarea value={String(form.notes ?? "")} onChange={(e) => set("notes", e.target.value)} /></div>
            {/* Result toggle */}
            <div className="space-y-2">
              <Label>验货结果</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={form.result === "PASS" ? "default" : "outline"} onClick={() => set("result", "PASS")}>通过</Button>
                <Button type="button" variant={form.result === "PROBLEM" ? "destructive" : "outline"} onClick={() => set("result", "PROBLEM")}>问题件</Button>
              </div>
              {form.result !== inspection.result ? (
                <p className="text-xs text-amber-600">
                  {form.result === "PROBLEM"
                    ? "改为问题件后，库存状态将变为 PROBLEM。"
                    : "改为通过后，库存状态将恢复为已入库。"}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (inspection.inventoryItem) {
                window.location.href = `/inventory/${inspection.inventoryItem.id}`;
              }
            }}
          >
            取消
          </Button>
          <Button disabled={pending} onClick={saveEdit}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />}
            保存修改
          </Button>
        </div>
      </div>
    );
  }

  // --------------- NORMAL WIZARD MODE ---------------
  return (
    <div className="mx-auto min-h-[calc(100dvh-4rem)] max-w-2xl space-y-4 py-4">
      <Link href="/inspections" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft /> 返回待验货
      </Link>
      <div>
        <p className="text-xs text-muted-foreground">
          步骤 {step}/6 · {inspection.purchaseOrderItem.purchaseOrder.orderNo}
        </p>
        <h1 className="text-xl font-semibold">手机验货向导</h1>
      </div>
      <Card className="rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="text-base">
            {["确认商品", "是否全新与包装", "瑕疵与使用痕迹", "批号和效期", "验货图片", "备注与结果"][step - 1]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{inspection.purchaseOrderItem.name}</p>
              <p>{inspection.purchaseOrderItem.skuText || "无 SKU"}</p>
              <p>当前第 {inspection.sequence}/{inspection.purchaseOrderItem.quantity} 件</p>
              <p className="text-muted-foreground">
                成本分摊：{inspection.purchaseOrderItem.purchaseOrder.allocationStatus}
              </p>
            </div>
          ) : null}
          {step === 2 ? (
            <>
              <BooleanField label="是否有盒" value={form.hasBox} onChange={(v) => set("hasBox", v)} />
              <div className="space-y-2">
                <Label>是否全新</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant={form.isNew === true ? "default" : "outline"} onClick={() => { set("isNew", true); set("hasUsageTrace", null); set("capCondition", ""); set("paintCondition", ""); set("leakageCondition", ""); }}>是，全新</Button>
                  <Button type="button" variant={form.isNew === false ? "default" : "outline"} onClick={() => set("isNew", false)}>否，不是全新</Button>
                </div>
              </div>
            </>
          ) : null}
          {step === 3 ? (
            <>
              {form.isNew === false ? (
                <>
                  <p className="text-sm text-muted-foreground">商品不是全新，请补充瑕疵/使用情况：</p>
                  <BooleanField label="是否有使用痕迹" value={form.hasUsageTrace} onChange={(v) => set("hasUsageTrace", v)} />
                  {form.hasUsageTrace === true ? (
                    <div className="space-y-2 pl-2 border-l-2 border-muted">
                      <Label className="text-xs">使用痕迹备注（可选）</Label>
                      <Textarea value={String(form.usageTraceNotes ?? "")} onChange={(e) => set("usageTraceNotes", e.target.value)} placeholder="请简单描述使用痕迹" rows={2} />
                    </div>
                  ) : null}
                  <ConditionYesNo label="是否有盖子" yesLabel="有" noLabel="无" value={form.capCondition} remarkLabel="缺盖备注（可选）" remarkPlaceholder="请说明缺盖情况" form={form} onChange={set} />
                  <ConditionYesNo label="是否有掉漆" yesLabel="有" noLabel="无" value={form.paintCondition} remarkLabel="掉漆备注（可选）" remarkPlaceholder="请说明掉漆位置" form={form} onChange={set} reverseRemark />
                  <ConditionYesNo label="是否有漏液" yesLabel="有" noLabel="无" value={form.leakageCondition} remarkLabel="漏液备注（可选）" remarkPlaceholder="请说明漏液情况" form={form} onChange={set} reverseRemark />
                </>
              ) : (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  商品为全新，无需填写使用痕迹、掉漆、漏液等瑕疵信息。
                </div>
              )}
            </>
          ) : null}
          {step === 4 ? (
            <>
              <div className="space-y-2"><Label>批号</Label><Input value={String(form.batchCode ?? "")} onChange={(e) => set("batchCode", e.target.value)} /></div>
              <div className="space-y-2"><Label>效期</Label><Input type="date" value={String(form.expiryDate ?? "")} onChange={(e) => set("expiryDate", e.target.value)} /></div>
              <div className="space-y-2"><Label>库位</Label><Input value={String(form.storageLocation ?? "")} onChange={(e) => set("storageLocation", e.target.value)} placeholder="例如 A箱、B箱、货架1层" /></div>
            </>
          ) : null}
          {step === 5 ? (
            <AttachmentUploader entityType="INSPECTION" entityId={id} initialAttachments={[]} />
          ) : null}
          {step === 6 ? (
            <>
              <div className="space-y-2"><Label>外观备注</Label><Textarea value={String(form.appearanceNotes ?? "")} onChange={(e) => set("appearanceNotes", e.target.value)} /></div>
              <div className="space-y-2"><Label>验货备注 / 问题说明</Label><Textarea value={String(form.notes ?? "")} onChange={(e) => set("notes", e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" disabled={pending} onClick={() => complete("PROBLEM")}>记录问题件</Button>
                <Button disabled={pending} onClick={() => complete("PASS")}><Check />验货通过</Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
      {step < 6 ? (
        <div className="flex justify-between">
          <Button variant="outline" disabled={step === 1 || pending} onClick={() => setStep(step - 1)}><ArrowLeft />上一步</Button>
          <Button disabled={pending} onClick={() => save(step + 1)}>
            {pending ? <Loader2 className="animate-spin" /> : step === 5 ? <Save /> : <ArrowRight />}
            保存并继续
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function BooleanField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: boolean) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={value === true ? "default" : "outline"} onClick={() => onChange(true)}>是</Button>
        <Button type="button" variant={value === false ? "default" : "outline"} onClick={() => onChange(false)}>否</Button>
      </div>
    </div>
  );
}

function ConditionYesNo({
  label, yesLabel, noLabel, value, remarkLabel, remarkPlaceholder, form, onChange, reverseRemark,
}: {
  label: string; yesLabel: string; noLabel: string;
  value: unknown; remarkLabel: string; remarkPlaceholder: string;
  form: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  reverseRemark?: boolean;
}) {
  const key = label.replace(/是否有/, "").replace(/是否/, "");
  const remarkKey = key + "Remark";
  // Detect current state from the stored string
  const raw = String(value ?? "");
  const isYes = raw === "有" || raw === "是" || raw === "true" || raw === "1";
  const isNo = raw === "无" || raw === "否" || raw === "false" || raw === "0" || raw === "";
  const selected = isYes ? "yes" : isNo ? "no" : null;
  const showRemark = reverseRemark ? selected === "no" : selected === "yes";
  const hasLegacyText = raw !== "" && !isYes && !isNo;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={selected === "yes" ? "default" : "outline"} onClick={() => { onChange(key, "有"); onChange(remarkKey, form[remarkKey]); }}>{yesLabel}</Button>
        <Button type="button" variant={selected === "no" ? "default" : "outline"} onClick={() => { onChange(key, "无"); onChange(remarkKey, form[remarkKey]); }}>{noLabel}</Button>
      </div>
      {hasLegacyText ? (
        <p className="text-xs text-amber-600">原记录：{raw}（重新选择后将替换为标准值）</p>
      ) : null}
      {showRemark ? (
        <div className="space-y-1 pl-2 border-l-2 border-muted">
          <Label className="text-xs">{remarkLabel}</Label>
          <Textarea value={String(form[remarkKey] ?? "")} onChange={(e) => onChange(remarkKey, e.target.value)} placeholder={remarkPlaceholder} rows={2} />
        </div>
      ) : null}
    </div>
  );
}
