import type { LogisticsStatus, PurchaseOrderStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";

export type TodoType =
  | "MISSING_TRACKING"
  | "LOGISTICS_EXCEPTION"
  | "LOGISTICS_STALLED"
  | "PENDING_INSPECTION";

export type TodoItem = {
  id: string;
  type: TodoType;
  severity: "info" | "warning" | "critical";
  orderId: string;
  orderNo: string;
  title: string;
  description: string;
  occurredAt: string;
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
    if (!order.trackingNo && order.paidAt <= cutoff) {
      todos.push({
        id: `missing-tracking:${order.id}`,
        type: "MISSING_TRACKING",
        severity: "warning",
        orderId: order.id,
        orderNo: order.orderNo,
        title: "待填写快递单号",
        description: "付款已超过 48 小时，尚未填写采购物流。",
        occurredAt: order.paidAt.toISOString(),
      });
    }
    if (order.logisticsStatus === "EXCEPTION") {
      todos.push({
        id: `logistics-exception:${order.id}`,
        type: "LOGISTICS_EXCEPTION",
        severity: "critical",
        orderId: order.id,
        orderNo: order.orderNo,
        title: "物流异常",
        description:
          order.logisticsExceptionMessage ?? "物流运输出现异常，请及时处理。",
        occurredAt: (order.logisticsLastEventAt ?? order.paidAt).toISOString(),
      });
    }
    if (order.logisticsStatus === "STALLED") {
      todos.push({
        id: `logistics-stalled:${order.id}`,
        type: "LOGISTICS_STALLED",
        severity: "critical",
        orderId: order.id,
        orderNo: order.orderNo,
        title: "物流停滞",
        description:
          order.logisticsExceptionMessage ?? "物流轨迹长时间未更新。",
        occurredAt: (order.logisticsLastEventAt ?? order.paidAt).toISOString(),
      });
    }
    if (order.status === "PENDING_INSPECTION") {
      todos.push({
        id: `pending-inspection:${order.id}`,
        type: "PENDING_INSPECTION",
        severity: "info",
        orderId: order.id,
        orderNo: order.orderNo,
        title: "已签收待验货",
        description: "采购快件已签收，等待后续验货。",
        occurredAt: (order.logisticsLastEventAt ?? order.paidAt).toISOString(),
      });
    }
  }
  const priority = { critical: 0, warning: 1, info: 2 };
  return todos.sort(
    (left, right) =>
      priority[left.severity] - priority[right.severity] ||
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
}

export class TodoService {
  async list(ownerId: string) {
    const orders = await db.purchaseOrder.findMany({
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
    });
    return calculateTodos(orders);
  }
}

export const todoService = new TodoService();
