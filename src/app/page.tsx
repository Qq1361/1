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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  | "TRACKING_NOT_RECEIVED_OVERDUE"
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
    trackingNotReceivedOverdue: number;
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

type InventoryExpiryRiskResponse = {
  businessDate: string;
  risks: {
    risk: "EXPIRED" | "WITHIN_30_DAYS" | "WITHIN_90_DAYS" | "WITHIN_180_DAYS";
    label: string;
    count: number;
    nearestExpiryDate: string | null;
    locations: { name: string; count: number }[];
  }[];
};

const EMPTY_TODO_COUNTS: TodosResponse["counts"] = {
  missingTracking: 0,
  trackingNotReceivedOverdue: 0,
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

function isInventoryExpiryRiskResponse(value: unknown): value is InventoryExpiryRiskResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InventoryExpiryRiskResponse>;
  return typeof candidate.businessDate === "string" && Array.isArray(candidate.risks)
    && candidate.risks.every((risk) => risk && typeof risk.count === "number" && typeof risk.label === "string");
}

export default function Home() {
  const [orders, setOrders] = useState<ListResponse | null>(null);
  const [todos, setTodos] = useState<TodosResponse | null>(null);
  const [platformReturnSummary, setPlatformReturnSummary] = useState<PlatformReturnSummary | null>(null);
  const [expiryRiskSummary, setExpiryRiskSummary] = useState<InventoryExpiryRiskResponse | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoadError(false);
    try {
      const [ordersResponse, todosResponse, returnsResponse, expiryResponse] = await Promise.all([
        fetch("/api/purchase-orders?pageSize=5"),
        fetch("/api/todos"),
        fetch("/api/platform-returns/summary"),
        fetch("/api/inventory/expiry-risk"),
      ]);
      if (!ordersResponse.ok || !todosResponse.ok || !expiryResponse.ok) throw new Error("Failed to load dashboard");
      const [orderData, todoData, returnSummary, expirySummary] = await Promise.all([
        ordersResponse.json(),
        todosResponse.json(),
        returnsResponse.ok ? returnsResponse.json() : null,
        expiryResponse.json(),
      ]);
      if (!isListResponse(orderData) || !isTodosResponse(todoData) || !isInventoryExpiryRiskResponse(expirySummary)) {
        throw new Error("Invalid dashboard response");
      }
      setOrders(orderData);
      setTodos(todoData);
      setPlatformReturnSummary(isPlatformReturnSummary(returnSummary) ? returnSummary : null);
      setExpiryRiskSummary(expirySummary);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadDashboard]);

  const todoCounts = todos?.counts ?? EMPTY_TODO_COUNTS;

  const cards = [
    { label: "采购订单", value: orders?.total, icon: ReceiptText, href: "/purchases" },
    { label: "超48小时未填单号", value: todoCounts.missingTracking, icon: Truck, href: "/purchases?todo=missingTracking" },
    { label: "填单号超5天未确认收货", value: todoCounts.trackingNotReceivedOverdue, icon: AlertTriangle, href: "/purchases?todo=trackingNotReceivedOverdue" },
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
  const summaryCards = [cards[1], cards[2], cards[3], cards[0]];
  const reminderCards = cards.slice(4);
  const activeReminderCount = reminderCards.reduce(
    (total, card) => total + (Number(card.value ?? 0) > 0 ? 1 : 0),
    0,
  );
  const expiryRiskCards = expiryRiskSummary?.risks ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
       <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">工作台</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            聚合采购、物流、验货和库存风险
          </p>
        </div>
        <Link href="/purchases/new" className={buttonVariants()}>
          <Plus /> 新建采购订单
        </Link>
        </div>

        {loadError ? (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>工作台数据加载失败；已有数据会继续保留。</span>
            <button
              type="button"
              className={buttonVariants({ variant: "outline", size: "sm", className: "h-11 self-start sm:h-9" })}
              onClick={() => void loadDashboard()}
            >
              重试
            </button>
          </div>
        ) : null}

      <Card className="rounded-xl shadow-none">
        <CardHeader className="border-b">
          <CardTitle>优先处理</CardTitle>
          <CardDescription>先处理异常与未完成流程，再查看采购总量</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-px bg-border p-0 xl:grid-cols-4">
          {summaryCards.map(({ label, value, icon: Icon, href }) => (
            <Link
              key={label}
              href={href}
              className="group flex min-h-28 items-center justify-between bg-card p-4 transition-colors duration-200 hover:bg-accent/55 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {value ?? "—"}
                </p>
              </div>
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="size-5" />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-none">
        <CardHeader className="border-b">
          <CardTitle>库存效期风险</CardTitle>
          <CardDescription>按北京时间 {expiryRiskSummary?.businessDate ?? ""} 的到期日实时判断；提醒仅供处理，不会自动改变库存状态。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-4">
          {expiryRiskCards.map((risk) => (
            <Link
              key={risk.risk}
              href={`/inventory?expiryRisk=${risk.risk}`}
              className="group flex min-h-24 flex-col justify-between rounded-md border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium">{risk.label}</span>
                <AlertTriangle className={risk.count ? "size-4 text-amber-600" : "size-4 text-muted-foreground"} />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{risk.count} 件</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{risk.nearestExpiryDate ? `最近到期：${risk.nearestExpiryDate}` : "暂无库存"}</p>
                {risk.locations.length ? <p className="mt-1 break-words text-xs text-muted-foreground">{risk.locations.map((location) => `${location.name} ${location.count}件`).join("；")}</p> : null}
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-none">
        <CardHeader className="flex items-start justify-between border-b">
          <div className="space-y-1">
            <CardTitle>运营提醒</CardTitle>
            <CardDescription>库存效期与平台退回状态</CardDescription>
          </div>
          <span className="inline-flex min-h-7 items-center rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary">
            {activeReminderCount} 项需关注
          </span>
        </CardHeader>
        <CardContent className="grid gap-1 p-2 md:grid-cols-2">
          {reminderCards.map(({ label, value, icon: Icon, href }) => {
            const active = Number(value ?? 0) > 0;
            return (
              <Link
                key={label}
                href={href}
                className="group flex min-h-12 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                <Icon className={active ? "size-4 text-primary" : "size-4 text-muted-foreground"} />
                <span className="min-w-0 flex-1 text-sm">{label}</span>
                <span
                  className={`min-w-8 rounded-md px-2 py-1 text-center text-xs font-semibold tabular-nums ${
                    active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {value ?? "—"}
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card className="overflow-visible rounded-xl shadow-none">
          <CardHeader className="border-b">
            <CardTitle>待办中心</CardTitle>
            <CardDescription>按优先级处理需要推进的事项</CardDescription>
          </CardHeader>
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

        <Card className="rounded-xl shadow-none">
          <CardHeader className="flex items-center justify-between border-b">
            <div className="space-y-1">
              <CardTitle>最近采购订单</CardTitle>
              <CardDescription>最近录入的 5 笔订单</CardDescription>
            </div>
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
                  className="flex flex-col gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <div>
                    <p className="text-sm font-medium">{order.orderNo}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {order.sellerNickname ? `卖家：${order.sellerNickname} · ` : ""}
                      {order._count.items} 个商品明细 ·{" "}
                      {new Date(order.paidAt).toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
      className="cursor-pointer rounded-lg border bg-card p-3.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
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
                  <div className="absolute left-0 top-full z-10 mt-1 w-48 origin-top-left rounded-lg border bg-background p-1.5 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]">
                    {todo.availableActions.map((a) => {
                      const isDestructive = a.actionType === "MARKED_PROBLEM";
                      return (
                        <button
                          key={a.actionType}
                          type="button"
                          className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-muted disabled:opacity-50 ${isDestructive ? "text-destructive" : ""}`}
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
            className="inline-flex size-10 items-center justify-center rounded-md text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            onClick={() => snooze(24)}
            disabled={pending !== null}
            title="明天再提醒"
            aria-label="明天再提醒"
          >
            <CalendarClock className="size-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            onClick={() => snooze(72)}
            disabled={pending !== null}
            title="3天后再提醒"
            aria-label="3天后再提醒"
          >
            <CalendarClock className="size-3.5" />
            <span className="text-[10px]">3</span>
          </button>
          <button
            type="button"
            className="inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            onClick={() => setExpanded(!expanded)}
            disabled={pending !== null}
            title="标记已处理"
            aria-label="标记已处理"
          >
            <BellOff className="size-3.5" />
            <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
