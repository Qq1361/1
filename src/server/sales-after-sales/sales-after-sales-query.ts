import { Prisma, SaleAfterSaleStatus, SaleAfterSaleType } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { ACTIVE_SALES_AFTER_SALE_STATUSES, getAvailableActions, outstandingApprovedAmount, sumDecimals } from "./sales-after-sales-rules";
import { emptySaleOrderAfterSaleFinancial, getSalesAfterSaleFinancials, type SalesAfterSaleFinancials } from "@/server/reports/sales-after-sales-financials";

const detailInclude = {
  saleOrder: true,
  lines: { include: { saleLine: true, inventoryItem: true, refundAllocations: true, inspection: true } },
  refundRecords: { include: { allocations: true }, orderBy: { createdAt: "desc" } },
  inspections: { orderBy: { createdAt: "desc" } },
  actionLogs: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.SaleAfterSaleCaseInclude;
type CaseSource = Prisma.SaleAfterSaleCaseGetPayload<{ include: typeof detailInclude }>;

const money = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(2);
const nullableMoney = (value: Prisma.Decimal | null | undefined) => value == null ? null : value.toFixed(2);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

function caseTotals(afterSaleCase: CaseSource) {
  const requestedRefundTotal = sumDecimals(afterSaleCase.lines.map((line) => line.requestedRefundAmount));
  const approvedRefundTotal = sumDecimals(afterSaleCase.lines.map((line) => line.approvedRefundAmount));
  const actualRefundTotal = sumDecimals(afterSaleCase.refundRecords.map((record) => record.refundAmount));
  return {
    requestedRefundTotal,
    approvedRefundTotal,
    actualRefundTotal,
    remainingApprovedRefundTotal: Prisma.Decimal.max(new Prisma.Decimal(0), approvedRefundTotal.minus(actualRefundTotal)),
  };
}

function toDetailDto(
  afterSaleCase: CaseSource,
  orderTotals: { refunded: Prisma.Decimal; locked: Prisma.Decimal },
  financials?: SalesAfterSaleFinancials,
) {
  const totals = caseTotals(afterSaleCase);
  const originalActualReceivedAmount = afterSaleCase.saleOrder.actualReceivedAmount ?? new Prisma.Decimal(0);
  const orderFinancial = financials?.orders.get(afterSaleCase.saleOrderId)
    ?? emptySaleOrderAfterSaleFinancial(afterSaleCase.saleOrderId);
  return {
    id: afterSaleCase.id,
    caseNo: afterSaleCase.caseNo,
    type: afterSaleCase.type,
    status: afterSaleCase.status,
    reason: afterSaleCase.reason,
    note: afterSaleCase.note,
    requestedAt: iso(afterSaleCase.requestedAt), approvedAt: iso(afterSaleCase.approvedAt), rejectedAt: iso(afterSaleCase.rejectedAt),
    returnCarrierCode: afterSaleCase.returnCarrierCode, returnTrackingNo: afterSaleCase.returnTrackingNo,
    returnShippedAt: iso(afterSaleCase.returnShippedAt), returnReceivedAt: iso(afterSaleCase.returnReceivedAt),
    inspectedAt: iso(afterSaleCase.inspectedAt), completedAt: iso(afterSaleCase.completedAt), cancelledAt: iso(afterSaleCase.cancelledAt),
    createdAt: iso(afterSaleCase.createdAt), updatedAt: iso(afterSaleCase.updatedAt),
    saleOrder: {
      id: afterSaleCase.saleOrder.id, saleNo: afterSaleCase.saleOrder.saleNo, platform: afterSaleCase.saleOrder.platform,
      platformOrderNo: afterSaleCase.saleOrder.platformOrderNo, platformTradeNo: afterSaleCase.saleOrder.platformTradeNo,
      buyerName: afterSaleCase.saleOrder.buyerName, status: afterSaleCase.saleOrder.status, soldAt: iso(afterSaleCase.saleOrder.soldAt),
      confirmedAt: iso(afterSaleCase.saleOrder.confirmedAt), settledAt: iso(afterSaleCase.saleOrder.settledAt),
      grossAmount: money(afterSaleCase.saleOrder.grossAmount), expectedIncome: nullableMoney(afterSaleCase.saleOrder.expectedIncome),
      actualReceivedAmount: nullableMoney(afterSaleCase.saleOrder.actualReceivedAmount),
      originalProfit: money(orderFinancial.originalProfit),
    },
    lines: afterSaleCase.lines.map((line) => {
      const refundedAmount = sumDecimals(line.refundAllocations.map((allocation) => allocation.amount));
      const lineFinancial = financials?.lines.get(line.saleLineId);
      return {
        id: line.id, saleLineId: line.saleLineId, inventoryItemId: line.inventoryItemId,
        productNameSnapshot: line.productNameSnapshot, skuSnapshot: line.skuSnapshot, inventoryCodeSnapshot: line.inventoryCodeSnapshot,
        saleAmountSnapshot: nullableMoney(line.saleAmountSnapshot), saleAmountReliable: Boolean(line.saleAmountSnapshot?.greaterThan(0)),
        costAmountSnapshot: money(line.costAmountSnapshot), profitAmountSnapshot: nullableMoney(line.profitAmountSnapshot),
        requestedRefundAmount: money(line.requestedRefundAmount), approvedRefundAmount: nullableMoney(line.approvedRefundAmount),
        refundedAmount: money(refundedAmount), remainingApprovedRefundAmount: money(outstandingApprovedAmount(line.approvedRefundAmount, line.refundAllocations.map((allocation) => allocation.amount))),
        originalProfit: money(lineFinancial?.originalProfit ?? line.profitAmountSnapshot),
        lineRefundedAmount: money(lineFinancial?.refundedAmount ?? refundedAmount),
        restockedCostReversal: money(lineFinancial?.restockedCostReversal),
        afterSaleNetProfit: money(lineFinancial?.afterSaleNetProfit ?? line.profitAmountSnapshot),
        returnRequired: line.returnRequired, returnReceived: line.returnReceived, note: line.note,
        currentInventory: { itemStatus: line.inventoryItem.itemStatus, ownershipStatus: line.inventoryItem.ownershipStatus, storageLocation: line.inventoryItem.storageLocation, skuText: line.inventoryItem.skuText },
        inspection: line.inspection ? { id: line.inspection.id, result: line.inspection.result, storageLocation: line.inspection.storageLocation, problemReason: line.inspection.problemReason, note: line.inspection.note, inspectedAt: iso(line.inspection.inspectedAt) } : null,
      };
    }),
    refundRecords: afterSaleCase.refundRecords.map((record) => ({ id: record.id, refundAmount: money(record.refundAmount), refundedAt: iso(record.refundedAt), refundMethod: record.refundMethod, externalRefundNo: record.externalRefundNo, note: record.note, idempotencyKey: record.idempotencyKey, createdAt: iso(record.createdAt), allocations: record.allocations.map((allocation) => ({ id: allocation.id, afterSaleLineId: allocation.afterSaleLineId, amount: money(allocation.amount), createdAt: iso(allocation.createdAt) })) })),
    inspections: afterSaleCase.inspections.map((inspection) => ({ id: inspection.id, afterSaleLineId: inspection.afterSaleLineId, result: inspection.result, storageLocation: inspection.storageLocation, problemReason: inspection.problemReason, note: inspection.note, inspectedAt: iso(inspection.inspectedAt), createdAt: iso(inspection.createdAt) })),
    actionLogs: afterSaleCase.actionLogs.map((log) => ({ id: log.id, action: log.action, fromStatus: log.fromStatus, toStatus: log.toStatus, note: log.note, metadata: log.metadata, createdAt: iso(log.createdAt) })),
    totals: { requestedRefundTotal: money(totals.requestedRefundTotal), approvedRefundTotal: money(totals.approvedRefundTotal), actualRefundTotal: money(totals.actualRefundTotal), remainingApprovedRefundTotal: money(totals.remainingApprovedRefundTotal) },
    orderTotals: {
      originalActualReceivedAmount: money(originalActualReceivedAmount), orderTotalRefundedAmount: money(orderTotals.refunded), orderLockedApprovedAmount: money(orderTotals.locked),
      orderRemainingRefundableAmount: money(Prisma.Decimal.max(new Prisma.Decimal(0), originalActualReceivedAmount.minus(orderTotals.refunded).minus(orderTotals.locked))),
      orderNetReceivedAmount: money(orderFinancial.netReceivedAmount),
      originalProfit: money(orderFinancial.originalProfit),
      restockedCostReversal: money(orderFinancial.restockedCostReversal),
      afterSaleNetProfit: money(orderFinancial.afterSaleNetProfit),
      afterSaleCaseCount: orderFinancial.afterSaleCaseCount,
      afterSaleStatusSummary: orderFinancial.afterSaleStatusSummary,
    },
    availableActions: getAvailableActions(afterSaleCase.type, afterSaleCase.status),
  };
}

export class SalesAfterSalesQuery {
  private async getOrderTotals(ownerId: string, saleOrderId: string, excludeCaseId?: string) {
    const [refunded, active] = await Promise.all([
      db.saleRefundRecord.aggregate({ where: { ownerId, saleOrderId }, _sum: { refundAmount: true } }),
      db.saleAfterSaleCase.findMany({ where: { ownerId, saleOrderId, ...(excludeCaseId ? { id: { not: excludeCaseId } } : {}), status: { in: [...ACTIVE_SALES_AFTER_SALE_STATUSES] } }, include: { lines: { include: { refundAllocations: true } } } }),
    ]);
    return {
      refunded: refunded._sum.refundAmount ?? new Prisma.Decimal(0),
      locked: sumDecimals(active.flatMap((item) => item.lines.map((line) => outstandingApprovedAmount(line.approvedRefundAmount, line.refundAllocations.map((allocation) => allocation.amount))))),
    };
  }

  async getDetail(ownerId: string, id: string) {
    const afterSaleCase = await db.saleAfterSaleCase.findFirst({ where: { id, ownerId }, include: detailInclude });
    if (!afterSaleCase) throw new ServiceError("SALES_AFTER_SALE_NOT_FOUND", "销售售后单不存在。", 404);
    const financials = await getSalesAfterSaleFinancials(ownerId, [afterSaleCase.saleOrderId]);
    return toDetailDto(afterSaleCase, await this.getOrderTotals(ownerId, afterSaleCase.saleOrderId, id), financials);
  }

  async list(ownerId: string, filters: { page: number; pageSize: number; status?: string; type?: string; saleOrderId?: string; keyword?: string }) {
    const keyword = filters.keyword?.trim();
    const where: Prisma.SaleAfterSaleCaseWhereInput = {
      ownerId,
      ...(filters.status ? { status: filters.status as SaleAfterSaleStatus } : {}),
      ...(filters.type ? { type: filters.type as SaleAfterSaleType } : {}),
      ...(filters.saleOrderId ? { saleOrderId: filters.saleOrderId } : {}),
      ...(keyword ? { OR: [
        { caseNo: { contains: keyword, mode: "insensitive" } },
        { saleOrder: { saleNo: { contains: keyword, mode: "insensitive" } } },
        { saleOrder: { platformOrderNo: { contains: keyword, mode: "insensitive" } } },
        { lines: { some: { productNameSnapshot: { contains: keyword, mode: "insensitive" } } } },
        { lines: { some: { skuSnapshot: { contains: keyword, mode: "insensitive" } } } },
        { lines: { some: { inventoryCodeSnapshot: { contains: keyword, mode: "insensitive" } } } },
      ] } : {}),
    };
    const [total, cases] = await Promise.all([
      db.saleAfterSaleCase.count({ where }),
      db.saleAfterSaleCase.findMany({ where, include: detailInclude, orderBy: { createdAt: "desc" }, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
    ]);
    const financials = await getSalesAfterSaleFinancials(ownerId, cases.map((afterSaleCase) => afterSaleCase.saleOrderId));
    const items = await Promise.all(cases.map(async (afterSaleCase) => {
      const detail = toDetailDto(afterSaleCase, await this.getOrderTotals(ownerId, afterSaleCase.saleOrderId, afterSaleCase.id), financials);
      return { id: detail.id, caseNo: detail.caseNo, type: detail.type, status: detail.status, reason: detail.reason, saleOrder: detail.saleOrder, lineCount: detail.lines.length, requestedRefundTotal: detail.totals.requestedRefundTotal, approvedRefundTotal: detail.totals.approvedRefundTotal, actualRefundTotal: detail.totals.actualRefundTotal, originalActualReceivedAmount: detail.orderTotals.originalActualReceivedAmount, orderTotalRefundedAmount: detail.orderTotals.orderTotalRefundedAmount, orderNetReceivedAmount: detail.orderTotals.orderNetReceivedAmount, createdAt: detail.createdAt, updatedAt: detail.updatedAt, availableActions: detail.availableActions };
    }));
    return { items, page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) };
  }

  async eligibleLines(ownerId: string, filters: { saleOrderId: string; keyword?: string; page: number; pageSize: number }) {
    const sale = await db.saleOrder.findFirst({ where: { id: filters.saleOrderId, ownerId, status: "SETTLED", actualReceivedAmount: { gt: 0 } }, select: { id: true, saleNo: true } });
    if (!sale) throw new ServiceError("SALE_NOT_FOUND", "销售订单不存在、未到账或无权访问。", 404);
    const keyword = filters.keyword?.trim();
    const where: Prisma.SaleLineWhereInput = {
      ownerId, saleOrderId: sale.id,
      inventoryItem: { ownerId, itemStatus: "SOLD", ownershipStatus: "OWNED" },
      afterSaleLines: { none: { afterSaleCase: { ownerId, status: { in: [...ACTIVE_SALES_AFTER_SALE_STATUSES] } } } },
      ...(keyword ? { OR: [
        { inventoryCodeSnapshot: { contains: keyword, mode: "insensitive" } }, { productNameSnapshot: { contains: keyword, mode: "insensitive" } }, { skuSnapshot: { contains: keyword, mode: "insensitive" } },
        { inventoryItem: { inventoryCode: { contains: keyword, mode: "insensitive" } } },
      ] } : {}),
    };
    const [total, lines] = await Promise.all([
      db.saleLine.count({ where }),
      db.saleLine.findMany({ where, include: { inventoryItem: true, afterSaleLines: true }, orderBy: { createdAt: "asc" }, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
    ]);
    return {
      saleOrderId: sale.id, saleNo: sale.saleNo,
      items: lines.map((line) => ({ saleOrderId: line.saleOrderId, saleLineId: line.id, inventoryItemId: line.inventoryItemId, productName: line.productNameSnapshot, skuSnapshot: line.skuSnapshot, inventoryCodeSnapshot: line.inventoryCodeSnapshot, saleAmount: nullableMoney(line.saleAmount.greaterThan(0) ? line.saleAmount : null), saleAmountReliable: line.saleAmount.greaterThan(0), costAmount: money(line.costAmount), profitAmount: money(line.profitAmount), currentInventory: { inventoryCode: line.inventoryItem.inventoryCode, itemStatus: line.inventoryItem.itemStatus, ownershipStatus: line.inventoryItem.ownershipStatus, storageLocation: line.inventoryItem.storageLocation }, existingHistoricalAfterSaleCount: line.afterSaleLines.length })),
      page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize),
    };
  }
}

export const salesAfterSalesQuery = new SalesAfterSalesQuery();
