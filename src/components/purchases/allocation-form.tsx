"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, PencilLine, Save } from "lucide-react";
import { toast } from "sonner";
import { AllocationBadge } from "./status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  isBalanced: boolean;
  allocationStatus: "UNALLOCATED" | "DRAFT" | "CONFIRMED";
  items: {
    id: string;
    name: string;
    quantity: number;
    allocatedTotalCost: string | null;
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

  useEffect(() => {
    fetch(`/api/purchase-orders/${orderId}/allocation`)
      .then((response) => response.json())
      .then((data: Summary) => {
        setSummary(data);
        setValues(
          Object.fromEntries(
            data.items.map((item) => [
              item.id,
              item.allocatedTotalCost ?? "",
            ]),
          ),
        );
      });
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

  async function submit(action: "save" | "confirm" | "reopen") {
    setPending(true);
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
        }),
      },
    );
    const data = (await response.json()) as Summary | ApiError;
    if (!response.ok) {
      toast.error((data as ApiError).message);
      setPending(false);
      return;
    }
    setSummary(data as Summary);
    toast.success(
      action === "confirm"
        ? "成本分摊已确认"
        : action === "reopen"
          ? "已重新进入编辑"
          : "分摊草稿已保存",
    );
    setPending(false);
  }

  if (!summary || !clientSummary) {
    return <Skeleton className="h-96 w-full" />;
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
          ["实付总额", summary.paidTotal],
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
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                  placeholder="0.00"
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {!confirmed ? (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background/95 py-4 backdrop-blur sm:flex-row sm:justify-end">
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
    </div>
  );
}
