"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Search, Wrench } from "lucide-react";
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
    purchaseOrder: { orderNo: string };
  };
};

export function InspectionList() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    data: Row[];
    missingCount: number;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batchPending, setBatchPending] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    const response = await fetch(`/api/inspections?${params}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || "待验货数据加载失败");
    setResult(payload);
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load().catch((error) =>
        toast.error(error instanceof Error ? error.message : "待验货数据加载失败"),
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [load]);

  function toggleSelection(inspectionId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...current, inspectionId] : current.filter((id) => id !== inspectionId),
    );
  }

  function toggleSelectCurrentPage(checked: boolean) {
    setSelectedIds(checked ? (result?.data.map((item) => item.id) ?? []) : []);
  }

  async function batchPass() {
    setBatchPending(true);
    try {
      const response = await fetch("/api/inspections/batch-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspectionIds: selectedIds }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "批量验货失败");
      setConfirmBatch(false);
      setSelectedIds([]);
      toast.success(`已批量验货通过 ${payload.processedCount} 件商品`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量验货失败");
    } finally {
      setBatchPending(false);
    }
  }

  async function ensure() {
    const response = await fetch("/api/inspections/ensure-pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) {
      const error = await response.json();
      toast.error(error.message);
      return;
    }
    toast.success("历史待验货记录已补建");
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">收货处理</p>
          <h1 className="text-2xl font-semibold">待验货</h1>
        </div>
        {result?.missingCount ? (
          <Button variant="outline" onClick={ensure}>
            <Wrench />
            补建历史待验货（{result.missingCount}）
          </Button>
        ) : null}
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="搜索订单号、商品名或 SKU"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIds([]);
          }}
        />
      </div>
      {!result ? (
        <Skeleton className="h-40" />
      ) : result.data.length ? (
        <>
          <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={selectedIds.length === result.data.length}
                onChange={(event) => toggleSelectCurrentPage(event.target.checked)}
                disabled={batchPending}
              />
              全选当前页
            </label>
            <div className="flex min-h-11 items-center justify-between gap-3 sm:justify-end">
              <span className="text-sm text-muted-foreground">已选择 {selectedIds.length} 件</span>
              <Button disabled={selectedIds.length === 0 || batchPending} onClick={() => setConfirmBatch(true)}>
                <Check /> 批量验货通过
              </Button>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
          {result.data.map((inspection) => (
            <Card key={inspection.id} className="rounded-lg shadow-none">
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center" aria-label={`选择 ${inspection.purchaseOrderItem.name}`}>
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={selectedIds.includes(inspection.id)}
                    onChange={(event) => toggleSelection(inspection.id, event.target.checked)}
                    disabled={batchPending}
                  />
                </label>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {inspection.purchaseOrderItem.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {inspection.purchaseOrderItem.purchaseOrder.orderNo} · 第{" "}
                    {inspection.sequence}/{inspection.purchaseOrderItem.quantity} 件
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {inspection.purchaseOrderItem.skuText || "无 SKU"} · 步骤{" "}
                    {inspection.currentStep}/6
                  </p>
                </div>
                <Link
                  href={`/inspections/${inspection.id}`}
                  className={buttonVariants({ size: "sm", className: batchPending ? "pointer-events-none opacity-50" : "" })}
                  aria-disabled={batchPending}
                >
                  开始验货
                </Link>
              </CardContent>
            </Card>
          ))}
          </div>
        </>
      ) : (
        <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">
          当前没有待验货商品
        </div>
      )}
      <AlertDialog open={confirmBatch} onOpenChange={(open) => !batchPending && setConfirmBatch(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量验货通过？</AlertDialogTitle>
            <AlertDialogDescription>
              确认将选中的 {selectedIds.length} 件商品验货通过并生成独立库存吗？任一商品无法验货时，整批不会提交。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchPending}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={batchPending} onClick={() => void batchPass()}>
              {batchPending ? "处理中..." : "确认批量验货通过"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
