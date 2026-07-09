"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CircleDollarSign,
  ClipboardList,
  Plus,
  ReceiptText,
} from "lucide-react";
import { AllocationBadge, PurchaseStatusBadge } from "@/components/purchases/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type ListResponse = {
  data: {
    id: string;
    orderNo: string;
    status: string;
    allocationStatus: "UNALLOCATED" | "DRAFT" | "CONFIRMED";
    totalAmount: string;
    shippingAmount: string;
    paidAt: string;
    _count: { items: number };
  }[];
  total: number;
};

export default function Home() {
  const [all, setAll] = useState<ListResponse | null>(null);
  const [unallocated, setUnallocated] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/api/purchase-orders?pageSize=5").then((response) =>
        response.json(),
      ),
      fetch(
        "/api/purchase-orders?allocationStatus=UNALLOCATED&pageSize=1",
      ).then((response) => response.json()),
      fetch("/api/purchase-orders?allocationStatus=DRAFT&pageSize=1").then(
        (response) => response.json(),
      ),
    ]).then(([allOrders, pending, draft]) => {
      setAll(allOrders);
      setUnallocated((pending.total ?? 0) + (draft.total ?? 0));
    });
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">采购管理</p>
          <h1 className="text-2xl font-semibold">工作台</h1>
        </div>
        <Button render={<Link href="/purchases/new" />}>
          <Plus />
          新建采购订单
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="rounded-lg shadow-none">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">采购订单</p>
              <p className="mt-1 text-2xl font-semibold">{all?.total ?? "—"}</p>
            </div>
            <ReceiptText className="size-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-none">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">待完成分摊</p>
              <p className="mt-1 text-2xl font-semibold">
                {all ? unallocated : "—"}
              </p>
            </div>
            <CircleDollarSign className="size-5 text-amber-600" />
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-none">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">当前阶段</p>
              <p className="mt-1 text-base font-semibold">采购与成本</p>
            </div>
            <ClipboardList className="size-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg shadow-none">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">最近采购订单</CardTitle>
          <Button variant="ghost" size="sm" render={<Link href="/purchases" />}>
            查看全部
            <ArrowRight />
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {!all ? (
            <>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </>
          ) : all.data.length ? (
            all.data.map((order) => (
              <Link
                key={order.id}
                href={`/purchases/${order.id}`}
                className="flex flex-col gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium">{order.orderNo}</p>
                  <p className="text-xs text-muted-foreground">
                    {order._count.items} 个商品明细 ·{" "}
                    {new Date(order.paidAt).toLocaleDateString("zh-CN")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <PurchaseStatusBadge status={order.status} />
                  <AllocationBadge status={order.allocationStatus} />
                </div>
              </Link>
            ))
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              暂无采购订单
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
