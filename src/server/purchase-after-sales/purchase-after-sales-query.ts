import { Prisma, PurchaseAfterSaleStatus, PurchaseAfterSaleType } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { ACTIVE_PURCHASE_AFTER_SALE_STATUSES, getPurchaseAfterSaleAvailableActions, sumDecimals } from "./purchase-after-sales-rules";

const detailInclude = {
  purchaseOrder: true,
  lines: {
    include: {
      inventoryItem: true,
      inspection: true,
      refundAllocations: true,
    },
  },
  refundRecords: { include: { allocations: true }, orderBy: { createdAt: "desc" } },
  actionLogs: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.PurchaseAfterSaleCaseInclude;

type CaseSource = Prisma.PurchaseAfterSaleCaseGetPayload<{ include: typeof detailInclude }>;

const money = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(2);
const nullableMoney = (value: Prisma.Decimal | null | undefined) => value == null ? null : value.toFixed(2);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

function toDetailDto(afterSaleCase: CaseSource) {
  const requestedRefundTotal = sumDecimals(afterSaleCase.lines.map((line) => line.requestedRefundAmount));
  const approvedRefundTotal = sumDecimals(afterSaleCase.lines.map((line) => line.approvedRefundAmount));
  const actualRefundTotal = sumDecimals(afterSaleCase.refundRecords.map((record) => record.refundAmount));
  const remainingApprovedRefundTotal = Prisma.Decimal.max(new Prisma.Decimal(0), approvedRefundTotal.minus(actualRefundTotal));
  const paidTotal = afterSaleCase.purchaseOrder.totalAmount.plus(afterSaleCase.purchaseOrder.shippingAmount);

  return {
    id: afterSaleCase.id,
    caseNo: afterSaleCase.caseNo,
    type: afterSaleCase.type,
    status: afterSaleCase.status,
    reason: afterSaleCase.reason,
    note: afterSaleCase.note,
    requestedAt: iso(afterSaleCase.requestedAt),
    approvedAt: iso(afterSaleCase.approvedAt),
    rejectedAt: iso(afterSaleCase.rejectedAt),
    returnCarrierCode: afterSaleCase.returnCarrierCode,
    returnTrackingNo: afterSaleCase.returnTrackingNo,
    returnShippedAt: iso(afterSaleCase.returnShippedAt),
    sellerReceivedAt: iso(afterSaleCase.sellerReceivedAt),
    completedAt: iso(afterSaleCase.completedAt),
    cancelledAt: iso(afterSaleCase.cancelledAt),
    createdAt: iso(afterSaleCase.createdAt),
    updatedAt: iso(afterSaleCase.updatedAt),
    purchaseOrder: {
      id: afterSaleCase.purchaseOrder.id,
      orderNo: afterSaleCase.purchaseOrder.orderNo,
      status: afterSaleCase.purchaseOrder.status,
      paidAt: iso(afterSaleCase.purchaseOrder.paidAt),
      totalAmount: money(afterSaleCase.purchaseOrder.totalAmount),
      shippingAmount: money(afterSaleCase.purchaseOrder.shippingAmount),
      paidTotal: money(paidTotal),
      sellerNickname: afterSaleCase.purchaseOrder.sellerNickname,
    },
    lines: afterSaleCase.lines.map((line) => {
      const refundedAmount = sumDecimals(line.refundAllocations.map((allocation) => allocation.amount));
      const remainingApprovedRefundAmount = line.approvedRefundAmount == null
        ? null
        : money(Prisma.Decimal.max(new Prisma.Decimal(0), line.approvedRefundAmount.minus(refundedAmount)));
      return {
        id: line.id,
        purchaseOrderItemId: line.purchaseOrderItemId,
        inspectionId: line.inspectionId,
        inventoryItemId: line.inventoryItemId,
        productNameSnapshot: line.productNameSnapshot,
        skuSnapshot: line.skuSnapshot,
        inventoryCodeSnapshot: line.inventoryCodeSnapshot,
        costAmountSnapshot: money(line.costAmountSnapshot),
        requestedRefundAmount: money(line.requestedRefundAmount),
        approvedRefundAmount: nullableMoney(line.approvedRefundAmount),
        refundedAmount: money(refundedAmount),
        allocatedRefundAmount: money(refundedAmount),
        netCashCost: money(line.costAmountSnapshot.minus(refundedAmount)),
        remainingApprovedRefundAmount,
        returnRequired: line.returnRequired,
        returnedToSeller: line.returnedToSeller,
        note: line.note,
        currentInventory: {
          itemStatus: line.inventoryItem.itemStatus,
          ownershipStatus: line.inventoryItem.ownershipStatus,
          skuText: line.inventoryItem.skuText,
        },
        inspection: {
          result: line.inspection.result,
          completedAt: iso(line.inspection.completedAt),
          notes: line.inspection.notes,
        },
      };
    }),
    refundRecords: afterSaleCase.refundRecords.map((record) => ({
      id: record.id,
      refundAmount: money(record.refundAmount),
      refundedAt: iso(record.refundedAt),
      refundMethod: record.refundMethod,
      externalRefundNo: record.externalRefundNo,
      note: record.note,
      createdAt: iso(record.createdAt),
      allocations: record.allocations.map((allocation) => ({
        id: allocation.id,
        afterSaleLineId: allocation.afterSaleLineId,
        amount: money(allocation.amount),
        createdAt: iso(allocation.createdAt),
      })),
    })),
    actionLogs: afterSaleCase.actionLogs.map((log) => ({
      id: log.id,
      action: log.action,
      fromStatus: log.fromStatus,
      toStatus: log.toStatus,
      note: log.note,
      metadata: log.metadata,
      createdAt: iso(log.createdAt),
    })),
    totals: {
      requestedRefundTotal: money(requestedRefundTotal),
      approvedRefundTotal: money(approvedRefundTotal),
      actualRefundTotal: money(actualRefundTotal),
      remainingApprovedRefundTotal: money(remainingApprovedRefundTotal),
    },
    availableActions: getPurchaseAfterSaleAvailableActions(afterSaleCase.type, afterSaleCase.status),
  };
}

export class PurchaseAfterSalesQuery {
  async getDetail(ownerId: string, id: string) {
    const afterSaleCase = await db.purchaseAfterSaleCase.findFirst({
      where: { id, ownerId },
      include: detailInclude,
    });
    if (!afterSaleCase) throw new ServiceError("PURCHASE_AFTER_SALE_NOT_FOUND", "采购售后单不存在。", 404);
    return toDetailDto(afterSaleCase);
  }

  async list(ownerId: string, filters: {
    page: number;
    pageSize: number;
    status?: string;
    type?: string;
    purchaseOrderId?: string;
    keyword?: string;
  }) {
    const keyword = filters.keyword?.trim();
    const where: Prisma.PurchaseAfterSaleCaseWhereInput = {
      ownerId,
      ...(filters.status ? { status: filters.status as PurchaseAfterSaleStatus } : {}),
      ...(filters.type ? { type: filters.type as PurchaseAfterSaleType } : {}),
      ...(filters.purchaseOrderId ? { purchaseOrderId: filters.purchaseOrderId } : {}),
      ...(keyword ? {
        OR: [
          { caseNo: { contains: keyword, mode: "insensitive" } },
          { purchaseOrder: { orderNo: { contains: keyword, mode: "insensitive" } } },
          { lines: { some: { productNameSnapshot: { contains: keyword, mode: "insensitive" } } } },
          { lines: { some: { skuSnapshot: { contains: keyword, mode: "insensitive" } } } },
          { lines: { some: { inventoryCodeSnapshot: { contains: keyword, mode: "insensitive" } } } },
        ],
      } : {}),
    };
    const [total, cases] = await Promise.all([
      db.purchaseAfterSaleCase.count({ where }),
      db.purchaseAfterSaleCase.findMany({
        where,
        include: detailInclude,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
    ]);
    const items = cases.map((afterSaleCase) => {
      const detail = toDetailDto(afterSaleCase);
      return {
        id: detail.id,
        caseNo: detail.caseNo,
        type: detail.type,
        status: detail.status,
        reason: detail.reason,
        purchaseOrder: detail.purchaseOrder,
        lineCount: detail.lines.length,
        requestedRefundTotal: detail.totals.requestedRefundTotal,
        approvedRefundTotal: detail.totals.approvedRefundTotal,
        actualRefundTotal: detail.totals.actualRefundTotal,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        availableActions: detail.availableActions,
      };
    });
    return { items, page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) };
  }

  async eligibleItems(ownerId: string, filters: { purchaseOrderId: string; keyword?: string; page: number; pageSize: number }) {
    const order = await db.purchaseOrder.findFirst({ where: { id: filters.purchaseOrderId, ownerId }, select: { id: true } });
    if (!order) throw new ServiceError("PURCHASE_ORDER_NOT_FOUND", "采购订单不存在或无权访问。", 404);
    const keyword = filters.keyword?.trim();
    const where: Prisma.InventoryItemWhereInput = {
      ownerId,
      itemStatus: "PROBLEM",
      ownershipStatus: "OWNED",
      purchaseOrderItem: { purchaseOrderId: order.id },
      inspection: { ownerId, completedAt: { not: null }, result: "PROBLEM" },
      // Draft cases do not occupy an item; only active after-sales cases do.
      purchaseAfterSaleLines: {
      none: {
        afterSaleCase: {
          ownerId,
          status: { in: [...ACTIVE_PURCHASE_AFTER_SALE_STATUSES] },
        },
      },
      },
    };
    if (keyword) {
      where.OR = [
        { inventoryCode: { contains: keyword, mode: "insensitive" } },
        { name: { contains: keyword, mode: "insensitive" } },
        { skuText: { contains: keyword, mode: "insensitive" } },
      ];
    }
    const [total, items] = await Promise.all([
      db.inventoryItem.count({ where }),
      db.inventoryItem.findMany({
        where,
        include: { inspection: true, purchaseOrderItem: true },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
    ]);
    return {
      items: items.map((item) => ({
        purchaseOrderItemId: item.purchaseOrderItemId,
        inspectionId: item.inspectionId,
        inventoryItemId: item.id,
        productName: item.name,
        normalizedSku: item.skuText,
        inventoryCode: item.inventoryCode,
        costAmount: money(item.unitCost),
        inspectionProblemReason: item.problemReason ?? item.inspection.notes,
        inspectionCompletedAt: iso(item.inspection.completedAt),
      })),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    };
  }
}

export const purchaseAfterSalesQuery = new PurchaseAfterSalesQuery();
