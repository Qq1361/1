import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";

export type AllocationValue = {
  itemId: string;
  allocatedTotalCost: string | null;
};

export function calculateAllocationSummary(
  totalAmount: string,
  shippingAmount: string,
  allocations: AllocationValue[],
) {
  const paidTotal = new Prisma.Decimal(totalAmount).plus(shippingAmount);
  const allocatedTotal = allocations.reduce(
    (sum, item) =>
      item.allocatedTotalCost === null
        ? sum
        : sum.plus(item.allocatedTotalCost),
    new Prisma.Decimal(0),
  );
  const difference = paidTotal.minus(allocatedTotal);
  return {
    paidTotal: paidTotal.toFixed(2),
    allocatedTotal: allocatedTotal.toFixed(2),
    difference: difference.toFixed(2),
    isBalanced:
      allocations.length > 0 &&
      allocations.every((item) => item.allocatedTotalCost !== null) &&
      difference.equals(0),
  };
}

export class CostAllocationService {
  async getSummary(ownerId: string, orderId: string) {
    const order = await db.purchaseOrder.findFirst({
      where: { id: orderId, ownerId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    if (!order) {
      throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
    }
    const allocations = order.items.map((item) => ({
      itemId: item.id,
      allocatedTotalCost: item.allocatedTotalCost?.toFixed(2) ?? null,
    }));
    return {
      orderId,
      orderNo: order.orderNo,
      totalAmount: order.totalAmount.toFixed(2),
      shippingAmount: order.shippingAmount.toFixed(2),
      allocationStatus: order.allocationStatus,
      allocationConfirmedAt: order.allocationConfirmedAt,
      items: order.items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        allocatedTotalCost: item.allocatedTotalCost?.toFixed(2) ?? null,
      })),
      ...calculateAllocationSummary(
        order.totalAmount.toFixed(2),
        order.shippingAmount.toFixed(2),
        allocations,
      ),
    };
  }

  async save(
    ownerId: string,
    orderId: string,
    allocations: AllocationValue[],
    confirm: boolean,
  ) {
    const summary = await this.getSummary(ownerId, orderId);
    const itemIds = new Set(summary.items.map((item) => item.id));
    if (
      allocations.length !== itemIds.size ||
      allocations.some((item) => !itemIds.has(item.itemId))
    ) {
      throw new ServiceError(
        "INVALID_ALLOCATION_ITEMS",
        "分摊明细与订单商品不一致。",
      );
    }
    const calculated = calculateAllocationSummary(
      summary.totalAmount,
      summary.shippingAmount,
      allocations,
    );
    if (confirm && !calculated.isBalanced) {
      throw new ServiceError(
        "ALLOCATION_NOT_BALANCED",
        `分摊合计与实付金额相差 ${calculated.difference} 元。`,
        422,
      );
    }
    await db.$transaction(async (tx) => {
      for (const allocation of allocations) {
        await tx.purchaseOrderItem.update({
          where: { id: allocation.itemId, purchaseOrderId: orderId },
          data: {
            allocatedTotalCost:
              allocation.allocatedTotalCost === null
                ? null
                : new Prisma.Decimal(allocation.allocatedTotalCost),
          },
        });
      }
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          allocationStatus: confirm ? "CONFIRMED" : "DRAFT",
          allocationConfirmedAt: confirm ? new Date() : null,
        },
      });
    });
    return this.getSummary(ownerId, orderId);
  }

  async reopen(ownerId: string, orderId: string) {
    await this.getSummary(ownerId, orderId);
    await db.purchaseOrder.update({
      where: { id: orderId },
      data: { allocationStatus: "DRAFT", allocationConfirmedAt: null },
    });
    return this.getSummary(ownerId, orderId);
  }
}

export const costAllocationService = new CostAllocationService();
