import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";

export type AllocationValue = {
  itemId: string;
  allocatedTotalCost: string | null;
};

export type EqualAllocationItem = {
  id: string;
  quantity: number;
  createdAt: Date;
};

export type EqualAllocation = {
  itemId: string;
  quantity: number;
  allocatedTotalCost: string;
};

type AllocationOrderSnapshot = {
  id: string;
  ownerId: string;
  orderNo: string;
  totalAmount: Prisma.Decimal;
  shippingAmount: Prisma.Decimal;
  allocationStatus: "UNALLOCATED" | "DRAFT" | "CONFIRMED";
  allocationConfirmedAt: Date | null;
  updatedAt: Date;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    allocatedTotalCost: Prisma.Decimal | null;
    updatedAt: Date;
  }>;
};

function allocationVersionFor(order: AllocationOrderSnapshot) {
  return JSON.stringify({
    order: {
      id: order.id,
      allocationStatus: order.allocationStatus,
      updatedAt: order.updatedAt.toISOString(),
      totalAmount: order.totalAmount.toFixed(2),
      shippingAmount: order.shippingAmount.toFixed(2),
    },
    items: order.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      updatedAt: item.updatedAt.toISOString(),
    })),
  });
}

function centsToMoney(cents: bigint) {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function calculateEqualPurchaseCostAllocation(
  totalAmount: string,
  shippingAmount: string,
  items: EqualAllocationItem[],
) {
  const total = new Prisma.Decimal(totalAmount).plus(shippingAmount);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity <= 0) {
    throw new ServiceError("INVALID_ALLOCATION_QUANTITY", "采购商品总件数必须大于 0。", 422);
  }

  const totalCents = BigInt(total.mul(100).toFixed(0));
  const quantity = BigInt(totalQuantity);
  const baseUnitCents = totalCents / quantity;
  const remainderCents = totalCents % quantity;
  const orderedItems = [...items].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  let unitIndex = 0n;
  const allocations: EqualAllocation[] = orderedItems.map((item) => {
    let lineCents = 0n;
    for (let index = 0; index < item.quantity; index += 1) {
      lineCents += baseUnitCents + (unitIndex < remainderCents ? 1n : 0n);
      unitIndex += 1n;
    }
    return {
      itemId: item.id,
      quantity: item.quantity,
      allocatedTotalCost: centsToMoney(lineCents),
    };
  });

  return {
    totalAmount: total.toFixed(2),
    totalQuantity,
    perUnitAverage: total.div(totalQuantity).toFixed(2),
    allocations,
  };
}

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
      include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
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
      totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      perUnitAverage: order.items.reduce((sum, item) => sum + item.quantity, 0) > 0
        ? new Prisma.Decimal(order.totalAmount).plus(order.shippingAmount).div(
            order.items.reduce((sum, item) => sum + item.quantity, 0),
          ).toFixed(2)
        : null,
      allocationVersion: allocationVersionFor(order),
      ...calculateAllocationSummary(
        order.totalAmount.toFixed(2),
        order.shippingAmount.toFixed(2),
        allocations,
      ),
    };
  }

  async getEqualPreview(ownerId: string, orderId: string) {
    const summary = await this.getSummary(ownerId, orderId);
    if (summary.allocationStatus === "CONFIRMED") {
      throw new ServiceError("ALLOCATION_ALREADY_CONFIRMED", "成本分摊已确认，不能重新平均。", 409);
    }
    const order = await db.purchaseOrder.findFirst({
      where: { id: orderId, ownerId },
      select: {
        totalAmount: true,
        shippingAmount: true,
        items: {
          select: { id: true, quantity: true, createdAt: true, updatedAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!order) {
      throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
    }
    return {
      orderId,
      allocationVersion: summary.allocationVersion,
      ...calculateEqualPurchaseCostAllocation(
        order.totalAmount.toFixed(2),
        order.shippingAmount.toFixed(2),
        order.items,
      ),
    };
  }

  async save(
    ownerId: string,
    orderId: string,
    allocations: AllocationValue[],
    confirm: boolean,
    expectedAllocationVersion?: string,
  ) {
    const summary = await this.getSummary(ownerId, orderId);
    if (
      expectedAllocationVersion &&
      expectedAllocationVersion !== summary.allocationVersion
    ) {
      throw new ServiceError(
        "ALLOCATION_PREVIEW_CONFLICT",
        "采购商品或金额已变更，请刷新后重新平均分摊。",
        409,
      );
    }
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

  /**
   * The current schema represents an allocation draft directly on the purchase
   * order. There is no separate draft row to delete, so the order ID is the
   * stable draft identifier returned to clients.
   */
  async discardDraft(
    ownerId: string,
    orderId: string,
    expectedAllocationVersion: string,
  ) {
    if (!expectedAllocationVersion.trim()) {
      throw new ServiceError(
        "ALLOCATION_DRAFT_VERSION_REQUIRED",
        "请刷新成本分摊草稿后再放弃。",
        400,
      );
    }

    return db.$transaction(async (tx) => {
      const orders = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "purchase_orders"
        WHERE "id" = ${orderId} AND "ownerId" = ${ownerId}
        FOR UPDATE
      `);
      if (!orders.length) {
        throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
      }

      const order = await tx.purchaseOrder.findFirst({
        where: { id: orderId, ownerId },
        include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
      });
      if (!order) {
        throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
      }

      const currentVersion = allocationVersionFor(order);
      if (currentVersion !== expectedAllocationVersion) {
        throw new ServiceError(
          "ALLOCATION_DRAFT_CONFLICT",
          "当前成本分摊草稿已发生变化，请刷新后重试。",
          409,
        );
      }
      if (order.allocationStatus === "CONFIRMED") {
        throw new ServiceError(
          "ALLOCATION_ALREADY_CONFIRMED",
          "该成本分摊已经正式应用，不能作为草稿放弃。",
          409,
        );
      }
      if (order.allocationStatus !== "DRAFT") {
        throw new ServiceError(
          "ALLOCATION_DRAFT_NOT_FOUND",
          "当前采购单没有可放弃的成本分摊草稿。",
          409,
        );
      }

      const allocatedTotal = order.items.reduce(
        (sum, item) => sum.plus(item.allocatedTotalCost ?? 0),
        new Prisma.Decimal(0),
      );
      const itemCount = order.items.length;
      const updated = await tx.purchaseOrder.updateMany({
        where: {
          id: orderId,
          ownerId,
          allocationStatus: "DRAFT",
          updatedAt: order.updatedAt,
        },
        data: { allocationStatus: "UNALLOCATED", allocationConfirmedAt: null },
      });
      if (updated.count !== 1) {
        throw new ServiceError(
          "ALLOCATION_DRAFT_CONFLICT",
          "当前成本分摊草稿已发生变化，请刷新后重试。",
          409,
        );
      }

      await tx.purchaseOrderItem.updateMany({
        where: { purchaseOrderId: orderId, id: { in: order.items.map((item) => item.id) } },
        data: { allocatedTotalCost: null },
      });
      await tx.purchaseOrderActionLog.create({
        data: {
          ownerId,
          purchaseOrderId: orderId,
          actionType: "COST_ALLOCATION_DRAFT_DISCARDED",
          reasonCode: "USER_DISCARDED_COST_ALLOCATION_DRAFT",
          note: `用户放弃成本分摊草稿以继续维护商品明细；原状态 DRAFT，分摊总额 ${allocatedTotal.toFixed(2)}，商品行数 ${itemCount}。`,
          beforeItemCount: itemCount,
          afterItemCount: itemCount,
        },
      });

      return {
        success: true,
        purchaseOrderId: orderId,
        // The active draft has no standalone model in the current schema.
        discardedDraftId: orderId,
        canEditItems: true,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export const costAllocationService = new CostAllocationService();
