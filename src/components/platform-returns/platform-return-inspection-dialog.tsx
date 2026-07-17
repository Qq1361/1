"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Inspection = {
  result: string;
  storageLocation: string | null;
  problemReason: string | null;
  note: string | null;
  inspectedAt: string | null;
} | null;

type Props = {
  open: boolean;
  shipmentLineId: string;
  inspection: Inspection;
  action: "inspectReturn" | "reviseInspection" | "finalizeInspection" | null;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => Promise<void> | void;
};

const resultHelp: Record<string, string> = {
  RESTOCKED: "确认后商品会从“已退回待验货”恢复为“在库”。",
  PROBLEM: "确认后商品会转为“问题件”，不会进入正常可售库存。",
  PENDING_DECISION: "商品继续保持“已退回待验货”，并持续出现在待办中。",
};

function toLocalDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function PlatformReturnInspectionDialog({ open, shipmentLineId, inspection, action, onOpenChange, onCompleted }: Props) {
  const [result, setResult] = useState("PENDING_DECISION");
  const [storageLocation, setStorageLocation] = useState("");
  const [problemReason, setProblemReason] = useState("");
  const [note, setNote] = useState("");
  const [inspectedAt, setInspectedAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setResult(inspection?.result ?? "PENDING_DECISION");
      setStorageLocation(inspection?.storageLocation ?? "");
      setProblemReason(inspection?.problemReason ?? "");
      setNote(inspection?.note ?? "");
      setInspectedAt(toLocalDateTime(inspection?.inspectedAt));
      setError(null);
    });
  }, [open, inspection]);

  async function submit() {
    if (result === "RESTOCKED" && !storageLocation.trim()) {
      setError("可重新入库必须填写入库位置。");
      return;
    }
    if (result === "PROBLEM" && !problemReason.trim() && !note.trim()) {
      setError("问题件必须填写问题原因或备注。");
      return;
    }
    let inspectedAtIso: string | undefined;
    if (inspectedAt) {
      const parsed = new Date(inspectedAt);
      if (Number.isNaN(parsed.getTime())) {
        setError("验货时间无效。");
        return;
      }
      inspectedAtIso = parsed.toISOString();
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform-returns/${shipmentLineId}/inspection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result,
          storageLocation: storageLocation.trim() || undefined,
          problemReason: problemReason.trim() || undefined,
          note: note.trim() || undefined,
          inspectedAt: inspectedAtIso,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message ?? "退回验货保存失败。");
        return;
      }
      toast.success("平台退回验货已保存。");
      onOpenChange(false);
      await onCompleted();
    } catch {
      setError("网络异常，退回验货未保存。");
    } finally {
      setSubmitting(false);
    }
  }

  const title = action === "inspectReturn" ? "登记退回验货" : action === "finalizeInspection" ? "确定最终验货结论" : "修改退回验货";
  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>库存、寄送状态和操作日志均由服务端根据本次验货结论更新。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="platform-return-result">验货结论</Label>
            <select id="platform-return-result" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={result} disabled={submitting} onChange={(event) => setResult(event.target.value)}>
              <option value="RESTOCKED">可重新入库</option>
              <option value="PROBLEM">问题件</option>
              <option value="PENDING_DECISION">待进一步判断</option>
            </select>
            <p className="text-xs text-muted-foreground">{resultHelp[result]}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-return-location">入库位置{result === "RESTOCKED" ? " *" : ""}</Label>
            <Input id="platform-return-location" value={storageLocation} disabled={submitting} onChange={(event) => setStorageLocation(event.target.value)} placeholder="例如 A-01-02" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-return-problem">问题原因</Label>
            <Textarea id="platform-return-problem" value={problemReason} disabled={submitting} onChange={(event) => setProblemReason(event.target.value)} placeholder="问题件请填写原因或在备注说明" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-return-note">备注</Label>
            <Textarea id="platform-return-note" value={note} disabled={submitting} onChange={(event) => setNote(event.target.value)} placeholder="可选" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-return-inspected-at">验货时间</Label>
            <Input id="platform-return-inspected-at" type="datetime-local" value={inspectedAt} disabled={submitting} onChange={(event) => setInspectedAt(event.target.value)} />
          </div>
          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>返回</Button>
          <Button type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? "保存中..." : "保存验货结论"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
