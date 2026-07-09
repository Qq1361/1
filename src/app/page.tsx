"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  AlertTriangle,
  ClipboardCheck,
  Plus,
  ReceiptText,
  Truck,
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

type TodosResponse = {
  data: {
    id: string;
    type:
      | "MISSING_TRACKING"
      | "LOGISTICS_EXCEPTION"
      | "LOGISTICS_STALLED"
      | "PENDING_INSPECTION";
    severity: "info" | "warning" | "critical";
    orderId: string;
    orderNo: string;
    title: string;
    description: string;
    occurredAt: string;
  }[];
  counts: {
    missingTracking: number;
    logisticsIssues: number;
    pendingInspection: number;
  };
};

export default function Home() {
  const [all, setAll] = useState<ListResponse | null>(null);
  const [todos, setTodos] = useState<TodosResponse | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/purchase-orders?pageSize=5").then((response) =>
        response.json(),
      ),
      fetch("/api/todos").then((response) => response.json()),
    ]).then(([allOrders, todoData]) => {
      setAll(allOrders);
      setTodos(todoData);
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <p className="text-xs text-muted-foreground">待填快递单号</p>
              <p className="mt-1 text-2xl font-semibold">
                {todos?.counts.missingTracking ?? "—"}
              </p>
            </div>
            <Truck className="size-5 text-amber-600" />
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-none">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">物流异常 / 停滞</p>
              <p className="mt-1 text-2xl font-semibold">
                {todos?.counts.logisticsIssues ?? "—"}
              </p>
            </div>
            <AlertTriangle className="size-5 text-red-600" />
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-none">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">已签收待验货</p>
              <p className="mt-1 text-2xl font-semibold">
                {todos?.counts.pendingInspection ?? "—"}
              </p>
            </div>
            <ClipboardCheck className="size-5 text-emerald-700" />
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="text-base">物流待办</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!todos ? (
            <Skeleton className="h-16" />
          ) : todos.data.length ? (
            todos.data.map((todo) => (
              <Link
                key={todo.id}
                href={`/purchases/${todo.orderId}`}
                className="flex items-center justify-between gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/40"
              >
                <div>
                  <p className="text-sm font-medium">{todo.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {todo.orderNo} · {todo.description}
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              当前没有物流待办
            </div>
          )}
        </CardContent>
      </Card>

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
