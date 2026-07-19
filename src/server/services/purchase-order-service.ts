import { Prisma } from "@/generated/prisma/client";
import { addCalendarMonthsClamped, formatDateOnly, parseDateOnly } from "@/lib/date-only";
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
  PurchaseItemEntryErrorRemovalInput,
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
  function normalizeFields(current: unknown): unknown {
    if (Array.isArray(current)) return current.map(normalizeFields);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current).map(([key, item]) => [
        key,
        (key === "productionDate" || key === "expiryDate") && typeof item === "string"
          ? formatDateOnly(item) ?? item
          : moneyKey(key) && typeof item === "string" && /^\d+(\.\d+)?$/.test(item)
          ? new Prisma.Decimal(item).toFixed(2)
          : normalizeFields(item),
      ]),
    );
  }
  return normalizeFields(serialized) as T;
}

type ShelfLifeInput = {
  productionDate?: string | null;
  shelfLifeMonths?: number | null;
  expiryDate?: string | null;
};

type ShelfLifeSnapshot = {
  productionDate: Date | null;
  shelfLifeMonths: number | null;
  expiryDate: Date | null;
};

function resolveShelfLife(input: ShelfLifeInput, existing?: ShelfLifeSnapshot): ShelfLifeSnapshot {
  const productionDate = input.productionDate === undefined
    ? existing?.productionDate ?? null
    : input.productionDate === null ? null : parseDateOnly(input.productionDate, "productionDate");
  const shelfLifeMonths = input.shelfLifeMonths === undefined
    ? existing?.shelfLifeMonths ?? null
    : input.shelfLifeMonths;
  let expiryDate = input.expiryDate === undefined
    ? existing?.expiryDate ?? null
    : input.expiryDate === null ? null : parseDateOnly(input.expiryDate, "expiryDate");

  if (expiryDate === null && productionDate && shelfLifeMonths) {
    expiryDate = addCalendarMonthsClamped(productionDate, shelfLifeMonths);
  }
  if (productionDate && expiryDate && expiryDate.getTime() < productionDate.getTime()) {
    throw new ServiceError(
      "SHELF_LIFE_DATE_ORDER_INVALID",
      "到期日期不能早于生产日期。",
      400,
      { expiryDate: ["到期日期不能早于生产日期。"] },
    );
  }
  return { productionDate, shelfLifeMonths, expiryDate };
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
  status: string;
  allocationStatus: string;
  manuallyReceivedAt: Date | null;
  deliveredAt: Date | null;
  _count: { afterSaleCases: number; refundRecords: number };
  inspectionAttachmentCounts: Map<string, number>;
  items: Array<{
    id: string;
    name: string;
    skuText: string | null;
    quantity: number;
    allocatedTotalCost: Prisma.Decimal | null;
    _count: {
      inventoryItems: number;
      afterSaleLines: number;
    };
    inspections: Array<{
      id: string;
      status: string;
      currentStep: number;
      hasBox: boolean | null;
      capCondition: string | null;
      paintCondition: string | null;
      leakageCondition: string | null;
      isNew: boolean | null;
      hasUsageTrace: boolean | null;
      batchCode: string | null;
      expiryDate: Date | null;
      appearanceNotes: string | null;
      result: string | null;
      notes: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
      inventoryItem: { id: string } | null;
      _count: { afterSaleLines: number };
    }>;
  }>;
};

type PurchaseItemDeleteability = {
  deletable: boolean;
  reasonCode: string | null;
  reason: string | null;
  entryErrorRemovable?: boolean;
  entryErrorRemovalReasonCode?: string | null;
  entryErrorRemovalReason?: string | null;
};

type PurchaseOrderActionLogWriter = (
  tx: Prisma.TransactionClient,
  data: Prisma.PurchaseOrderActionLogUncheckedCreateInput,
) => Promise<unknown>;

const writePurchaseOrderActionLog: PurchaseOrderActionLogWriter = (tx, data) =>
  tx.purchaseOrderActionLog.create({ data });

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
  if (item.inspections.length > 0 || item._count.inventoryItems > 0 || item._count.afterSaleLines > 0) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_DOWNSTREAM_LOCKED",
      reason: "该商品已产生后续业务记录，不能删除。",
    };
  }
  return { deletable: true, reasonCode: null, reason: null, entryErrorRemovable: false, entryErrorRemovalReasonCode: null, entryErrorRemovalReason: null };
}

function isUntouchedPendingInspection(
  inspection: PurchaseItemDeleteSnapshot["items"][number]["inspections"][number],
  attachmentCount: number,
) {
  return (
    inspection.status === "PENDING" &&
    inspection.currentStep === 1 &&
    inspection.hasBox === null &&
    inspection.capCondition === null &&
    inspection.paintCondition === null &&
    inspection.leakageCondition === null &&
    inspection.isNew === null &&
    inspection.hasUsageTrace === null &&
    inspection.batchCode === null &&
    inspection.expiryDate === null &&
    inspection.appearanceNotes === null &&
    inspection.result === null &&
    inspection.notes === null &&
    inspection.startedAt === null &&
    inspection.completedAt === null &&
    inspection.inventoryItem === null &&
    inspection._count.afterSaleLines === 0 &&
    attachmentCount === 0
  );
}

function purchaseItemEntryErrorRemovalLockReason(
  order: PurchaseItemDeleteSnapshot,
  item: PurchaseItemDeleteSnapshot["items"][number],
) {
  if (order.items.length <= 1) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_LAST_ITEM_DELETE_FORBIDDEN",
      reason: "采购订单至少需要保留一条商品，不能移除最后一件商品。",
    };
  }
  if (order.status !== "PENDING_INSPECTION" || !order.manuallyReceivedAt) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_ENTRY_ERROR_REMOVE_FORBIDDEN",
      reason: "仅人工签收后、尚未发生真实验货的待验货商品可移除为误录。",
    };
  }
  if (order.allocationStatus !== "UNALLOCATED" || item.allocatedTotalCost !== null) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_COST_ALLOCATION_LOCKED",
      reason: "该采购订单已有成本分摊记录，不能移除误录商品。",
    };
  }
  if (order._count.afterSaleCases > 0 || item._count.afterSaleLines > 0) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_AFTER_SALE_LOCKED",
      reason: "该采购订单存在采购售后依赖，不能移除误录商品。",
    };
  }
  if (order._count.refundRecords > 0) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_REFUND_LOCKED",
      reason: "该采购订单存在采购退款依赖，不能移除误录商品。",
    };
  }
  if (item._count.inventoryItems > 0) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_INVENTORY_EXISTS",
      reason: "该商品已生成库存，不能移除误录商品。",
    };
  }
  if (!item.inspections.length) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_ENTRY_ERROR_REMOVE_FORBIDDEN",
      reason: "未找到可安全撤销的待验货占位记录，不能移除商品。",
    };
  }
  if (item.inspections.length !== item.quantity) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_ENTRY_ERROR_REMOVE_FORBIDDEN",
      reason: "待验货记录与采购商品件数不一致，不能确认其为签收预创建记录。",
    };
  }
  if (
    item.inspections.some(
      (inspection) =>
        !isUntouchedPendingInspection(
          inspection,
          order.inspectionAttachmentCounts.get(inspection.id) ?? 0,
        ),
    )
  ) {
    return {
      deletable: false,
      reasonCode: "PURCHASE_ITEM_ALREADY_INSPECTED",
      reason: "该商品已有验货结果、备注、附件或其他验货事实，不能移除。",
    };
  }
  return { deletable: true, reasonCode: null, reason: null };
}

export class PurchaseOrderService {
  constructor(
    private readonly actionLogWriter: PurchaseOrderActionLogWriter = writePurchaseOrderActionLog,
  ) {}

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
        status: true,
        allocationStatus: true,
        manuallyReceivedAt: true,
        deliveredAt: true,
        items: {
          select: {
            id: true,
            name: true,
            skuText: true,
            quantity: true,
            allocatedTotalCost: true,
            _count: {
              select: {
                inventoryItems: true,
                afterSaleLines: true,
              },
            },
            inspections: {
              select: {
                id: true,
                status: true,
                currentStep: true,
                hasBox: true,
                capCondition: true,
                paintCondition: true,
                leakageCondition: true,
                isNew: true,
                hasUsageTrace: true,
                batchCode: true,
                expiryDate: true,
                appearanceNotes: true,
                result: true,
                notes: true,
                startedAt: true,
                completedAt: true,
                inventoryItem: { select: { id: true } },
                _count: { select: { afterSaleLines: true } },
              },
            },
          },
        },
        _count: { select: { afterSaleCases: true, refundRecords: true } },
      },
    });
    if (!order) {
      throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
    }
    const inspectionIds = order.items.flatMap((item) =>
      item.inspections.map((inspection) => inspection.id),
    );
    const attachmentCounts = inspectionIds.length
      ? await tx.attachment.groupBy({
          by: ["entityId"],
          where: {
            ownerId,
            entityType: "INSPECTION",
            entityId: { in: inspectionIds },
          },
          _count: { _all: true },
        })
      : [];
    return {
      ...order,
      inspectionAttachmentCounts: new Map(
        attachmentCounts.map((entry) => [entry.entityId, entry._count._all]),
      ),
    };
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
      order.items.map((item) => {
        const normal = purchaseItemDeleteLockReason(order, item);
        const entryError = purchaseItemEntryErrorRemovalLockReason(order, item);
        return [
          item.id,
          {
            ...normal,
            entryErrorRemovable: entryError.deletable,
            entryErrorRemovalReasonCode: entryError.reasonCode,
            entryErrorRemovalReason: entryError.reason,
          },
        ];
      }),
    ) as Record<string, PurchaseItemDeleteability>;
  }

  async addPurchaseItem(
    ownerId: string,
    orderId: string,
    input: PurchaseItemMutationInput,
  ) {
    await db.$transaction(async (tx) => {
      await this.assertPurchaseItemsEditable(tx, ownerId, orderId);
      const shelfLife = resolveShelfLife(input);
      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: orderId,
          name: input.name,
          skuText: normalizeSku(input.skuText),
          quantity: input.quantity,
          referenceAmount: input.referenceAmount ? new Prisma.Decimal(input.referenceAmount) : null,
          ...shelfLife,
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
          ...resolveShelfLife(item),
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
      const existing = await tx.purchaseOrderItem.findFirst({
        where: { id: itemId, purchaseOrderId: orderId },
        select: { productionDate: true, shelfLifeMonths: true, expiryDate: true },
      });
      if (!existing) {
        throw new ServiceError("PURCHASE_ITEM_NOT_FOUND", "商品明细不存在。", 404);
      }
      const shelfLife = resolveShelfLife(input, existing);
      await tx.purchaseOrderItem.update({
        where: { id: itemId },
        data: {
          name: input.name,
          skuText: normalizeSku(input.skuText),
          quantity: input.quantity,
          referenceAmount: input.referenceAmount ? new Prisma.Decimal(input.referenceAmount) : null,
          ...shelfLife,
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

  async removePurchaseItemAsEntryError(
    ownerId: string,
    orderId: string,
    itemId: string,
    input: PurchaseItemEntryErrorRemovalInput,
  ) {
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
        const removeability = purchaseItemEntryErrorRemovalLockReason(order, item);
        if (!removeability.deletable) {
          throw new ServiceError(
            removeability.reasonCode ?? "PURCHASE_ITEM_ENTRY_ERROR_REMOVE_FORBIDDEN",
            removeability.reason ?? "该商品当前不能作为误录商品移除。",
            409,
          );
        }

        const placeholderInspectionIds = item.inspections.map((inspection) => inspection.id);
        const removedPlaceholders = await tx.inspection.deleteMany({
          where: {
            id: { in: placeholderInspectionIds },
            ownerId,
            purchaseOrderItemId: item.id,
            status: "PENDING",
            currentStep: 1,
            hasBox: null,
            capCondition: null,
            paintCondition: null,
            leakageCondition: null,
            isNew: null,
            hasUsageTrace: null,
            batchCode: null,
            expiryDate: null,
            appearanceNotes: null,
            result: null,
            notes: null,
            startedAt: null,
            completedAt: null,
            inventoryItem: { is: null },
            afterSaleLines: { none: {} },
          },
        });
        if (removedPlaceholders.count !== placeholderInspectionIds.length) {
          throw new ServiceError(
            "PURCHASE_ITEM_DELETE_CONFLICT",
            "待验货记录已发生变化，请刷新后重试。",
            409,
          );
        }

        const remainingInspectionCount = await tx.inspection.count({
          where: {
            ownerId,
            purchaseOrderItemId: item.id,
          },
        });
        if (remainingInspectionCount > 0) {
          throw new ServiceError(
            "PURCHASE_ITEM_ALREADY_INSPECTED",
            "该商品存在不能撤销的验货记录，不能移除。",
            409,
          );
        }

        await tx.purchaseOrderItem.delete({ where: { id: item.id } });
        await this.actionLogWriter(tx, {
          ownerId,
          purchaseOrderId: orderId,
          purchaseOrderItemId: item.id,
          actionType: "PURCHASE_ITEM_REMOVED_AS_ENTRY_ERROR",
          productNameSnapshot: item.name,
          skuSnapshot: item.skuText,
          reasonCode: input.reason,
          note: input.note?.trim() || null,
          beforeItemCount: order.items.length,
          afterItemCount: order.items.length - 1,
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ServiceError("PURCHASE_ITEM_DELETE_CONFLICT", "商品明细纠错发生并发冲突，请刷新后重试。", 409);
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
                quantity: input.entryMode === "BATCH" ? 1 : item.quantity,
                referenceAmount: item.referenceAmount ? new Prisma.Decimal(item.referenceAmount) : null,
                ...resolveShelfLife(item),
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
