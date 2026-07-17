import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

const zero = new Prisma.Decimal(0);

export type SaleLineAfterSaleFinancial = {
  saleLineId: string;
  saleOrderId: string;
  originalProfit: Prisma.Decimal;
  refundedAmount: Prisma.Decimal;
  restockedCostReversal: Prisma.Decimal;
  afterSaleNetProfit: Prisma.Decimal;
  hasAfterSale: boolean;
  isRestocked: boolean;
  isProblemReturned: boolean;
};

export type SaleOrderAfterSaleFinancial = {
  saleOrderId: string;
  originalActualReceivedAmount: Prisma.Decimal;
  originalProfit: Prisma.Decimal;
  totalSalesRefundedAmount: Prisma.Decimal;
  netReceivedAmount: Prisma.Decimal;
  restockedCostReversal: Prisma.Decimal;
  afterSaleNetProfit: Prisma.Decimal;
  afterSaleCaseCount: number;
  activeAfterSaleCaseCount: number;
  refundedCaseCount: number;
  refundOnlyCaseCount: number;
  returnAndRefundCaseCount: number;
  restockedItemCount: number;
  problemReturnedItemCount: number;
  afterSaleStatusSummary: { status: string; count: number }[];
};

export type SalesAfterSaleFinancials = {
  orders: Map<string, SaleOrderAfterSaleFinancial>;
  lines: Map<string, SaleLineAfterSaleFinancial>;
  refundRecords: { id: string; saleOrderId: string; refundAmount: Prisma.Decimal; refundedAt: Date }[];
  cases: { id: string; saleOrderId: string; type: string; status: string; completedAt: Date | null }[];
  returnInspections: { afterSaleLineId: string; saleOrderId: string; result: string }[];
  restockEvents: { afterSaleLineId: string; saleOrderId: string; amount: Prisma.Decimal; completedAt: Date | null }[];
};

/**
 * Read-only financial projection for sales after-sales. Original SaleOrder and
 * SaleLine facts are deliberately never changed here.
 */
export async function getSalesAfterSaleFinancials(
  ownerId: string,
  saleOrderIds: string[],
): Promise<SalesAfterSaleFinancials> {
  const uniqueOrderIds = [...new Set(saleOrderIds)];
  if (!uniqueOrderIds.length) return { orders: new Map(), lines: new Map(), refundRecords: [], cases: [], returnInspections: [], restockEvents: [] };

  const [orders, saleLines, refundRecords, allocations, afterSaleLines] = await Promise.all([
    db.saleOrder.findMany({
      where: { ownerId, id: { in: uniqueOrderIds } },
      select: { id: true, actualReceivedAmount: true },
    }),
    db.saleLine.findMany({
      where: { ownerId, saleOrderId: { in: uniqueOrderIds } },
      select: { id: true, saleOrderId: true, inventoryItemId: true, profitAmount: true },
    }),
    db.saleRefundRecord.findMany({
      where: { ownerId, saleOrderId: { in: uniqueOrderIds } },
      select: { id: true, saleOrderId: true, afterSaleCaseId: true, refundAmount: true, refundedAt: true },
    }),
    db.saleRefundAllocation.findMany({
      where: { ownerId, refundRecord: { saleOrderId: { in: uniqueOrderIds } } },
      select: {
        id: true,
        amount: true,
        afterSaleLine: { select: { saleLineId: true } },
      },
    }),
    db.saleAfterSaleLine.findMany({
      where: { ownerId, afterSaleCase: { saleOrderId: { in: uniqueOrderIds } } },
      select: {
        id: true,
        afterSaleCaseId: true,
        saleLineId: true,
        inventoryItemId: true,
        costAmountSnapshot: true,
        afterSaleCase: { select: { saleOrderId: true, type: true, status: true, completedAt: true } },
        inspection: { select: { result: true } },
      },
    }),
  ]);

  const orderValues = new Map<string, SaleOrderAfterSaleFinancial>();
  const lineValues = new Map<string, SaleLineAfterSaleFinancial>();

  for (const order of orders) {
    orderValues.set(order.id, {
      saleOrderId: order.id,
      originalActualReceivedAmount: order.actualReceivedAmount ?? zero,
      originalProfit: zero,
      totalSalesRefundedAmount: zero,
      netReceivedAmount: order.actualReceivedAmount ?? zero,
      restockedCostReversal: zero,
      afterSaleNetProfit: zero,
      afterSaleCaseCount: 0,
      activeAfterSaleCaseCount: 0,
      refundedCaseCount: 0,
      refundOnlyCaseCount: 0,
      returnAndRefundCaseCount: 0,
      restockedItemCount: 0,
      problemReturnedItemCount: 0,
      afterSaleStatusSummary: [],
    });
  }

  for (const line of saleLines) {
    const financial = {
      saleLineId: line.id,
      saleOrderId: line.saleOrderId,
      originalProfit: line.profitAmount,
      refundedAmount: zero,
      restockedCostReversal: zero,
      afterSaleNetProfit: line.profitAmount,
      hasAfterSale: false,
      isRestocked: false,
      isProblemReturned: false,
    };
    lineValues.set(line.id, financial);
    const order = orderValues.get(line.saleOrderId);
    if (order) order.originalProfit = order.originalProfit.plus(line.profitAmount);
  }

  const refundedCaseIds = new Set<string>();
  const refundRecordIds = new Set<string>();
  for (const record of refundRecords) {
    if (refundRecordIds.has(record.id)) continue;
    refundRecordIds.add(record.id);
    refundedCaseIds.add(record.afterSaleCaseId);
    const order = orderValues.get(record.saleOrderId);
    if (order) order.totalSalesRefundedAmount = order.totalSalesRefundedAmount.plus(record.refundAmount);
  }

  const allocationIds = new Set<string>();
  for (const allocation of allocations) {
    if (allocationIds.has(allocation.id)) continue;
    allocationIds.add(allocation.id);
    const line = lineValues.get(allocation.afterSaleLine.saleLineId);
    if (line) line.refundedAmount = line.refundedAmount.plus(allocation.amount);
  }

  const casesByOrder = new Map<string, Map<string, { type: string; status: string; completedAt: Date | null }>>();
  const restockLogInventoryIds = new Set((await db.inventoryActionLog.findMany({
    where: {
      ownerId,
      inventoryItemId: { in: afterSaleLines.map((line) => line.inventoryItemId) },
      actionType: "SALES_AFTER_SALE_RESTOCKED",
      oldItemStatus: "SOLD",
      newItemStatus: "STOCKED",
    },
    select: { inventoryItemId: true },
  })).map((log) => log.inventoryItemId));
  const restockedInventoryIds = new Set<string>();
  const restockedLineIds = new Set<string>();
  const problemLineIds = new Set<string>();

  for (const afterSaleLine of afterSaleLines) {
    const orderId = afterSaleLine.afterSaleCase.saleOrderId;
    const order = orderValues.get(orderId);
    const line = lineValues.get(afterSaleLine.saleLineId);
    if (!order || !line) continue;
    line.hasAfterSale = true;

    const cases = casesByOrder.get(orderId) ?? new Map();
    cases.set(afterSaleLine.afterSaleCaseId, {
      type: afterSaleLine.afterSaleCase.type,
      status: afterSaleLine.afterSaleCase.status,
      completedAt: afterSaleLine.afterSaleCase.completedAt,
    });
    casesByOrder.set(orderId, cases);

    const isCompletedReturn = afterSaleLine.afterSaleCase.type === "RETURN_AND_REFUND"
      && afterSaleLine.afterSaleCase.status === "COMPLETED";
    if (isCompletedReturn && afterSaleLine.inspection?.result === "RESTOCKED" && restockLogInventoryIds.has(afterSaleLine.inventoryItemId)) {
      if (!restockedInventoryIds.has(afterSaleLine.inventoryItemId) && !restockedLineIds.has(afterSaleLine.saleLineId)) {
        restockedInventoryIds.add(afterSaleLine.inventoryItemId);
        restockedLineIds.add(afterSaleLine.saleLineId);
        line.restockedCostReversal = line.restockedCostReversal.plus(afterSaleLine.costAmountSnapshot);
        line.isRestocked = true;
      }
    }
    if (isCompletedReturn && afterSaleLine.inspection?.result === "PROBLEM" && !problemLineIds.has(afterSaleLine.saleLineId)) {
      problemLineIds.add(afterSaleLine.saleLineId);
      line.isProblemReturned = true;
    }
  }

  for (const [orderId, cases] of casesByOrder) {
    const order = orderValues.get(orderId);
    if (!order) continue;
    order.afterSaleCaseCount = cases.size;
    const statusCounts = new Map<string, number>();
    for (const [caseId, afterSaleCase] of cases) {
      statusCounts.set(afterSaleCase.status, (statusCounts.get(afterSaleCase.status) ?? 0) + 1);
      if (!["COMPLETED", "REJECTED", "CANCELLED"].includes(afterSaleCase.status)) order.activeAfterSaleCaseCount += 1;
      if (refundedCaseIds.has(caseId)) {
        order.refundedCaseCount += 1;
        if (afterSaleCase.type === "REFUND_ONLY") order.refundOnlyCaseCount += 1;
        if (afterSaleCase.type === "RETURN_AND_REFUND") order.returnAndRefundCaseCount += 1;
      }
    }
    order.afterSaleStatusSummary = [...statusCounts.entries()].map(([status, count]) => ({ status, count }));
  }

  const restockEvents = [...lineValues.values()]
    .filter((line) => line.isRestocked)
    .map((line) => {
      const source = afterSaleLines.find((item) => item.saleLineId === line.saleLineId && item.inspection?.result === "RESTOCKED" && item.afterSaleCase.status === "COMPLETED");
      return {
        afterSaleLineId: source?.id ?? line.saleLineId,
        saleOrderId: line.saleOrderId,
        amount: line.restockedCostReversal,
        completedAt: source?.afterSaleCase.completedAt ?? null,
      };
    });

  for (const line of lineValues.values()) {
    line.afterSaleNetProfit = line.originalProfit.minus(line.refundedAmount).plus(line.restockedCostReversal);
    const order = orderValues.get(line.saleOrderId);
    if (!order) continue;
    order.restockedCostReversal = order.restockedCostReversal.plus(line.restockedCostReversal);
    if (line.isRestocked) order.restockedItemCount += 1;
    if (line.isProblemReturned) order.problemReturnedItemCount += 1;
  }

  for (const order of orderValues.values()) {
    order.netReceivedAmount = order.originalActualReceivedAmount.minus(order.totalSalesRefundedAmount);
    order.afterSaleNetProfit = order.originalProfit
      .minus(order.totalSalesRefundedAmount)
      .plus(order.restockedCostReversal);
  }

  const cases = [...casesByOrder.entries()].flatMap(([saleOrderId, values]) => [...values.entries()]
    .map(([id, value]) => ({ id, saleOrderId, ...value })));
  const returnInspections = afterSaleLines
    .filter((line) => line.afterSaleCase.type === "RETURN_AND_REFUND" && line.inspection)
    .map((line) => ({
      afterSaleLineId: line.id,
      saleOrderId: line.afterSaleCase.saleOrderId,
      result: line.inspection!.result,
    }));

  return { orders: orderValues, lines: lineValues, refundRecords, cases, returnInspections, restockEvents };
}

export function emptySaleOrderAfterSaleFinancial(saleOrderId: string): SaleOrderAfterSaleFinancial {
  return {
    saleOrderId,
    originalActualReceivedAmount: zero,
    originalProfit: zero,
    totalSalesRefundedAmount: zero,
    netReceivedAmount: zero,
    restockedCostReversal: zero,
    afterSaleNetProfit: zero,
    afterSaleCaseCount: 0,
    activeAfterSaleCaseCount: 0,
    refundedCaseCount: 0,
    refundOnlyCaseCount: 0,
    returnAndRefundCaseCount: 0,
    restockedItemCount: 0,
    problemReturnedItemCount: 0,
    afterSaleStatusSummary: [],
  };
}
