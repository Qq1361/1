"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Clock3,
  Plus,
  ReceiptText,
  Timer,
  Truck,
} from "lucide-react";
import { AllocationBadge, PurchaseStatusBadge } from "@/components/purchases/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type ListResponse = {
  data: {
    id: string;
    orderNo: string;
    sellerNickname: string | null;
    status: string;
    allocationStatus: "UNALLOCATED" | "DRAFT" | "CONFIRMED";
    paidAt: string;
    _count: { items: number };
  }[];
  total: number;
};

type TodoType =
  | "MISSING_TRACKING"
  | "LOGISTICS_EXCEPTION"
  | "LOGISTICS_STALLED"
  | "PENDING_INSPECTION"
  | "DISTANCE_TO_395_WITHIN_7_DAYS"
  | "EXPIRY_UNDER_395"
  | "EXPIRY_UNDER_365"
  | "OVERSTOCKED"
  | "NINETY_FIVE_EXPIRY_UNDER_90"
  | "NINETY_FIVE_EXPIRY_UNDER_60";

type TodosResponse = {
  data: {
    id: string;
    type: TodoType;
    orderId: string;
    orderNo: string;
    title: string;
    description: string;
    targetPath?: string;
  }[];
  counts: {
    missingTracking: number;
    logisticsIssues: number;
    pendingInspection: number;
    distanceTo395Within7Days: number;
    expiryUnder395: number;
    expiryUnder365: number;
    overstocked: number;
    ninetyFiveUnder90: number;
    ninetyFiveUnder60: number;
  };
};

export default function Home() {
  const [orders, setOrders] = useState<ListResponse | null>(null);
  const [todos, setTodos] = useState<TodosResponse | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/purchase-orders?pageSize=5").then((response) => response.json()),
      fetch("/api/todos").then((response) => response.json()),
    ]).then(([orderData, todoData]) => {
      setOrders(orderData);
      setTodos(todoData);
    });
  }, []);

  const cards = [
    { label: "采购订单", value: orders?.total, icon: ReceiptText, href: "/purchases" },
    { label: "超48小时未填单号", value: todos?.counts.missingTracking, icon: Truck, href: "/purchases?todo=missingTracking" },
    { label: "物流异常 / 停滞", value: todos?.counts.logisticsIssues, icon: AlertTriangle, href: "/purchases?todo=logisticsIssues" },
    { label: "待验货", value: todos?.counts.pendingInspection, icon: ClipboardCheck, href: "/inspections" },
    { label: "距395天不足7天", value: todos?.counts.distanceTo395Within7Days, icon: Timer, href: "/inventory?reminder=EXPIRY_UNDER_395" },
    { label: "效期低于395天", value: todos?.counts.expiryUnder395, icon: AlertTriangle, href: "/inventory?reminder=EXPIRY_UNDER_395" },
    { label: "效期低于365天", value: todos?.counts.expiryUnder365, icon: AlertTriangle, href: "/inventory?reminder=EXPIRY_UNDER_365" },
    { label: "95分效期接近限制", value: todos?.counts.ninetyFiveUnder90, icon: Timer, href: "/inventory?reminder=EXPIRY_UNDER_395" },
    { label: "95分效期低于60天", value: todos?.counts.ninetyFiveUnder60, icon: AlertTriangle, href: "/inventory?reminder=EXPIRY_UNDER_365" },
    { label: "入库满 3 天", value: todos?.counts.overstocked, icon: Clock3, href: "/inventory?reminder=STOCKED_OVER_3_DAYS" },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">日常处理</p>
          <h1 className="text-2xl font-semibold">工作台</h1>
        </div>
        <Link href="/purchases/new" className={buttonVariants()}>
          <Plus /> 新建采购订单
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, href }) => (
          <Link key={label} href={href}>
            <Card className="rounded-lg shadow-none transition-colors hover:bg-muted/30">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-semibold">{value ?? "—"}</p>
                </div>
                <Icon className="size-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="rounded-lg shadow-none">
        <CardHeader><CardTitle className="text-base">待办中心</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!todos ? (
            <Skeleton className="h-16" />
          ) : todos.data.length ? (
            todos.data.map((todo) => (
              <Link
                key={todo.id}
                href={todo.targetPath ?? `/purchases/${todo.orderId}`}
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
              当前没有待办
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg shadow-none">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">最近采购订单</CardTitle>
          <Link href="/purchases" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            查看全部 <ArrowRight />
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {!orders ? (
            <Skeleton className="h-16" />
          ) : orders.data.length ? (
            orders.data.map((order) => (
              <Link
                key={order.id}
                href={`/purchases/${order.id}`}
                className="flex flex-col gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium">{order.orderNo}</p>
                  <p className="text-xs text-muted-foreground">
                    {order.sellerNickname ? `卖家：${order.sellerNickname} · ` : ""}
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
