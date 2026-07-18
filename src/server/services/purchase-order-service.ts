import { Prisma } from "@/generated/prisma/client";
import { normalizeSku } from "@/lib/normalize-sku";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { LocalStorageAdapter } from "@/server/adapters/storage/local-storage-adapter";
import { isActivePurchaseAfterSaleStatus, sumDecimals } from "@/server/purchase-after-sales/purchase-after-sales-rules";
import { getSalesAfterSaleFinancials } from "@/server/reports/sales-after-sales-financials";
import {
  purchaseLogisticsRiskService,
  PURCHASE_LOGISTICS_RISK_TYPES,
} from "@/server/services/purchase-logistics-risk-service";
import type {
  OrderListQuery,
  PurchaseItemBatchInput,
  PurchaseItemMutationInput,
  PurchaseOrderInput,
} from "@/server/validation/purchase-order";

function serializeOrder<T>(value: T): T {
  const serialized = JSON.parse(
    JSON.stringify(value, (_, current) =>
      current instanceof Prisma.Decimal ? current.toFixed(2) : current,
    ),
  );
  const moneyKey = (key: string) => {
    const lower = key.toLowerCase();
    return lower.includes("amount") || lower.includes("cost") || lower.includes("profit");
  };
  function normalizeMoneyFields(current: unknown): unknown {
    if (Array.isArray(current)) return current.map(normalizeMoneyFields);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current).map(([key, item]) => [
        key,
        moneyKey(key) && typeof item === "string" && /^\d+(\.\d+)?$/.test(item)
          ? new Prisma.Decimal(item).toFixed(2)
          : normalizeMoneyFields(item),
      ]),
    );
  }
  return normalizeMoneyFields(serialized) as T;
}

const storage = new LocalStorageAdapter();
const purchaseOrderItemOrderBy = [{ createdAt: "asc" as const }, { id: "asc" as const }];

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

const purchaseItemEditableStatuses = new Set(["PAID", "WAITING_SHIPMENT", "IN_TRANSIT"]);

type PurchaseItemEditSnapshot = {
  id: string;
  status: string;
  allocationStatus: string;
  deliveredAt: Date | null;
  items: Array<{
    id: string;
    allocatedTotalCost: Prisma.Decimal | null;
    _count: { inventoryItems: number; inspections: number };
  }>;
  _count: { afterSaleCases: number; refundRecords: number };
};

type PurchaseItemDeleteSnapshot = {
  allocationStatus: string;
  items: Array<{
    id: string;
    allocatedTotalCost: Prisma.Decimal | null;
    _count: {
      inventoryItems: number;
      inspections: number;
      afterSaleLines: number;
    };
  }>;
};

type PurchaseItemDeleteability = {
  deletable: boolean;
  reasonCode: string | null;
  reason: string | null;
};

function purchaseItemEditLockReason(order: PurchaseItemEditSnapshot) {
  if (!purchaseItemEditableStatuses.has(order.status) || order.deliveredAt) {
    return "该订单已进入后续物流或收货流程，商品明细已锁定。";
  }
  if (order.allocationStatus !== "UNALLOCATED" || order.items.some((item) => item.allocatedTotalCost !== null)) {
    return order.allocationStatus === "DRAFT"
      ? "当前订单已有成本分摊草稿，请先处理草稿后再修改商品。"
      : "该订单已完成成本分摊，商品明细已锁定。";
  }
  if (order.items.some((item) => item._count.inventoryItems > 0)) {
    return "该订单已生成库存，不能直接修改原采购商品。";
  }
  if (order.items.some((item) => item._count.inspections > 0)) {
    return "该订单已开始验货，商品明细已锁定。";
  }
  if (order._count.afterSaleCases > 0) {
    return "该订单存在采购售后记录，不能直接修改商品。";
  }
  if (order._count.refundRecords > 0) {
    return "该订单存在采购退款记录，不能直接修改商品。";
  }
  return null;
}

function purchaseItemDeleteLockReason(
  order: PurchaseItemDeleteSnapshot,
  item: PurchaseItemDeleteSnapshot["items"][number],
): PurchaseItemDeleteability {
  if (order.items.length <= 1) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ORDER_REQUIRES_ITEM",
      reason: "采购订单至少需要保留一条商品，请先添加正确商品后再删除。",
    };
  }
  if (order.allocationStatus !== "UNALLOCATED" || item.allocatedTotalCost !== null) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_DOWNSTREAM_LOCKED",
      reason: "该采购订单已有成本分摊记录，商品明细已锁定。",
    };
  }
  if (item._count.inspections > 0 || item._count.inventoryItems > 0 || item._count.afterSaleLines > 0) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_DOWNSTREAM_LOCKED",
      reason: "该商品已产生后续业务记录，不能删除。",
    };
  }
  return { deletable: true, reasonCode: null, reason: null };
}

export class PurchaseOrderService {
  private async getPurchaseItemEditSnapshot(
    tx: Prisma.TransactionClient | typeof db,
    ownerId: string,
    orderId: string,
  ): Promise<PurchaseItemEditSnapshot> {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: orderId, ownerId },
      select: {
        id: true,
        status: true,
        allocationStatus: true,
        deliveredAt: true,
        items: {
          select: {
            id: true,
            allocatedTotalCost: true,
            _count: { select: { inventoryItems: true, inspections: true } },
          },
        },
        _count: { select: { afterSaleCases: true, refundRecords: true } },
      },
    });
    if (!order) {
      throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
    }
    return order;
  }

  private async getPurchaseItemDeleteSnapshot(
    tx: Prisma.TransactionClient | typeof db,
    ownerId: string,
    orderId: string,
  ): Promise<PurchaseItemDeleteSnapshot> {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: orderId, ownerId },
      select: {
        allocationStatus: true,
        items: {
          select: {
            id: true,
            allocatedTotalCost: true,
            _count: {
              select: {
                inventoryItems: true,
                inspections: true,
                afterSaleLines: true,
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
    }
    return order;
  }

  private async assertPurchaseItemsEditable(
    tx: Prisma.TransactionClient,
    ownerId: string,
    orderId: string,
  ) {
    const order = await this.getPurchaseItemEditSnapshot(tx, ownerId, orderId);
    const reason = purchaseItemEditLockReason(order);
    if (reason) {
      throw new ServiceError("PURCHASE_ITEM_EDIT_LOCKED", reason, 409);
    }
    return order;
  }

  async getPurchaseItemsEditability(ownerId: string, orderId: string) {
    const order = await this.getPurchaseItemEditSnapshot(db, ownerId, orderId);
    const reason = purchaseItemEditLockReason(order);
    return {
      editable: !reason,
      reasonCode: reason ? "PURCHASE_ITEM_EDIT_LOCKED" : null,
      reason,
    };
  }

  async getPurchaseItemsDeleteability(ownerId: string, orderId: string) {
    const order = await this.getPurchaseItemDeleteSnapshot(db, ownerId, orderId);
    return Object.fromEntries(
      order.items.map((item) => [item.id, purchaseItemDeleteLockReason(order, item)]),
    ) as Record<string, PurchaseItemDeleteability>;
  }

  async addPurchaseItem(
    ownerId: string,
    orderId: string,
    input: PurchaseItemMutationInput,
  ) {
    await db.$transaction(async (tx) => {
      await this.assertPurchaseItemsEditable(tx, ownerId, orderId);
      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: orderId,
          name: input.name,
          skuText: normalizeSku(input.skuText),
          quantity: input.quantity,
          referenceAmount: input.referenceAmount ? new Prisma.Decimal(input.referenceAmount) : null,
          notes: input.notes?.trim() || null,
        },
      });
    });
    return this.getOrder(ownerId, orderId);
  }

  async addPurchaseItemsBatch(
    ownerId: string,
    orderId: string,
    input: PurchaseItemBatchInput,
  ) {
    await db.$transaction(async (tx) => {
      await this.assertPurchaseItemsEditable(tx, ownerId, orderId);
      await tx.purchaseOrderItem.createMany({
        data: input.items.map((item) => ({
          purchaseOrderId: orderId,
          name: item.name,
          skuText: normalizeSku(item.skuText),
          quantity: 1,
          referenceAmount: item.referenceAmount
            ? new Prisma.Decimal(item.referenceAmount)
            : null,
          notes: item.notes?.trim() || null,
        })),
      });
    });
    return this.getOrder(ownerId, orderId);
  }

  async updatePurchaseItem(
    ownerId: string,
    orderId: string,
    itemId: string,
    input: PurchaseItemMutationInput,
  ) {
    await db.$transaction(async (tx) => {
      const order = await this.assertPurchaseItemsEditable(tx, ownerId, orderId);
      if (!order.items.some((item) => item.id === itemId)) {
        throw new ServiceError("PURCHASE_ITEM_NOT_FOUND", "商品明细不存在。", 404);
      }
      await tx.purchaseOrderItem.update({
        where: { id: itemId },
        data: {
          name: input.name,
          skuText: normalizeSku(input.skuText),
          quantity: input.quantity,
          referenceAmount: input.referenceAmount ? new Prisma.Decimal(input.referenceAmount) : null,
          notes: input.notes?.trim() || null,
        },
      });
    });
    return this.getOrder(ownerId, orderId);
  }

  async deletePurchaseItem(ownerId: string, orderId: string, itemId: string) {
    try {
      await db.$transaction(async (tx) => {
        const lockedOrders = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id" FROM "purchase_orders"
          WHERE "id" = ${orderId} AND "ownerId" = ${ownerId}
          FOR UPDATE
        `);
        if (!lockedOrders.length) {
          throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
        }

        const order = await this.getPurchaseItemDeleteSnapshot(tx, ownerId, orderId);
        const item = order.items.find((candidate) => candidate.id === itemId);
        if (!item) {
          throw new ServiceError("PURCHASE_ITEM_NOT_FOUND", "商品明细不存在。", 404);
        }
        const deleteability = purchaseItemDeleteLockReason(order, item);
        if (!deleteability.deletable) {
          throw new ServiceError(
            deleteability.reasonCode ?? "PURCHASE_ITEM_DELETE_CONFLICT",
            deleteability.reason ?? "商品明细当前不能删除。",
            409,
          );
        }
        await tx.purchaseOrderItem.delete({ where: { id: itemId } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ServiceError("PURCHASE_ITEM_DELETE_CONFLICT", "商品明细删除发生并发冲突，请刷新后重试。", 409);
      }
      throw error;
    }
    return this.getOrder(ownerId, orderId);
  }

  async createOrder(ownerId: string, input: PurchaseOrderInput) {
    try {
      const order = await db.$transaction(async (tx) =>
        tx.purchaseOrder.create({
          data: {
            ownerId,
            orderNo: input.orderNo,
            sellerNickname: input.sellerNickname?.trim() || null,
            paidAt: input.paidAt,
            totalAmount: new Prisma.Decimal(input.totalAmount),
            shippingAmount: new Prisma.Decimal(input.shippingAmount),
            notes: input.notes || null,
            items: {
              create: input.items.map((item) => ({
                name: item.name,
                skuText: normalizeSku(item.skuText),
                quantity: item.quantity,
                referenceAmount: item.referenceAmount ? new Prisma.Decimal(item.referenceAmount) : null,
                notes: item.notes || null,
              })),
            },
          },
          include: { items: { orderBy: purchaseOrderItemOrderBy } },
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
        items: {
          orderBy: purchaseOrderItemOrderBy,
          include: {
            inventoryItems: {
              orderBy: { createdAt: "asc" },
              include: {
                saleLines: {
                  orderBy: { createdAt: "desc" },
                  include: {
                    saleOrder: {
                      include: {
                        feeLines: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        afterSaleCases: {
          select: {
            id: true,
            status: true,
            refundRecords: { select: { refundAmount: true } },
          },
        },
      },
    });
    if (!order) {
      throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
    }
    const logisticsEvents =
      order.carrierCode && order.trackingNo
        ? await db.logisticsEvent.findMany({
            where: {
              ownerId,
              purchaseOrderId: orderId,
              carrierCode: order.carrierCode,
              trackingNo: order.trackingNo,
            },
            orderBy: { eventTime: "desc" },
            take: 20,
          })
        : [];
    const { afterSaleCases, ...orderDetail } = order;
    const paidTotal = order.totalAmount.plus(order.shippingAmount);
    const totalPurchaseRefundedAmount = sumDecimals(
      afterSaleCases.flatMap((afterSaleCase) =>
        afterSaleCase.refundRecords.map((record) => record.refundAmount),
      ),
    );
    const saleOrderIds = orderDetail.items.flatMap((item) => item.inventoryItems.flatMap((inventoryItem) =>
      inventoryItem.saleLines
        .filter((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status))
        .map((line) => line.saleOrderId),
    ));
    const salesAfterSaleFinancials = await getSalesAfterSaleFinancials(ownerId, saleOrderIds);
    const [purchaseItemsEditability, purchaseItemsDeleteability] = await Promise.all([
      this.getPurchaseItemsEditability(ownerId, orderId),
      this.getPurchaseItemsDeleteability(ownerId, orderId),
    ]);
    const items = orderDetail.items.map((item) => ({
      ...item,
      inventoryItems: item.inventoryItems.map((inventoryItem) => ({
        ...inventoryItem,
        saleLines: inventoryItem.saleLines.map((line) => {
          const financial = salesAfterSaleFinancials.lines.get(line.id);
          return {
            ...line,
            salesAfterSaleFinancials: financial ? {
              refundedAmount: financial.refundedAmount,
              restockedCostReversal: financial.restockedCostReversal,
              afterSaleNetProfit: financial.afterSaleNetProfit,
            } : null,
          };
        }),
      })),
    }));

    return serializeOrder({
      ...orderDetail,
      items,
      purchaseItemsEditability,
      purchaseItemsDeleteability,
      logisticsEvents,
      purchaseAfterSalesSummary: {
        totalPurchaseRefundedAmount,
        netPurchasePaidAmount: paidTotal.minus(totalPurchaseRefundedAmount),
        totalCaseCount: afterSaleCases.length,
        inProgressCaseCount: afterSaleCases.filter((afterSaleCase) =>
          isActivePurchaseAfterSaleStatus(afterSaleCase.status),
        ).length,
        completedCaseCount: afterSaleCases.filter(
          (afterSaleCase) => afterSaleCase.status === "COMPLETED",
        ).length,
      },
    });
  }

  async listOrders(ownerId: string, query: OrderListQuery) {
    const now = new Date();
    const where: Prisma.PurchaseOrderWhereInput = {
      ownerId,
      status: query.status,
      allocationStatus: query.allocationStatus,
      ...(query.query
        ? {
            OR: [
              { orderNo: { contains: query.query, mode: "insensitive" } },
              { sellerNickname: { contains: query.query, mode: "insensitive" } },
              {
                items: {
                  some: {
                    OR: [
                      { name: { contains: query.query, mode: "insensitive" } },
                      { skuText: { contains: query.query, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    if (query.todo === "missingTracking" || query.todo === "trackingNotReceivedOverdue") {
      const riskType = query.todo === "missingTracking"
        ? PURCHASE_LOGISTICS_RISK_TYPES.MISSING_TRACKING_NUMBER
        : PURCHASE_LOGISTICS_RISK_TYPES.TRACKING_NOT_RECEIVED_OVERDUE;
      const riskOrderIds = (await purchaseLogisticsRiskService.list(ownerId, now))
        .filter((risk) => risk.type === riskType)
        .map((risk) => risk.purchaseOrderId);
      where.id = { in: riskOrderIds };
    } else if (query.todo === "logisticsIssues") {
      where.logisticsStatus = { in: ["EXCEPTION", "STALLED"] };
      where.status = { not: "CANCELLED" };
    }
    if (query.tracking === "missing") {
      where.trackingNo = null;
      where.status = { not: "CANCELLED" };
    }
    // For todo filters, apply same ReminderState filtering as /api/todos
    if (query.todo) {
      const allOrders = await db.purchaseOrder.findMany({
        where,
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: "desc" },
      });
      const orderIds = allOrders.map((o) => o.id);
      // Fetch reminder states for these orders
      const reminderStates = await db.reminderState.findMany({
        where: {
          ownerId,
          entityType: "PURCHASE_ORDER",
          entityId: { in: orderIds },
          status: { in: ["SNOOZED", "RESOLVED"] },
        },
        select: { entityId: true, status: true, snoozedUntil: true, reasonKey: true, todoType: true },
      });
      const hiddenOrderIds = new Set<string>();
      for (const r of reminderStates) {
        if (r.status === "RESOLVED") { hiddenOrderIds.add(r.entityId); continue; }
        if (r.status === "SNOOZED" && r.snoozedUntil && r.snoozedUntil > now) { hiddenOrderIds.add(r.entityId); }
      }
      const filtered = allOrders.filter((o) => !hiddenOrderIds.has(o.id));
      const total = filtered.length;
      const data = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
      return serializeOrder({
        data,
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      });
    }

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
          sellerNickname: input.sellerNickname?.trim() || null,
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
              skuText: normalizeSku(item.skuText),
              quantity: item.quantity,
              referenceAmount: item.referenceAmount ? new Prisma.Decimal(item.referenceAmount) : null,
              notes: item.notes || null,
              allocatedTotalCost: null,
            },
          });
        } else {
          await tx.purchaseOrderItem.create({
            data: {
              purchaseOrderId: orderId,
              name: item.name,
              skuText: normalizeSku(item.skuText),
              quantity: item.quantity,
              referenceAmount: item.referenceAmount ? new Prisma.Decimal(item.referenceAmount) : null,
              notes: item.notes || null,
            },
          });
        }
      }
      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { orderBy: purchaseOrderItemOrderBy } },
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
