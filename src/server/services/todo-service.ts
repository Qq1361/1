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
  | "EXPIRY_BELOW_395"
  | "EXPIRY_BELOW_365"
  | "OVERSTOCKED";

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
        title: "待填写快递单号",
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
  expiryDate: Date | null;
  stockedAt: Date;
  itemStatus: string;
  purchaseOrderItem: { purchaseOrder: { id: string; orderNo: string } };
};

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
      if (days <= 365)
        todos.push({
          ...base,
          id: `expiry-365:${item.id}`,
          type: "EXPIRY_BELOW_365",
          severity: "critical",
          title: "效期低于 365 天",
          description: `${item.inventoryCode} 剩余效期 ${days} 天。`,
          occurredAt: now.toISOString(),
        });
      else if (days <= 394)
        todos.push({
          ...base,
          id: `expiry-395:${item.id}`,
          type: "EXPIRY_BELOW_395",
          severity: "warning",
          title: "效期低于 395 天",
          description: `${item.inventoryCode} 剩余效期 ${days} 天。`,
          occurredAt: now.toISOString(),
        });
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
    const [orders, inventory] = await db.$transaction([
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
        include: {
          purchaseOrderItem: {
            include: { purchaseOrder: { select: { id: true, orderNo: true } } },
          },
        },
      }),
    ]);
    const priority = { critical: 0, warning: 1, info: 2 };
    return [...calculateTodos(orders), ...calculateInventoryTodos(inventory)].sort(
      (left, right) =>
        priority[left.severity] - priority[right.severity] ||
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    );
  }
}

export const todoService = new TodoService();
