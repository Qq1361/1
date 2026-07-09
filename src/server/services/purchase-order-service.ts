import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { LocalStorageAdapter } from "@/server/adapters/storage/local-storage-adapter";
import type {
  OrderListQuery,
  PurchaseOrderInput,
} from "@/server/validation/purchase-order";

function serializeOrder<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, current) =>
      current instanceof Prisma.Decimal ? current.toFixed(2) : current,
    ),
  ) as T;
}

const storage = new LocalStorageAdapter();

export function canDeleteOrder(order: {
  status: string;
  shippedAt: string | Date | null;
  deliveredAt: string | Date | null;
}) {
  return (
    !order.shippedAt &&
    !order.deliveredAt &&
    ["PAID", "WAITING_SHIPMENT"].includes(order.status)
  );
}

export class PurchaseOrderService {
  async createOrder(ownerId: string, input: PurchaseOrderInput) {
    try {
      const order = await db.$transaction(async (tx) =>
        tx.purchaseOrder.create({
          data: {
            ownerId,
            orderNo: input.orderNo,
            paidAt: input.paidAt,
            totalAmount: new Prisma.Decimal(input.totalAmount),
            shippingAmount: new Prisma.Decimal(input.shippingAmount),
            notes: input.notes || null,
            items: {
              create: input.items.map((item) => ({
                name: item.name,
                skuText: item.skuText || null,
                quantity: item.quantity,
                notes: item.notes || null,
              })),
            },
          },
          include: { items: { orderBy: { createdAt: "asc" } } },
        }),
      );
      return serializeOrder(order);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ServiceError(
          "ORDER_NO_EXISTS",
          "该闲鱼订单号已存在。",
          409,
          { orderNo: ["订单号不能重复"] },
        );
      }
      throw error;
    }
  }

  async getOrder(ownerId: string, orderId: string) {
    const order = await db.purchaseOrder.findFirst({
      where: { id: orderId, ownerId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) {
      throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
    }
    return serializeOrder(order);
  }

  async listOrders(ownerId: string, query: OrderListQuery) {
    const where: Prisma.PurchaseOrderWhereInput = {
      ownerId,
      status: query.status,
      allocationStatus: query.allocationStatus,
      orderNo: query.query
        ? { contains: query.query, mode: "insensitive" }
        : undefined,
    };
    const [orders, total] = await db.$transaction([
      db.purchaseOrder.findMany({
        where,
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.purchaseOrder.count({ where }),
    ]);
    return serializeOrder({
      data: orders,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  }

  async updateOrder(
    ownerId: string,
    orderId: string,
    input: PurchaseOrderInput,
  ) {
    await this.getOrder(ownerId, orderId);
    const existingIds = input.items.flatMap((item) => (item.id ? [item.id] : []));
    const removedItems = await db.purchaseOrderItem.findMany({
      where: {
        purchaseOrderId: orderId,
        ...(existingIds.length ? { id: { notIn: existingIds } } : {}),
      },
      select: { id: true },
    });
    const removedItemIds = removedItems.map((item) => item.id);
    const removedAttachments = removedItemIds.length
      ? await db.attachment.findMany({
          where: {
            ownerId,
            entityType: "PURCHASE_ORDER_ITEM",
            entityId: { in: removedItemIds },
          },
          select: { storageKey: true },
        })
      : [];
    const order = await db.$transaction(async (tx) => {
      if (removedItemIds.length) {
        await tx.attachment.deleteMany({
          where: {
            ownerId,
            entityType: "PURCHASE_ORDER_ITEM",
            entityId: { in: removedItemIds },
          },
        });
      }
      await tx.purchaseOrderItem.deleteMany({
        where: {
          purchaseOrderId: orderId,
          ...(existingIds.length ? { id: { notIn: existingIds } } : {}),
        },
      });
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          orderNo: input.orderNo,
          paidAt: input.paidAt,
          totalAmount: new Prisma.Decimal(input.totalAmount),
          shippingAmount: new Prisma.Decimal(input.shippingAmount),
          notes: input.notes || null,
          allocationStatus: "UNALLOCATED",
          allocationConfirmedAt: null,
        },
      });
      for (const item of input.items) {
        if (item.id) {
          await tx.purchaseOrderItem.update({
            where: { id: item.id, purchaseOrderId: orderId },
            data: {
              name: item.name,
              skuText: item.skuText || null,
              quantity: item.quantity,
              notes: item.notes || null,
              allocatedTotalCost: null,
            },
          });
        } else {
          await tx.purchaseOrderItem.create({
            data: {
              purchaseOrderId: orderId,
              name: item.name,
              skuText: item.skuText || null,
              quantity: item.quantity,
              notes: item.notes || null,
            },
          });
        }
      }
      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { orderBy: { createdAt: "asc" } } },
      });
    });
    await Promise.allSettled(
      removedAttachments.map((attachment) =>
        storage.delete(attachment.storageKey),
      ),
    );
    return serializeOrder(order);
  }

  async deleteOrder(ownerId: string, orderId: string) {
    const order = await this.getOrder(ownerId, orderId);
    if (!canDeleteOrder(order)) {
      throw new ServiceError(
        "ORDER_DELETE_BLOCKED",
        "订单已进入后续流程，不能删除。",
        409,
      );
    }
    const itemIds = order.items.map((item) => item.id);
    const attachments = await db.attachment.findMany({
      where: {
        ownerId,
        OR: [
          { entityType: "PURCHASE_ORDER", entityId: orderId },
          {
            entityType: "PURCHASE_ORDER_ITEM",
            entityId: { in: itemIds },
          },
        ],
      },
      select: { storageKey: true },
    });
    await db.$transaction(async (tx) => {
      await tx.attachment.deleteMany({
        where: {
          ownerId,
          OR: [
            { entityType: "PURCHASE_ORDER", entityId: orderId },
            {
              entityType: "PURCHASE_ORDER_ITEM",
              entityId: { in: itemIds },
            },
          ],
        },
      });
      await tx.purchaseOrder.delete({ where: { id: orderId } });
    });
    await Promise.allSettled(
      attachments.map((attachment) => storage.delete(attachment.storageKey)),
    );
  }
}

export const purchaseOrderService = new PurchaseOrderService();
