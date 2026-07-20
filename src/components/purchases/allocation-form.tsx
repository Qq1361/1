"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, PencilLine, Save } from "lucide-react";
import { toast } from "sonner";
import { AllocationBadge } from "./status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiError } from "@/types/purchase";

type Summary = {
  orderId: string;
  orderNo: string;
  totalAmount: string;
  shippingAmount: string;
  paidTotal: string;
  allocatedTotal: string;
  difference: string;
  totalQuantity: number;
  perUnitAverage: string | null;
  allocationVersion: string;
  isBalanced: boolean;
  allocationStatus: "UNALLOCATED" | "DRAFT" | "CONFIRMED";
  items: {
    id: string;
    name: string;
    quantity: number;
    allocatedTotalCost: string | null;
  }[];
};

type EqualPreview = {
  orderId: string;
  totalAmount: string;
  totalQuantity: number;
  perUnitAverage: string;
  allocationVersion: string;
  allocations: {
    itemId: string;
    quantity: number;
    allocatedTotalCost: string;
  }[];
};

function toCents(value: string): bigint {
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return 0n;
  const [whole, decimals = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
}

function formatCents(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function AllocationForm({ orderId }: { orderId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [equalPreviewVersion, setEqualPreviewVersion] = useState<string | null>(null);
  const [equalOverwriteOpen, setEqualOverwriteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/purchase-orders/${orderId}/allocation`);
        if (!response.ok) {
          const err = await response.json().catch(() => ({ message: "加载成本分摊信息失败" }));
          if (!cancelled) setError(err.message || "加载成本分摊信息失败");
          return;
        }
        const data = await response.json() as Summary;
        if (!cancelled) {
          setSummary(data);
          setError(null);
          setValues(
            Object.fromEntries(
              data.items.map((item) => [item.id, item.allocatedTotalCost ?? ""]),
            ),
          );
        }
      } catch {
        if (!cancelled) setError("网络异常，加载成本分摊信息失败，请检查网络后重试。");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [orderId]);

  const clientSummary = useMemo(() => {
    if (!summary) return null;
    const paid = toCents(summary.paidTotal);
    const allocated = Object.values(values).reduce(
      (total, value) => total + toCents(value),
      0n,
    );
    const complete = summary.items.every((item) =>
      /^\d+(\.\d{1,2})?$/.test(values[item.id] ?? ""),
    );
    return {
      allocated: formatCents(allocated),
      difference: formatCents(paid - allocated),
      balanced: complete && paid === allocated,
    };
  }, [summary, values]);

  async function applyEqualPreview() {
    setPending(true);
    try {
      const response = await fetch(
        `/api/purchase-orders/${orderId}/allocation/equal-preview`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => null) as EqualPreview | ApiError | null;
      if (!response.ok || !data) {
        toast.error((data as ApiError | null)?.message || "平均分摊计算失败，请稍后重试。");
        return;
      }
      const preview = data as EqualPreview;
      setValues(
        Object.fromEntries(
          preview.allocations.map((item) => [item.itemId, item.allocatedTotalCost]),
        ),
      );
      setEqualPreviewVersion(preview.allocationVersion);
      setDraftDirty(true);
      setEqualOverwriteOpen(false);
      toast.success("已按实际商品件数填入平均分摊，请检查后保存或确认。");
    } catch {
      toast.error("网络异常，平均分摊计算失败，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  }

  function requestEqualPreview() {
    const hasManualValues = summary?.items.some(
      (item) => (values[item.id] ?? "").trim() !== "",
    );
    if (hasManualValues) {
      setEqualOverwriteOpen(true);
      return;
    }
    void applyEqualPreview();
  }

  async function submit(action: "save" | "confirm" | "reopen") {
    setPending(true);
    try {
      const response = await fetch(
        `/api/purchase-orders/${orderId}/allocation`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            allocations:
              action === "reopen"
                ? []
                : summary?.items.map((item) => ({
                    itemId: item.id,
                    allocatedTotalCost: values[item.id] || null,
                  })),
            expectedAllocationVersion:
              action === "reopen" ? undefined : equalPreviewVersion ?? undefined,
          }),
        },
      );
      let data: Summary | ApiError;
      try {
        data = await response.json();
      } catch {
        toast.error("服务器返回数据异常，请重试。");
        return;
      }
      if (!response.ok) {
        toast.error((data as ApiError).message || "保存失败");
        return;
      }
      const nextSummary = data as Summary;
      setSummary(nextSummary);
      setValues(
        Object.fromEntries(
          nextSummary.items.map((item) => [item.id, item.allocatedTotalCost ?? ""]),
        ),
      );
      setEqualPreviewVersion(null);
      setDraftDirty(false);
      toast.success(
        action === "confirm"
          ? "成本分摊已确认"
          : action === "reopen"
            ? "已重新进入编辑"
            : "分摊草稿已保存",
      );
    } catch {
      toast.error("网络异常，保存失败，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4 py-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => { setError(null); setSummary(null); }}
          >
            重试
          </button>
          <Link href={`/purchases/${orderId}`} className={buttonVariants()}>
            返回订单
          </Link>
        </div>
      </div>
    );
  }

  if (!summary || !clientSummary) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (summary.items.length === 0) {
    return (
      <div className="space-y-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">该订单没有商品明细，无法进行成本分摊。</p>
        <Link href={`/purchases/${orderId}`} className={buttonVariants()}>
          返回订单
        </Link>
      </div>
    );
  }

  const confirmed = summary.allocationStatus === "CONFIRMED";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Link href={`/purchases/${orderId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ArrowLeft />
            返回订单
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">成本分摊</h1>
            <AllocationBadge status={summary.allocationStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            订单 {summary.orderNo}
          </p>
        </div>
        {confirmed ? (
          <Button variant="outline" onClick={() => submit("reopen")}>
            <PencilLine />
            修改分摊
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["待分摊总金额", summary.paidTotal],
          ["已分摊", clientSummary.allocated],
          ["差额", clientSummary.difference],
        ].map(([label, value]) => (
          <Card key={label} className="rounded-lg shadow-none">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-semibold">¥ {value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="rounded-lg shadow-none">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">商品行数 / 实际商品总件数</p>
            <p className="mt-1 text-xl font-semibold">
              {summary.items.length} 行 / {summary.totalQuantity} 件
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-none">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">平均单件成本</p>
            <p className="mt-1 text-xl font-semibold">¥ {summary.perUnitAverage ?? "—"}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="text-base">商品成本</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {summary.items.map((item, index) => (
            <div
              key={item.id}
              className="grid gap-3 border-b pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_220px] sm:items-end"
            >
              <div>
                <p className="text-sm font-medium">
                  {index + 1}. {item.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  数量 {item.quantity}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`allocation-${item.id}`}>分摊总成本</Label>
                <Input
                  id={`allocation-${item.id}`}
                  inputMode="decimal"
                  value={values[item.id] ?? ""}
                  disabled={confirmed}
                  onChange={(event) => {
                    setDraftDirty(true);
                    setValues((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }));
                  }}
                  placeholder="0.00"
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {!confirmed ? (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background/95 py-4 backdrop-blur sm:flex-row sm:justify-end">
          <div className="mr-auto flex items-center text-sm text-muted-foreground">
            {draftDirty ? "当前分摊有未保存修改" : "平均分摊按实际商品件数计算"}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={requestEqualPreview}
            disabled={pending}
          >
            一键平均分摊
          </Button>
          <Button
            variant="outline"
            onClick={() => submit("save")}
            disabled={pending}
          >
            <Save />
            保存草稿
          </Button>
          <Button
            onClick={() => submit("confirm")}
            disabled={pending || !clientSummary.balanced}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            确认分摊
          </Button>
        </div>
      ) : null}

      <AlertDialog open={equalOverwriteOpen} onOpenChange={setEqualOverwriteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖当前分摊金额？</AlertDialogTitle>
            <AlertDialogDescription>
              平均分摊将覆盖当前未确认的手工分摊金额，是否继续？不会自动保存或确认分摊。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => void applyEqualPreview()}>
              继续平均分摊
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
