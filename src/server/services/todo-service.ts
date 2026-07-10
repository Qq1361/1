import type {
  LogisticsStatus,
  PurchaseOrderStatus,
} from "@/generated/prisma/enums";
import { db } from "@/server/db";

export type TodoType =
  | "MISSING_TRACKING"
  | "LOGISTICS_EXCEPTION"
  | "LOGISTICS_STALLED"
  | "PENDING_INSPECTION"
  | "DISTANCE_TO_395_WITHIN_7_DAYS"
  | "EXPIRY_UNDER_395"
  | "DISTANCE_TO_365_WITHIN_10_DAYS"
  | "EXPIRY_UNDER_365"
  | "OVERSTOCKED"
  | "NINETY_FIVE_EXPIRY_UNDER_90"
  | "NINETY_FIVE_EXPIRY_UNDER_60";

export type TodoAction = {
  label: string;
  href: string;
};

export type AvailableAction = {
  label: string;
  actionType: string;
  confirmMessage?: string;
  changes: Record<string, unknown>;
  writesResolution: boolean;
  notePrompt?: string;
};

export type TodoItem = {
  id: string;
  type: TodoType;
  severity: "info" | "warning" | "critical";
  orderId: string;
  orderNo: string;
  inventoryId?: string;
  inspectionId?: string;
  title: string;
  description: string;
  occurredAt: string;
  daysRemaining?: number;
  reasonKey: string;
  primaryAction: TodoAction;
  secondaryActions?: TodoAction[];
  availableActions?: AvailableAction[];
};

type TodoOrder = {
  id: string;
  orderNo: string;
  paidAt: Date;
  trackingNo: string | null;
  status: PurchaseOrderStatus;
  logisticsStatus: LogisticsStatus;
  logisticsLastEventAt: Date | null;
  logisticsExceptionMessage: string | null;
};

type TodoInspection = {
  id: string;
  sequence: number;
  purchaseOrderItem: {
    name: string;
    skuText: string | null;
    quantity: number;
    purchaseOrder: { id: string; orderNo: string };
  };
};

export function calculateTodos(
  orders: TodoOrder[],
  inspections: TodoInspection[],
  now = new Date(),
) {
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const todos: TodoItem[] = [];
  for (const order of orders) {
    if (order.status === "CANCELLED") continue;
    const ob = { orderId: order.id, orderNo: order.orderNo };
    if (!order.trackingNo && order.paidAt <= cutoff)
      todos.push({
        ...ob,
        id: `missing-tracking:${order.id}`,
        type: "MISSING_TRACKING",
        severity: "warning",
        title: "付款超48小时未填快递单号",
        description: "付款已超过 48 小时，尚未填写采购物流。",
        occurredAt: order.paidAt.toISOString(),
        reasonKey: `MISSING_TRACKING:${order.trackingNo}`,
        primaryAction: { label: "填写物流", href: `/purchases/${order.id}` },
      });
    if (order.logisticsStatus === "EXCEPTION")
      todos.push({
        ...ob,
        id: `logistics-exception:${order.id}`,
        type: "LOGISTICS_EXCEPTION",
        severity: "critical",
        title: "物流异常",
        description: order.logisticsExceptionMessage ?? "物流运输出现异常，请及时处理。",
        occurredAt: (order.logisticsLastEventAt ?? order.paidAt).toISOString(),
        reasonKey: `LOGISTICS:${order.logisticsStatus}`,
        primaryAction: { label: "查看订单", href: `/purchases/${order.id}` },
      });
    if (order.logisticsStatus === "STALLED")
      todos.push({
        ...ob,
        id: `logistics-stalled:${order.id}`,
        type: "LOGISTICS_STALLED",
        severity: "critical",
        title: "物流停滞",
        description: order.logisticsExceptionMessage ?? "物流轨迹长时间未更新。",
        occurredAt: (order.logisticsLastEventAt ?? order.paidAt).toISOString(),
        reasonKey: `LOGISTICS:${order.logisticsStatus}`,
        primaryAction: { label: "查看订单", href: `/purchases/${order.id}` },
      });
  }
  // Per-inspection PENDING_INSPECTION todos
  for (const insp of inspections) {
    const item = insp.purchaseOrderItem;
    const order = item.purchaseOrder;
    todos.push({
      id: `pending-inspection:${insp.id}`,
      type: "PENDING_INSPECTION",
      severity: "info",
      orderId: order.id,
      orderNo: order.orderNo,
      inspectionId: insp.id,
      title: "已签收待验货",
      description: `${item.name} · 第 ${insp.sequence}/${item.quantity} 件`,
      occurredAt: new Date().toISOString(),
      reasonKey: `INSP:${insp.id}:PENDING`,
      primaryAction: { label: "开始验货", href: `/inspections/${insp.id}` },
      secondaryActions: [{ label: "查看订单", href: `/purchases/${order.id}` }],
    });
  }
  return todos;
}

type InventoryTodoInput = {
  id: string;
  inventoryCode: string;
  name: string;
  skuText: string | null;
  expiryDate: Date | null;
  stockedAt: Date;
  itemStatus: string;
  saleMode: string;
  storageLocation: string | null;
  purchaseOrderItem: { purchaseOrder: { id: string; orderNo: string } };
};

const saleModeLabels: Record<string, string> = {
  NONE: "未选择",
  DEWU_LIGHTNING: "得物闪电",
  DEWU_STANDARD: "得物普通",
  NINETY_FIVE: "95分",
  XIANYU: "闲鱼",
  OTHER: "其他",
};

function formatItemDesc(item: InventoryTodoInput, days: number) {
  const parts = [`${item.inventoryCode}`];
  if (item.name) parts.push(item.name);
  if (item.skuText) parts.push(item.skuText);
  parts.push(`出售方式：${saleModeLabels[item.saleMode] ?? item.saleMode}`);
  if (item.storageLocation) parts.push(`库位：${item.storageLocation}`);
  parts.push(`到期日：${item.expiryDate?.toLocaleDateString("zh-CN") ?? ""} · 剩余 ${days} 天`);
  parts.push(`采购订单：${item.purchaseOrderItem.purchaseOrder.orderNo}`);
  return parts.join("\n");
}

function computeInventoryActions(
  todoType: TodoType,
  saleMode: string,
  itemStatus: string,
  daysRemaining: number,
): AvailableAction[] {
  if (["SOLD", "REMOVED"].includes(itemStatus)) return [];

  const actions: AvailableAction[] = [];
  const isProblem = itemStatus === "PROBLEM";
  const isNinetyFive = saleMode === "NINETY_FIVE";
  const isDewuLightning = saleMode === "DEWU_LIGHTNING";
  const isDewuStandard = saleMode === "DEWU_STANDARD";
  const isXianyu = saleMode === "XIANYU";

  // SNOOZE is always available (已阅读)
  const snooze: AvailableAction = {
    label: "已阅读",
    actionType: "SNOOZE",
    changes: {},
    writesResolution: false,
  };

  switch (todoType) {
    case "DISTANCE_TO_395_WITHIN_7_DAYS":
      if (!isDewuLightning) actions.push({
        label: "已安排得物闪电",
        actionType: "ARRANGED_DEWU_LIGHTNING",
        confirmMessage: "确认将该库存安排为得物闪电吗？",
        changes: { saleMode: "DEWU_LIGHTNING" },
        writesResolution: true,
      });
      if (!isDewuStandard) actions.push({
        label: "改走得物普通",
        actionType: "MOVED_TO_DEWU_STANDARD",
        confirmMessage: "确认将该库存改为得物普通吗？",
        changes: { saleMode: "DEWU_STANDARD" },
        writesResolution: false,
      });
      if (!isNinetyFive) actions.push({
        label: "转95分",
        actionType: "MOVED_TO_NINETY_FIVE",
        confirmMessage: "确认将该库存转到95分吗？",
        changes: { saleMode: "NINETY_FIVE" },
        writesResolution: false,
      });
      if (!isXianyu) actions.push({
        label: "转闲鱼",
        actionType: "MOVED_TO_XIANYU",
        confirmMessage: "确认将该库存转到闲鱼吗？",
        changes: { saleMode: "XIANYU" },
        writesResolution: false,
      });
      actions.push({
        label: "修改效期", actionType: "UPDATED_EXPIRY_DATE",
        changes: {}, writesResolution: false, notePrompt: "请输入新的到期日（YYYY-MM-DD）：",
      });
      if (!isProblem) actions.push({
        label: "标记问题件", actionType: "MARKED_PROBLEM",
        confirmMessage: "确认将该库存标记为问题件吗？",
        changes: { itemStatus: "PROBLEM" }, writesResolution: false, notePrompt: "请输入问题原因（可选）：",
      });
      actions.push(snooze);
      break;

    case "EXPIRY_UNDER_395":
      // NO ARRANGED_DEWU_LIGHTNING
      if (!isDewuStandard) actions.push({
        label: "改走得物普通", actionType: "MOVED_TO_DEWU_STANDARD",
        confirmMessage: "确认将该库存改为得物普通吗？",
        changes: { saleMode: "DEWU_STANDARD" }, writesResolution: false,
      });
      if (!isNinetyFive) actions.push({
        label: "转95分", actionType: "MOVED_TO_NINETY_FIVE",
        confirmMessage: "确认将该库存转到95分吗？",
        changes: { saleMode: "NINETY_FIVE" }, writesResolution: false,
      });
      if (!isXianyu) actions.push({
        label: "转闲鱼", actionType: "MOVED_TO_XIANYU",
        confirmMessage: "确认将该库存转到闲鱼吗？",
        changes: { saleMode: "XIANYU" }, writesResolution: false,
      });
      actions.push({
        label: "修改效期", actionType: "UPDATED_EXPIRY_DATE",
        changes: {}, writesResolution: false, notePrompt: "请输入新的到期日（YYYY-MM-DD）：",
      });
      if (!isProblem) actions.push({
        label: "标记问题件", actionType: "MARKED_PROBLEM",
        confirmMessage: "确认将该库存标记为问题件吗？",
        changes: { itemStatus: "PROBLEM" }, writesResolution: false, notePrompt: "请输入问题原因（可选）：",
      });
      actions.push(snooze);
      break;

    case "DISTANCE_TO_365_WITHIN_10_DAYS":
      if (!isDewuStandard) actions.push({
        label: "已降价普通出售",
        actionType: "PRICE_REDUCED_DEWU_STANDARD",
        confirmMessage: "确认已降价安排得物普通出售吗？",
        changes: { saleMode: "DEWU_STANDARD" }, writesResolution: true, notePrompt: "降价备注（可选）：",
      });
      if (!isNinetyFive) actions.push({
        label: "转95分", actionType: "MOVED_TO_NINETY_FIVE",
        confirmMessage: "确认将该库存转到95分吗？",
        changes: { saleMode: "NINETY_FIVE" }, writesResolution: false,
      });
      if (!isXianyu) actions.push({
        label: "转闲鱼", actionType: "MOVED_TO_XIANYU",
        confirmMessage: "确认将该库存转到闲鱼吗？",
        changes: { saleMode: "XIANYU" }, writesResolution: false,
      });
      actions.push({
        label: "修改效期", actionType: "UPDATED_EXPIRY_DATE",
        changes: {}, writesResolution: false, notePrompt: "请输入新的到期日（YYYY-MM-DD）：",
      });
      if (!isProblem) actions.push({
        label: "标记问题件", actionType: "MARKED_PROBLEM",
        confirmMessage: "确认将该库存标记为问题件吗？",
        changes: { itemStatus: "PROBLEM" }, writesResolution: false, notePrompt: "请输入问题原因（可选）：",
      });
      actions.push(snooze);
      break;

    case "EXPIRY_UNDER_365":
      // NO PRICE_REDUCED_DEWU_STANDARD, NO MOVED_TO_DEWU_STANDARD
      if (!isNinetyFive && daysRemaining > 90) actions.push({
        label: "转95分", actionType: "MOVED_TO_NINETY_FIVE",
        confirmMessage: "确认将该库存转到95分吗？（剩余 " + daysRemaining + " 天）",
        changes: { saleMode: "NINETY_FIVE" }, writesResolution: false,
      });
      if (!isXianyu) actions.push({
        label: "转闲鱼", actionType: "MOVED_TO_XIANYU",
        confirmMessage: "确认将该库存转到闲鱼吗？",
        changes: { saleMode: "XIANYU" }, writesResolution: false,
      });
      actions.push({
        label: "修改效期", actionType: "UPDATED_EXPIRY_DATE",
        changes: {}, writesResolution: false, notePrompt: "请输入新的到期日（YYYY-MM-DD）：",
      });
      if (!isProblem) actions.push({
        label: "标记问题件", actionType: "MARKED_PROBLEM",
        confirmMessage: "确认将该库存标记为问题件吗？",
        changes: { itemStatus: "PROBLEM" }, writesResolution: false, notePrompt: "请输入问题原因（可选）：",
      });
      actions.push(snooze);
      break;

    case "NINETY_FIVE_EXPIRY_UNDER_90":
      // Already NINETY_FIVE, don't show "放到95分"
      actions.push({
        label: "95分降价出售",
        actionType: "PRICE_REDUCED_NINETY_FIVE",
        confirmMessage: "确认已安排95分降价出售吗？",
        changes: {}, writesResolution: true, notePrompt: "降价备注（可选）：",
      });
      if (!isXianyu) actions.push({
        label: "转闲鱼", actionType: "MOVED_TO_XIANYU",
        confirmMessage: "确认将该库存转到闲鱼吗？",
        changes: { saleMode: "XIANYU" }, writesResolution: false,
      });
      actions.push({
        label: "修改效期", actionType: "UPDATED_EXPIRY_DATE",
        changes: {}, writesResolution: false, notePrompt: "请输入新的到期日（YYYY-MM-DD）：",
      });
      if (!isProblem) actions.push({
        label: "标记问题件", actionType: "MARKED_PROBLEM",
        confirmMessage: "确认将该库存标记为问题件吗？",
        changes: { itemStatus: "PROBLEM" }, writesResolution: false, notePrompt: "请输入问题原因（可选）：",
      });
      actions.push(snooze);
      break;

    case "NINETY_FIVE_EXPIRY_UNDER_60":
      // Critical: no NINETY_FIVE actions, no PRICE_REDUCED
      if (!isXianyu) actions.push({
        label: "转闲鱼", actionType: "MOVED_TO_XIANYU",
        confirmMessage: "确认将该库存转到闲鱼吗？",
        changes: { saleMode: "XIANYU" }, writesResolution: false,
      });
      actions.push({
        label: "修改效期", actionType: "UPDATED_EXPIRY_DATE",
        changes: {}, writesResolution: false, notePrompt: "请输入新的到期日（YYYY-MM-DD）：",
      });
      if (!isProblem) actions.push({
        label: "标记问题件", actionType: "MARKED_PROBLEM",
        confirmMessage: "确认将该库存标记为问题件吗？",
        changes: { itemStatus: "PROBLEM" }, writesResolution: false, notePrompt: "请输入问题原因（可选）：",
      });
      actions.push(snooze);
      break;

    default:
      // OVERSTOCKED etc.
      actions.push(snooze);
      break;
  }
  return actions;
}

export function calculateInventoryTodos(
  items: InventoryTodoInput[],
  now = new Date(),
) {
  const todos: TodoItem[] = [];
  for (const item of items) {
    if (item.itemStatus !== "STOCKED") continue;
    const order = item.purchaseOrderItem.purchaseOrder;
    const base = {
      orderId: order.id,
      orderNo: order.orderNo,
      inventoryId: item.id,
      reasonKey: `${item.saleMode}:${item.expiryDate?.toISOString() ?? "none"}:${item.itemStatus}`,
      primaryAction: { label: "查看库存" as const, href: `/inventory/${item.id}` },
    };
    if (item.expiryDate) {
      const days = Math.ceil(
        (item.expiryDate.getTime() - now.getTime()) / 86_400_000,
      );
      if (item.saleMode === "NINETY_FIVE") {
        // 95分规则：<=60天优先，其次<=90天
        if (days <= 60) {
          todos.push({
            ...base,
            id: `nf-expiry-60:${item.id}`,
            type: "NINETY_FIVE_EXPIRY_UNDER_60",
            severity: "critical",
            title: "95分效期低于60天",
            description: formatItemDesc(item, days),
            occurredAt: now.toISOString(),
            daysRemaining: days,
            availableActions: computeInventoryActions("NINETY_FIVE_EXPIRY_UNDER_60", item.saleMode, item.itemStatus, days),
          });
        } else if (days <= 90) {
          todos.push({
            ...base,
            id: `nf-expiry-90:${item.id}`,
            type: "NINETY_FIVE_EXPIRY_UNDER_90",
            severity: "warning",
            title: "95分效期接近限制",
            description: formatItemDesc(item, days),
            occurredAt: now.toISOString(),
            daysRemaining: days,
            availableActions: computeInventoryActions("NINETY_FIVE_EXPIRY_UNDER_90", item.saleMode, item.itemStatus, days),
          });
        }
      } else {
        // 普通规则：优先级从高到低：EXPIRY_UNDER_365 > EXPIRY_UNDER_395 > DISTANCE_TO_395_WITHIN_7_DAYS
        if (days <= 365) {
          todos.push({
            ...base,
            id: `expiry-365:${item.id}`,
            type: "EXPIRY_UNDER_365",
            severity: "critical",
            title: "效期低于365天",
            description: formatItemDesc(item, days),
            occurredAt: now.toISOString(),
            daysRemaining: days,
            availableActions: computeInventoryActions("EXPIRY_UNDER_365", item.saleMode, item.itemStatus, days),
          });
        } else if (days <= 375) {
          todos.push({
            ...base,
            id: `dist-365-10d:${item.id}`,
            type: "DISTANCE_TO_365_WITHIN_10_DAYS",
            severity: "warning",
            title: "距离365天门槛不足10天",
            description: formatItemDesc(item, days),
            occurredAt: now.toISOString(),
            daysRemaining: days,
            availableActions: computeInventoryActions("DISTANCE_TO_365_WITHIN_10_DAYS", item.saleMode, item.itemStatus, days),
          });
        } else if (days <= 395) {
          todos.push({
            ...base,
            id: `expiry-395:${item.id}`,
            type: "EXPIRY_UNDER_395",
            severity: "warning",
            title: "效期低于395天",
            description: formatItemDesc(item, days),
            occurredAt: now.toISOString(),
            daysRemaining: days,
            availableActions: computeInventoryActions("EXPIRY_UNDER_395", item.saleMode, item.itemStatus, days),
          });
        } else if (days <= 402) {
          todos.push({
            ...base,
            id: `dist-395-7d:${item.id}`,
            type: "DISTANCE_TO_395_WITHIN_7_DAYS",
            severity: "info",
            title: "距离395天门槛不足7天",
            description: formatItemDesc(item, days),
            occurredAt: now.toISOString(),
            daysRemaining: days,
            availableActions: computeInventoryActions("DISTANCE_TO_395_WITHIN_7_DAYS", item.saleMode, item.itemStatus, days),
          });
        }
      }
    }
    if (item.stockedAt.getTime() <= now.getTime() - 72 * 60 * 60 * 1000)
      todos.push({
        ...base,
        id: `overstocked:${item.id}`,
        type: "OVERSTOCKED",
        severity: "warning",
        title: "入库已满 3 天",
        description: `${item.inventoryCode} 已入库至少 72 小时。`,
        occurredAt: item.stockedAt.toISOString(),
      });
  }
  return todos;
}

export class TodoService {
  async list(ownerId: string) {
    const [orders, inventory, pendingInspections, reminderStates, todoResolutions] = await db.$transaction([
      db.purchaseOrder.findMany({
        where: { ownerId, status: { not: "CANCELLED" } },
        select: {
          id: true,
          orderNo: true,
          paidAt: true,
          trackingNo: true,
          status: true,
          logisticsStatus: true,
          logisticsLastEventAt: true,
          logisticsExceptionMessage: true,
        },
      }),
      db.inventoryItem.findMany({
        where: { ownerId, itemStatus: "STOCKED" },
        select: {
          id: true,
          inventoryCode: true,
          name: true,
          skuText: true,
          expiryDate: true,
          stockedAt: true,
          itemStatus: true,
          saleMode: true,
          storageLocation: true,
          purchaseOrderItem: {
            select: {
              purchaseOrder: { select: { id: true, orderNo: true } },
            },
          },
        },
      }),
      db.inspection.findMany({
        where: { ownerId, status: { in: ["PENDING", "IN_PROGRESS"] } },
        select: {
          id: true,
          sequence: true,
          purchaseOrderItem: {
            select: {
              name: true,
              skuText: true,
              quantity: true,
              purchaseOrder: { select: { id: true, orderNo: true } },
            },
          },
        },
      }),
      db.reminderState.findMany({
        where: { ownerId },
        select: { todoType: true, entityType: true, entityId: true, status: true, snoozedUntil: true, reasonKey: true },
      }),
      db.todoResolution.findMany({
        where: { ownerId },
        select: { todoType: true, reasonKey: true },
      }),
    ]);
    const now = new Date();
    const priority = { critical: 0, warning: 1, info: 2 };
    // Build TodoResolution set for quick lookup
    const resolutionSet = new Set(todoResolutions.map((r) => `${r.todoType}:${r.reasonKey}`));
    // Build a snooze filter map: "todoType:entityType:entityId" => { status, snoozedUntil }
    const reminderMap = new Map<string, { status: string; snoozedUntil: Date | null; reasonKey: string | null }>();
    for (const r of reminderStates) {
      reminderMap.set(`${r.todoType}:${r.entityType}:${r.entityId}`, {
        status: r.status,
        snoozedUntil: r.snoozedUntil,
        reasonKey: r.reasonKey,
      });
    }
    const pendingInspectionCount = pendingInspections.length;
    const allTodos = [...calculateTodos(orders, pendingInspections), ...calculateInventoryTodos(inventory)]
      .filter((todo) => {
        // Check TodoResolution first — exact match on todoType + reasonKey
        if (resolutionSet.has(`${todo.type}:${todo.reasonKey}`)) return false;
        // Derive entityType and entityId from the todo
        const entityType = todo.inventoryId ? "INVENTORY_ITEM" : todo.orderId ? "PURCHASE_ORDER" : "UNKNOWN";
        const entityId = todo.inventoryId ?? todo.orderId;
        const key = `${todo.type}:${entityType}:${entityId}`;
        const state = reminderMap.get(key);
        if (!state) return true; // No reminder state → show
        // If business state changed since snooze/resolve, invalidate old state
        if (state.reasonKey && state.reasonKey !== todo.reasonKey) return true;
        if (state.status === "RESOLVED") return false; // Resolved → hide
        if (state.status === "SNOOZED" && state.snoozedUntil && state.snoozedUntil > now) return false; // Still snoozed → hide
        return true; // Snooze expired → show again
      })
      .sort(
        (left, right) =>
          priority[left.severity] - priority[right.severity] ||
          Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
      );
    return { todos: allTodos, pendingInspectionCount };
  }
}

export const todoService = new TodoService();
