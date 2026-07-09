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

export type TodoItem = {
  id: string;
  type: TodoType;
  severity: "info" | "warning" | "critical";
  orderId: string;
  orderNo: string;
  inventoryId?: string;
  title: string;
  description: string;
  occurredAt: string;
  targetPath?: string;
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

export function calculateTodos(orders: TodoOrder[], now = new Date()) {
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const todos: TodoItem[] = [];
  for (const order of orders) {
    if (order.status === "CANCELLED") continue;
    const base = {
      orderId: order.id,
      orderNo: order.orderNo,
      targetPath: `/purchases/${order.id}`,
    };
    if (!order.trackingNo && order.paidAt <= cutoff)
      todos.push({
        ...base,
        id: `missing-tracking:${order.id}`,
        type: "MISSING_TRACKING",
        severity: "warning",
        title: "付款超48小时未填快递单号",
        description: "付款已超过 48 小时，尚未填写采购物流。",
        occurredAt: order.paidAt.toISOString(),
      });
    if (order.logisticsStatus === "EXCEPTION")
      todos.push({
        ...base,
        id: `logistics-exception:${order.id}`,
        type: "LOGISTICS_EXCEPTION",
        severity: "critical",
        title: "物流异常",
        description:
          order.logisticsExceptionMessage ?? "物流运输出现异常，请及时处理。",
        occurredAt: (order.logisticsLastEventAt ?? order.paidAt).toISOString(),
      });
    if (order.logisticsStatus === "STALLED")
      todos.push({
        ...base,
        id: `logistics-stalled:${order.id}`,
        type: "LOGISTICS_STALLED",
        severity: "critical",
        title: "物流停滞",
        description:
          order.logisticsExceptionMessage ?? "物流轨迹长时间未更新。",
        occurredAt: (order.logisticsLastEventAt ?? order.paidAt).toISOString(),
      });
    if (order.status === "PENDING_INSPECTION")
      todos.push({
        ...base,
        id: `pending-inspection:${order.id}`,
        type: "PENDING_INSPECTION",
        severity: "info",
        title: "已签收待验货",
        description: "采购快件已签收，等待验货。",
        occurredAt: (order.logisticsLastEventAt ?? order.paidAt).toISOString(),
        targetPath: "/inspections",
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
      targetPath: `/inventory/${item.id}`,
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
    const [orders, inventory, pendingInspectionCount] = await db.$transaction([
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
      db.inspection.count({
        where: { ownerId, status: { in: ["PENDING", "IN_PROGRESS"] } },
      }),
    ]);
    const priority = { critical: 0, warning: 1, info: 2 };
    const allTodos = [...calculateTodos(orders), ...calculateInventoryTodos(inventory)].sort(
      (left, right) =>
        priority[left.severity] - priority[right.severity] ||
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    );
    return { todos: allTodos, pendingInspectionCount };
  }
}

export const todoService = new TodoService();
