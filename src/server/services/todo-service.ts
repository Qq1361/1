import type {
  LogisticsStatus,
  PurchaseOrderStatus,
} from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { isLegacyInventoryItemStatus } from "@/lib/inventory-item-status-contract";
import {
  calculatePurchaseLogisticsRisks,
  type PurchaseLogisticsRisk,
} from "@/server/services/purchase-logistics-risk-service";

export type TodoType =
  | "MISSING_TRACKING"
  | "TRACKING_NOT_RECEIVED_OVERDUE"
  | "LOGISTICS_EXCEPTION"
  | "LOGISTICS_STALLED"
  | "PENDING_INSPECTION"
  | "DISTANCE_TO_395_WITHIN_7_DAYS"
  | "EXPIRY_UNDER_395"
  | "DISTANCE_TO_365_WITHIN_10_DAYS"
  | "EXPIRY_UNDER_365"
  | "OVERSTOCKED"
  | "NINETY_FIVE_EXPIRY_UNDER_90"
  | "NINETY_FIVE_EXPIRY_UNDER_60"
  | "PLATFORM_RETURNING"
  | "PLATFORM_RETURNED_PENDING_INSPECTION"
  | "PLATFORM_RETURN_PENDING_DECISION";

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

function purchaseLogisticsRiskToTodo(risk: PurchaseLogisticsRisk): TodoItem {
  const overdue = risk.type === "TRACKING_NOT_RECEIVED_OVERDUE";
  return {
    id: `${risk.type}:${risk.purchaseOrderId}`,
    type: overdue ? "TRACKING_NOT_RECEIVED_OVERDUE" : "MISSING_TRACKING",
    severity: risk.severity,
    orderId: risk.purchaseOrderId,
    orderNo: risk.orderNumber,
    title: overdue ? "快递单号已填写超过 5 天仍未确认收货" : "采购订单超过 2 天仍未填写快递单号",
    description: overdue
      ? `${risk.productSummary}${risk.carrier ? ` / ${risk.carrier}` : ""}${risk.maskedTrackingNumber ? ` / ${risk.maskedTrackingNumber}` : ""}，请手动查询物流。`
      : `${risk.productSummary}，请补充快递单号。`,
    occurredAt: risk.referenceAt.toISOString(),
    reasonKey: `${risk.type}:${risk.maskedTrackingNumber ?? "NONE"}:${risk.referenceAt.toISOString()}`,
    primaryAction: { label: overdue ? "查看采购订单" : "填写物流", href: risk.detailPath },
  };
}

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
  ownershipStatus?: string;
  storageLocation: string | null;
  purchaseOrderItem: { purchaseOrder: { id: string; orderNo: string } };
};

type PlatformReturnTodoInput = {
  id: string;
  inventoryCode: string;
  name: string;
  skuText: string | null;
  itemStatus: string;
  purchaseOrderItem: { purchaseOrder: { id: string; orderNo: string } };
  shipmentLines: Array<{
    id: string;
    returnedAt: Date | null;
    returnInspection: { result: string } | null;
  }>;
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
  if (itemStatus === "SOLD" || isLegacyInventoryItemStatus(itemStatus)) return [];

  const actions: AvailableAction[] = [];
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
      actions.push(snooze);
      break;

    default:
      // OVERSTOCKED etc.
      actions.push(snooze);
      break;
  }
  return actions;
}

/** Shared reminder type computation. Returns the single highest-priority reminder
 *  type for a given inventory item, or null if no reminder applies.
 *  Used by both /api/todos and /api/inventory?reminder=xxx to stay in sync. */
export function getReminderType(
  item: { saleMode: string; itemStatus: string; expiryDate: Date | null; stockedAt: Date; ownershipStatus?: string },
  now = new Date(),
): TodoType | "OVERSTOCKED" | null {
  if (item.ownershipStatus && item.ownershipStatus !== "OWNED") return null;
  // PROBLEM items don't get reminders
  if (isLegacyInventoryItemStatus(item.itemStatus) || ["PROBLEM", "SOLD", "RETURNING", "RETURNED"].includes(item.itemStatus)) return null;

  // Overstock check (applies to all sale modes)
  if (item.stockedAt.getTime() <= now.getTime() - 72 * 60 * 60 * 1000) {
    // overstock returned separately from expiry below
  }

  if (!item.expiryDate) return null;
  const days = Math.ceil((item.expiryDate.getTime() - now.getTime()) / 86_400_000);

  if (item.saleMode === "NINETY_FIVE") {
    if (days <= 60) return "NINETY_FIVE_EXPIRY_UNDER_60";
    if (days <= 90) return "NINETY_FIVE_EXPIRY_UNDER_90";
    return null;
  }

  // XIANYU / OTHER: no expiry reminders for now
  if (["XIANYU", "OTHER"].includes(item.saleMode)) return null;

  // Standard rules (NONE, DEWU_LIGHTNING, DEWU_STANDARD)
  if (days <= 365) return "EXPIRY_UNDER_365";
  if (days <= 375) return "DISTANCE_TO_365_WITHIN_10_DAYS";
  if (days <= 395) return "EXPIRY_UNDER_395";
  if (days <= 402) return "DISTANCE_TO_395_WITHIN_7_DAYS";
  return null;
}

export function calculateInventoryTodos(
  items: InventoryTodoInput[],
  now = new Date(),
) {
  const todos: TodoItem[] = [];
  for (const item of items) {
    if (item.ownershipStatus && item.ownershipStatus !== "OWNED") continue;
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
      const days = Math.ceil((item.expiryDate.getTime() - now.getTime()) / 86_400_000);
      const reminderType = getReminderType(item, now);
      if (reminderType) {
        const titles: Record<string, string> = {
          EXPIRY_UNDER_365: "效期低于365天",
          DISTANCE_TO_365_WITHIN_10_DAYS: "距离365天门槛不足10天",
          EXPIRY_UNDER_395: "效期低于395天",
          DISTANCE_TO_395_WITHIN_7_DAYS: "距离395天门槛不足7天",
          NINETY_FIVE_EXPIRY_UNDER_60: "95分效期低于60天",
          NINETY_FIVE_EXPIRY_UNDER_90: "95分效期接近限制",
        };
        const severities: Record<string, "info" | "warning" | "critical"> = {
          EXPIRY_UNDER_365: "critical",
          DISTANCE_TO_365_WITHIN_10_DAYS: "warning",
          EXPIRY_UNDER_395: "warning",
          DISTANCE_TO_395_WITHIN_7_DAYS: "info",
          NINETY_FIVE_EXPIRY_UNDER_60: "critical",
          NINETY_FIVE_EXPIRY_UNDER_90: "warning",
        };
        todos.push({
          ...base,
          id: `reminder-${reminderType}:${item.id}`,
          type: reminderType,
          severity: severities[reminderType] ?? "warning",
          title: titles[reminderType] ?? reminderType,
          description: formatItemDesc(item, days),
          occurredAt: now.toISOString(),
          daysRemaining: days,
          availableActions: computeInventoryActions(reminderType, item.saleMode, item.itemStatus, days),
        });
      }
    }
    // Overstock only for local STOCKED items
    if (item.itemStatus === "STOCKED" && item.stockedAt.getTime() <= now.getTime() - 72 * 60 * 60 * 1000)
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

export function calculatePlatformReturnTodos(items: PlatformReturnTodoInput[], now = new Date()) {
  const todos: TodoItem[] = [];
  for (const item of items) {
    const order = item.purchaseOrderItem.purchaseOrder;
    const base = {
      orderId: order.id,
      orderNo: order.orderNo,
      inventoryId: item.id,
    };
    if (item.itemStatus === "RETURNING") {
      todos.push({
        ...base,
        id: `platform-returning:${item.id}`,
        type: "PLATFORM_RETURNING",
        severity: "warning",
        title: "平台退回途中",
        description: `${item.inventoryCode} ${item.name}${item.skuText ? ` / ${item.skuText}` : ""} 正在从平台退回。`,
        occurredAt: now.toISOString(),
        reasonKey: `PLATFORM_RETURNING:${item.id}`,
        primaryAction: { label: "查看平台退回", href: "/platform-returns?category=RETURNING" },
      });
      continue;
    }
    if (item.itemStatus !== "RETURNED") continue;

    const currentLine = item.shipmentLines[0] ?? null;
    const currentResult = currentLine?.returnInspection?.result ?? null;
    if (currentResult && currentResult !== "PENDING_DECISION") continue;
    const pendingDecision = currentResult === "PENDING_DECISION";
    todos.push({
      ...base,
      id: `platform-returned-inspection:${item.id}`,
      type: pendingDecision ? "PLATFORM_RETURN_PENDING_DECISION" : "PLATFORM_RETURNED_PENDING_INSPECTION",
      severity: pendingDecision ? "warning" : "info",
      title: pendingDecision ? "平台退回待进一步判断" : "平台已退回待验货",
      description: `${item.inventoryCode} ${item.name}${pendingDecision ? " 已登记待进一步判断，库存仍保持已退回。" : " 已退回，等待验货结论。"}`,
      occurredAt: (currentLine?.returnedAt ?? now).toISOString(),
      reasonKey: `PLATFORM_RETURNED:${item.id}:${currentLine?.id ?? "legacy"}:${currentResult ?? "NONE"}`,
      primaryAction: {
        label: "查看平台退回",
        href: pendingDecision
          ? "/platform-returns?category=PENDING_DECISION"
          : "/platform-returns?category=PENDING_INSPECTION",
      },
    });
  }
  return todos;
}

export class TodoService {
  async list(ownerId: string) {
    const [orders, inventory, pendingInspections, platformReturnInventory, reminderStates, todoResolutions] = await db.$transaction([
      db.purchaseOrder.findMany({
        where: { ownerId, status: { not: "CANCELLED" } },
        select: {
          id: true,
          orderNo: true,
          paidAt: true,
          carrierCode: true,
          trackingNo: true,
          trackingNumberRecordedAt: true,
          manuallyReceivedAt: true,
          status: true,
          logisticsStatus: true,
          logisticsLastEventAt: true,
          logisticsExceptionMessage: true,
          items: { select: { name: true, quantity: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        },
      }),
      db.inventoryItem.findMany({
        where: { ownerId, itemStatus: "STOCKED", ownershipStatus: "OWNED" },
        select: {
          id: true,
          inventoryCode: true,
          name: true,
          skuText: true,
          expiryDate: true,
          stockedAt: true,
          itemStatus: true,
          saleMode: true,
          ownershipStatus: true,
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
      db.inventoryItem.findMany({
        where: {
          ownerId,
          ownershipStatus: "OWNED",
          itemStatus: { in: ["RETURNING", "RETURNED"] },
        },
        select: {
          id: true,
          inventoryCode: true,
          name: true,
          skuText: true,
          itemStatus: true,
          purchaseOrderItem: { select: { purchaseOrder: { select: { id: true, orderNo: true } } } },
          shipmentLines: {
            where: { lineStatus: "RETURNED" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              id: true,
              returnedAt: true,
              returnInspection: { select: { result: true } },
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
    const logisticsRiskTodos = calculatePurchaseLogisticsRisks(orders, now).map(purchaseLogisticsRiskToTodo);
    const allTodos = [
      ...calculateTodos(orders, pendingInspections, now).filter((todo) => todo.type !== "MISSING_TRACKING"),
      ...logisticsRiskTodos,
      ...calculateInventoryTodos(inventory),
      ...calculatePlatformReturnTodos(platformReturnInventory),
    ]
      .filter((todo) => {
        // Platform-return work remains visible until the actual return state changes.
        // Action logs and generic reminder state must not hide a pending return asset.
        if (todo.type.startsWith("PLATFORM_RETURN")) return true;
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
