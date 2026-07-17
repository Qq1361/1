"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  BellOff,
  CalendarClock,
  ChevronDown,
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
  | "NINETY_FIVE_EXPIRY_UNDER_60"
  | "PLATFORM_RETURNING"
  | "PLATFORM_RETURNED_PENDING_INSPECTION"
  | "PLATFORM_RETURN_PENDING_DECISION";

type TodosResponse = {
  data: {
    id: string;
    type: TodoType;
    orderId: string;
    orderNo: string;
    inventoryId?: string;
    inspectionId?: string;
    title: string;
    description: string;
    reasonKey: string;
    primaryAction: { label: string; href: string };
    secondaryActions?: { label: string; href: string }[];
  }[];
  counts: {
    missingTracking: number;
    logisticsIssues: number;
    pendingInspection: number;
    distanceTo395Within7Days: number;
    expiryUnder395: number;
    distanceTo365Within10Days: number;
    expiryUnder365: number;
    overstocked: number;
    ninetyFiveUnder90: number;
    ninetyFiveUnder60: number;
    platformReturning: number;
    platformReturnedPendingInspection: number;
    platformReturnPendingDecision: number;
  };
};

type PlatformReturnSummary = {
  counts: {
    returning: number;
    pendingInspection: number;
    pendingDecision: number;
  };
};

const EMPTY_TODO_COUNTS: TodosResponse["counts"] = {
  missingTracking: 0,
  logisticsIssues: 0,
  pendingInspection: 0,
  distanceTo395Within7Days: 0,
  expiryUnder395: 0,
  distanceTo365Within10Days: 0,
  expiryUnder365: 0,
  overstocked: 0,
  ninetyFiveUnder90: 0,
  ninetyFiveUnder60: 0,
  platformReturning: 0,
  platformReturnedPendingInspection: 0,
  platformReturnPendingDecision: 0,
};

function isListResponse(value: unknown): value is ListResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<ListResponse>;
  return Array.isArray(candidate.data) && typeof candidate.total === "number";
}

function isTodosResponse(value: unknown): value is TodosResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<TodosResponse>;
  return Array.isArray(candidate.data) && Boolean(candidate.counts) && typeof candidate.counts === "object";
}

function isPlatformReturnSummary(value: unknown): value is PlatformReturnSummary {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<PlatformReturnSummary>;
  return Boolean(candidate.counts) && typeof candidate.counts === "object";
}

export default function Home() {
  const [orders, setOrders] = useState<ListResponse | null>(null);
  const [todos, setTodos] = useState<TodosResponse | null>(null);
  const [platformReturnSummary, setPlatformReturnSummary] = useState<PlatformReturnSummary | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/purchase-orders?pageSize=5").then((response) => response.json()),
      fetch("/api/todos").then((response) => response.json()),
      fetch("/api/platform-returns/summary").then(async (response) => response.ok ? response.json() : null),
    ])
      .then(([orderData, todoData, returnSummary]) => {
        setOrders(isListResponse(orderData) ? orderData : null);
        setTodos(isTodosResponse(todoData) ? todoData : null);
        setPlatformReturnSummary(isPlatformReturnSummary(returnSummary) ? returnSummary : null);
      })
      .catch(() => {
        setOrders(null);
        setTodos(null);
        setPlatformReturnSummary(null);
      });
  }, []);

  const todoCounts = todos?.counts ?? EMPTY_TODO_COUNTS;

  const cards = [
    { label: "采购订单", value: orders?.total, icon: ReceiptText, href: "/purchases" },
    { label: "超48小时未填单号", value: todoCounts.missingTracking, icon: Truck, href: "/purchases?todo=missingTracking" },
    { label: "物流异常 / 停滞", value: todoCounts.logisticsIssues, icon: AlertTriangle, href: "/purchases?todo=logisticsIssues" },
    { label: "待验货", value: todoCounts.pendingInspection, icon: ClipboardCheck, href: "/inspections" },
    { label: "距395天不足7天", value: todoCounts.distanceTo395Within7Days, icon: Timer, href: "/inventory?reminder=DISTANCE_TO_395_WITHIN_7_DAYS" },
    { label: "效期低于395天", value: todoCounts.expiryUnder395, icon: AlertTriangle, href: "/inventory?reminder=EXPIRY_UNDER_395" },
    { label: "距365天不足10天", value: todoCounts.distanceTo365Within10Days, icon: Timer, href: "/inventory?reminder=DISTANCE_TO_365_WITHIN_10_DAYS" },
    { label: "效期低于365天", value: todoCounts.expiryUnder365, icon: AlertTriangle, href: "/inventory?reminder=EXPIRY_UNDER_365" },
    { label: "95分效期接近限制", value: todoCounts.ninetyFiveUnder90, icon: Timer, href: "/inventory?reminder=NINETY_FIVE_EXPIRY_UNDER_90" },
    { label: "95分效期低于60天", value: todoCounts.ninetyFiveUnder60, icon: AlertTriangle, href: "/inventory?reminder=NINETY_FIVE_EXPIRY_UNDER_60" },
    { label: "入库满 3 天", value: todoCounts.overstocked, icon: Clock3, href: "/inventory?reminder=STOCKED_OVER_3_DAYS" },
    { label: "平台退回途中", value: platformReturnSummary?.counts.returning ?? todoCounts.platformReturning, icon: Truck, href: "/platform-returns?category=RETURNING" },
    { label: "已退回待验货", value: platformReturnSummary?.counts.pendingInspection ?? todoCounts.platformReturnedPendingInspection, icon: ClipboardCheck, href: "/platform-returns?category=PENDING_INSPECTION" },
    { label: "待进一步判断", value: platformReturnSummary?.counts.pendingDecision ?? todoCounts.platformReturnPendingDecision, icon: AlertTriangle, href: "/platform-returns?category=PENDING_DECISION" },
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
              <TodoCard
                key={todo.id}
                todo={todo}
                onUpdated={() => {
                  fetch("/api/todos")
                    .then((r) => r.json())
                    .then((nextTodos) => {
                      if (isTodosResponse(nextTodos)) setTodos(nextTodos);
                    });
                }}
              />
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

function deriveEntity(todo: { inventoryId?: string; orderId: string }) {
  if (todo.inventoryId) {
    return { entityType: "INVENTORY_ITEM", entityId: todo.inventoryId };
  }
  return { entityType: "PURCHASE_ORDER", entityId: todo.orderId };
}

function TodoCard({
  todo,
  onUpdated,
}: {
  todo: {
    id: string;
    type: string;
    orderId: string;
    orderNo: string;
    inventoryId?: string;
    inspectionId?: string;
    title: string;
    description: string;
    reasonKey: string;
    daysRemaining?: number;
    primaryAction: { label: string; href: string };
    secondaryActions?: { label: string; href: string }[];
    availableActions?: {
      label: string;
      actionType: string;
      confirmMessage?: string;
      changes: Record<string, unknown>;
      writesResolution: boolean;
      notePrompt?: string;
    }[];
  };
  onUpdated: () => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const entity = deriveEntity(todo);

  const snooze = useCallback(
    async (hours: number) => {
      setPending("snooze");
      await fetch("/api/todos/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          todoType: todo.type,
          entityType: entity.entityType,
          entityId: entity.entityId,
          reasonKey: todo.reasonKey,
          snoozedUntil: new Date(Date.now() + hours * 3600_000).toISOString(),
        }),
      });
      setPending(null);
      onUpdated();
    },
    [todo.type, entity.entityType, entity.entityId, todo.reasonKey, onUpdated],
  );

  return (
    <div
      className="cursor-pointer rounded-lg border p-3 transition-colors hover:bg-muted/30"
      onClick={() => router.push(todo.primaryAction.href)}
      onKeyDown={(e) => { if (e.key === "Enter") router.push(todo.primaryAction.href); }}
      role="link"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{todo.title}</p>
          <p className="mt-1 whitespace-pre-line text-xs leading-5 text-muted-foreground">
            {todo.description}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {todo.primaryAction.label}
            </span>
            {todo.secondaryActions?.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                onClick={(e) => e.stopPropagation()}
              >
                {action.label}
              </Link>
            ))}
            {/* Dynamic processing menu from availableActions */}
            {todo.availableActions && todo.availableActions.length > 0 ? (
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                  disabled={pending !== null}
                  onClick={() => setExpanded(!expanded)}
                >
                  处理
                  <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded ? (
                  <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-lg border bg-background p-1.5 shadow-lg">
                    {todo.availableActions.map((a) => {
                      const isDestructive = a.actionType === "MARKED_PROBLEM";
                      return (
                        <button
                          key={a.actionType}
                          type="button"
                          className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50 ${isDestructive ? "text-destructive" : ""}`}
                          disabled={pending !== null}
                          onClick={async () => {
                            let note: string | undefined;
                            if (a.notePrompt) {
                              note = prompt(a.notePrompt)?.trim() || undefined;
                              if (note === undefined && a.notePrompt.includes("到期日")) return; // cancelled
                            }
                            if (a.confirmMessage && !confirm(a.confirmMessage)) return;

                            // SNOOZE is special
                            if (a.actionType === "SNOOZE") {
                              await snooze(24);
                              setExpanded(false);
                              return;
                            }

                            // Real business action
                            setPending("process");
                            if (todo.inventoryId && Object.keys(a.changes).length > 0) {
                              const r = await fetch(`/api/inventory/${todo.inventoryId}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(a.changes),
                              });
                              if (!r.ok) {
                                setPending(null);
                                toast.error((await r.json()).message ?? "更新失败");
                                return;
                              }
                            }
                            // Write action log
                            await fetch("/api/inventory/action-log", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                inventoryItemId: todo.inventoryId,
                                todoType: todo.type,
                                reasonKey: todo.reasonKey,
                                actionType: a.actionType,
                                note,
                              }),
                            }).catch(() => {});
                            // Write TodoResolution if needed
                            if (a.writesResolution) {
                              await fetch("/api/todos/resolve", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  todoType: todo.type,
                                  entityType: entity.entityType,
                                  entityId: entity.entityId,
                                  reasonKey: todo.reasonKey,
                                  note: a.actionType,
                                }),
                              }).catch(() => {});
                            }
                            setPending(null);
                            setExpanded(false);
                            toast.success(a.label);
                            onUpdated();
                          }}
                        >
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            onClick={() => snooze(24)}
            disabled={pending !== null}
            title="明天再提醒"
          >
            <CalendarClock className="size-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            onClick={() => snooze(72)}
            disabled={pending !== null}
            title="3天后再提醒"
          >
            <CalendarClock className="size-3.5" />
            <span className="text-[10px]">3</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            onClick={() => setExpanded(!expanded)}
            disabled={pending !== null}
            title="标记已处理"
          >
            <BellOff className="size-3.5" />
            <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
