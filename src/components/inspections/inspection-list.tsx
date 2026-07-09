"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    const response = await fetch(`/api/inspections?${params}`);
    setResult(await response.json());
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

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
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {!result ? (
        <Skeleton className="h-40" />
      ) : result.data.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {result.data.map((inspection) => (
            <Card key={inspection.id} className="rounded-lg shadow-none">
              <CardContent className="flex items-center justify-between gap-4 p-4">
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
                <Button
                  size="sm"
                  render={<Link href={`/inspections/${inspection.id}`} />}
                >
                  开始验货
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">
          当前没有待验货商品
        </div>
      )}
    </div>
  );
}
