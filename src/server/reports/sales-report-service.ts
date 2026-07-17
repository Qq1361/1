import { Prisma } from "@/generated/prisma/client";
import { normalizeSku } from "@/lib/normalize-sku";
import { db } from "@/server/db";
import { emptySaleOrderAfterSaleFinancial, getSalesAfterSaleFinancials, type SaleOrderAfterSaleFinancial } from "./sales-after-sales-financials";

const VALID_REPORT_STATUSES = ["CONFIRMED", "SETTLED"] as const;
const DEFAULT_OVERDUE_DAYS = 7;

type ReportStatus = (typeof VALID_REPORT_STATUSES)[number];
type SettlementStatus = "ALL" | "SETTLED" | "UNSETTLED";

export type SalesReportFilters = {
  ownerId: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  platform?: string;
  status?: ReportStatus;
  settlementStatus?: SettlementStatus;
  keyword?: string;
  purchaseOrderNo?: string;
  sellerNickname?: string;
  storageLocation?: string;
  saleMode?: string;
  granularity?: "day" | "week" | "month";
};

export type SalesReportOrdersFilters = SalesReportFilters & {
  page?: number;
  pageSize?: number;
  productNameExact?: string;
  skuExact?: string;
  skuEmpty?: boolean;
};

export type SalesProductReportFilters = SalesReportFilters & {
  page?: number;
  pageSize?: number;
  sortBy?: "soldItemCount" | "profitTotal" | "afterSaleNetProfit" | "refundedAmountTotal" | "restockedItemCount" | "averageProfitPerItem" | "inventoryCostTotal" | "lastSoldAt";
  sortOrder?: "asc" | "desc";
};

type SaleOrderForReport = Prisma.SaleOrderGetPayload<{
  include: {
    lines: true;
    feeLines: true;
  };
}>;

const zero = new Prisma.Decimal(0);

function decimal(value: string | number | Prisma.Decimal | null | undefined) {
  return value == null ? zero : new Prisma.Decimal(value);
}

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2).toFixed(2);
}

function nullableRate(numerator: Prisma.Decimal, denominator: Prisma.Decimal) {
  if (denominator.isZero()) return null;
  return numerator.div(denominator).toDecimalPlaces(4).toNumber();
}

function effectiveReportDate(order: SaleOrderForReport) {
  return order.soldAt ?? order.confirmedAt ?? order.createdAt;
}

function parseDate(value?: Date | string) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function isUnsettled(order: SaleOrderForReport) {
  return order.status === "CONFIRMED" && order.actualReceivedAmount == null;
}

function daysBetween(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function periodKey(date: Date, granularity: "day" | "week" | "month") {
  if (granularity === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  if (granularity === "week") {
    const value = new Date(date);
    const day = value.getDay() || 7;
    value.setDate(value.getDate() - day + 1);
    return value.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function createTrendBucket(period: string) {
  return {
    period,
    originalActualReceivedAmount: zero,
    refundedAmount: zero,
    netReceivedAmount: zero,
    originalProfit: zero,
    afterSaleNetProfit: zero,
  };
}

function inventoryCost(order: SaleOrderForReport) {
  return order.lines.reduce((sum, line) => {
    const costAmount = decimal(line.costAmount);
    return sum.plus(costAmount.isZero() ? decimal(line.unitCostSnapshot) : costAmount);
  }, zero);
}

function feeTotal(order: SaleOrderForReport) {
  return order.feeLines.reduce((sum, fee) => sum.plus(fee.amount), zero);
}

function profitTotal(order: SaleOrderForReport) {
  return order.lines.reduce((sum, line) => sum.plus(line.profitAmount), zero);
}

function soldItemCount(order: SaleOrderForReport) {
  return order.lines.length;
}

function actualReceivedForReport(order: SaleOrderForReport) {
  if (order.status === "SETTLED" || order.actualReceivedAmount != null) {
    return decimal(order.actualReceivedAmount);
  }
  return zero;
}

function matchesKeyword(order: SaleOrderForReport, keyword?: string) {
  const value = keyword?.trim().toLowerCase();
  if (!value) return true;

  const candidates = [
    order.saleNo,
    order.platformOrderNo,
    order.platformTradeNo,
    order.buyerName,
    ...order.lines.flatMap((line) => [
      line.productNameSnapshot,
      line.skuSnapshot,
    ]),
  ];

  return candidates.some((candidate) => candidate?.toLowerCase().includes(value));
}

function createMoneyBucket() {
  return {
    orderCount: 0,
    soldItemCount: 0,
    grossAmountTotal: zero,
    expectedIncomeTotal: zero,
    actualReceivedAmountTotal: zero,
    inventoryCostTotal: zero,
    feeTotal: zero,
    shippingCostTotal: zero,
    otherCostTotal: zero,
    profitTotal: zero,
    totalSalesRefundedAmount: zero,
    netReceivedAmount: zero,
    restockedCostReversal: zero,
    afterSaleNetProfit: zero,
    refundOrderIds: new Set<string>(),
    refundOnlyOrderIds: new Set<string>(),
    returnAndRefundOrderIds: new Set<string>(),
    restockedItemCount: 0,
    problemReturnedItemCount: 0,
  };
}

function addOrderToBucket(bucket: ReturnType<typeof createMoneyBucket>, order: SaleOrderForReport) {
  bucket.orderCount += 1;
  bucket.soldItemCount += soldItemCount(order);
  bucket.grossAmountTotal = bucket.grossAmountTotal.plus(order.grossAmount);
  bucket.expectedIncomeTotal = bucket.expectedIncomeTotal.plus(decimal(order.expectedIncome));
  bucket.actualReceivedAmountTotal = bucket.actualReceivedAmountTotal.plus(actualReceivedForReport(order));
  bucket.inventoryCostTotal = bucket.inventoryCostTotal.plus(inventoryCost(order));
  bucket.feeTotal = bucket.feeTotal.plus(feeTotal(order));
  bucket.shippingCostTotal = bucket.shippingCostTotal.plus(order.shippingCost);
  bucket.otherCostTotal = bucket.otherCostTotal.plus(order.otherCost);
  bucket.profitTotal = bucket.profitTotal.plus(profitTotal(order));
}

function addAfterSaleFinancialsToBucket(
  bucket: ReturnType<typeof createMoneyBucket>,
  order: SaleOrderForReport,
  financial: SaleOrderAfterSaleFinancial,
) {
  bucket.totalSalesRefundedAmount = bucket.totalSalesRefundedAmount.plus(financial.totalSalesRefundedAmount);
  bucket.netReceivedAmount = bucket.netReceivedAmount.plus(financial.netReceivedAmount);
  bucket.restockedCostReversal = bucket.restockedCostReversal.plus(financial.restockedCostReversal);
  bucket.afterSaleNetProfit = bucket.afterSaleNetProfit.plus(financial.afterSaleNetProfit);
  if (financial.totalSalesRefundedAmount.greaterThan(0)) bucket.refundOrderIds.add(order.id);
  if (financial.refundOnlyCaseCount > 0) bucket.refundOnlyOrderIds.add(order.id);
  if (financial.returnAndRefundCaseCount > 0) bucket.returnAndRefundOrderIds.add(order.id);
  bucket.restockedItemCount += financial.restockedItemCount;
  bucket.problemReturnedItemCount += financial.problemReturnedItemCount;
}

function serializeSummaryBucket(bucket: ReturnType<typeof createMoneyBucket>) {
  const marginDenominator = bucket.actualReceivedAmountTotal.isZero()
    ? bucket.expectedIncomeTotal
    : bucket.actualReceivedAmountTotal;

  return {
    totalOrderCount: bucket.orderCount,
    totalSoldItemCount: bucket.soldItemCount,
    grossAmountTotal: money(bucket.grossAmountTotal),
    expectedIncomeTotal: money(bucket.expectedIncomeTotal),
    actualReceivedAmountTotal: money(bucket.actualReceivedAmountTotal),
    inventoryCostTotal: money(bucket.inventoryCostTotal),
    feeTotal: money(bucket.feeTotal),
    shippingCostTotal: money(bucket.shippingCostTotal),
    otherCostTotal: money(bucket.otherCostTotal),
    profitTotal: money(bucket.profitTotal),
    originalProfitTotal: money(bucket.profitTotal),
    totalSalesRefundedAmount: money(bucket.totalSalesRefundedAmount),
    netReceivedAmount: money(bucket.netReceivedAmount),
    restockedCostReversal: money(bucket.restockedCostReversal),
    afterSaleNetProfit: money(bucket.afterSaleNetProfit),
    refundedOrderCount: bucket.refundOrderIds.size,
    refundOnlyOrderCount: bucket.refundOnlyOrderIds.size,
    returnAndRefundOrderCount: bucket.returnAndRefundOrderIds.size,
    restockedItemCount: bucket.restockedItemCount,
    problemReturnedItemCount: bucket.problemReturnedItemCount,
    grossMarginRate: nullableRate(bucket.profitTotal, marginDenominator),
    averageProfitPerItem: bucket.soldItemCount === 0
      ? null
      : bucket.profitTotal.div(bucket.soldItemCount).toDecimalPlaces(2).toNumber(),
  };
}

function lineGrossAmount(order: SaleOrderForReport, line: SaleOrderForReport["lines"][number]) {
  const saleAmount = decimal(line.saleAmount);
  if (!saleAmount.isZero()) return saleAmount;
  if (order.lines.length === 0) return zero;
  return decimal(order.grossAmount).div(order.lines.length);
}

function allocateOrderAmountByLineGross(
  order: SaleOrderForReport,
  lineGross: Prisma.Decimal,
  orderAmount: Prisma.Decimal | null,
) {
  if (!orderAmount || orderAmount.isZero() || order.grossAmount.isZero()) return zero;
  return orderAmount.mul(lineGross).div(order.grossAmount);
}

function filterReportOrders(
  orders: SaleOrderForReport[],
  filters: SalesReportFilters & Partial<Pick<SalesReportOrdersFilters, "productNameExact" | "skuExact" | "skuEmpty">>,
) {
  const dateFrom = parseDate(filters.dateFrom);
  const dateTo = parseDate(filters.dateTo);
  const settlementStatus = filters.settlementStatus ?? "ALL";

  return orders.filter((order) => {
    if (settlementStatus === "SETTLED" && order.status !== "SETTLED") return false;
    if (settlementStatus === "UNSETTLED" && !isUnsettled(order)) return false;
    if (!matchesKeyword(order, filters.keyword)) return false;
    if (filters.productNameExact || filters.skuExact || filters.skuEmpty) {
      const hasExactLine = order.lines.some((line) => {
        if (filters.productNameExact && line.productNameSnapshot !== filters.productNameExact) return false;
        const sku = normalizeSku(line.skuSnapshot);
        if (filters.skuEmpty) return sku == null;
        return !filters.skuExact || sku === normalizeSku(filters.skuExact);
      });
      if (!hasExactLine) return false;
    }

    const reportDate = effectiveReportDate(order);
    if (dateFrom && reportDate < dateFrom) return false;
    if (dateTo && reportDate > dateTo) return false;

    // TODO(M3-B): purchaseOrderNo, sellerNickname, storageLocation and saleMode
    // need joins against purchase/inventory data. Keep this read-only report layer
    // limited to stable sales-order fields until those joins are designed.
    void filters.purchaseOrderNo;
    void filters.sellerNickname;
    void filters.storageLocation;
    void filters.saleMode;

    return true;
  });
}

function lineSummary(order: SaleOrderForReport) {
  const grouped = new Map<string, { name: string; sku: string | null; count: number }>();

  for (const line of order.lines) {
    const key = `${line.productNameSnapshot}\u0000${line.skuSnapshot ?? ""}`;
    const current = grouped.get(key) ?? {
      name: line.productNameSnapshot,
      sku: line.skuSnapshot,
      count: 0,
    };
    current.count += 1;
    grouped.set(key, current);
  }

  if (grouped.size === 0) return "未填写";

  return [...grouped.values()]
    .map((item) => `${item.name}${item.sku ? ` ${item.sku}` : ""} × ${item.count}`)
    .join("，");
}

function serializeReportOrder(
  order: SaleOrderForReport,
  financial: SaleOrderAfterSaleFinancial,
  now = new Date(),
) {
  const cost = inventoryCost(order);
  const fees = feeTotal(order);
  const profit = profitTotal(order);
  const incomeBasis = actualReceivedForReport(order).isZero()
    ? decimal(order.expectedIncome).isZero()
      ? decimal(order.grossAmount)
      : decimal(order.expectedIncome)
    : actualReceivedForReport(order);
  const unsettledSince = order.confirmedAt ?? order.soldAt;
  const daysUnsettled = isUnsettled(order) ? daysBetween(unsettledSince, now) : 0;

  return {
    saleOrderId: order.id,
    saleNo: order.saleNo,
    platform: order.platform,
    status: order.status,
    platformOrderNo: order.platformOrderNo,
    platformTradeNo: order.platformTradeNo,
    buyerName: order.buyerName,
    soldAt: order.soldAt.toISOString(),
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    settledAt: order.settledAt?.toISOString() ?? null,
    grossAmount: money(order.grossAmount),
    expectedIncome: order.expectedIncome ? money(order.expectedIncome) : null,
    actualReceivedAmount: order.actualReceivedAmount ? money(order.actualReceivedAmount) : null,
    inventoryCostTotal: money(cost),
    feeTotal: money(fees),
    shippingCost: money(order.shippingCost),
    otherCost: money(order.otherCost),
    profit: money(profit),
    originalProfit: money(financial.originalProfit),
    totalSalesRefundedAmount: money(financial.totalSalesRefundedAmount),
    netReceivedAmount: money(financial.netReceivedAmount),
    restockedCostReversal: money(financial.restockedCostReversal),
    afterSaleNetProfit: money(financial.afterSaleNetProfit),
    afterSaleCaseCount: financial.afterSaleCaseCount,
    activeAfterSaleCaseCount: financial.activeAfterSaleCaseCount,
    afterSaleStatusSummary: financial.afterSaleStatusSummary,
    grossMarginRate: nullableRate(profit.mul(100), incomeBasis)?.toFixed(2) ?? null,
    soldItemCount: soldItemCount(order),
    isSettled: order.status === "SETTLED",
    isUnsettled: isUnsettled(order),
    isOverdueUnsettled: isUnsettled(order) && daysUnsettled > DEFAULT_OVERDUE_DAYS,
    itemsSummary: lineSummary(order),
  };
}

export class SalesReportService {
  async getSalesReportSummary(filters: SalesReportFilters) {
    const statuses: ReportStatus[] = filters.status
      ? [filters.status]
      : [...VALID_REPORT_STATUSES];

    const orders = await db.saleOrder.findMany({
      where: {
        ownerId: filters.ownerId,
        platform: filters.platform,
        status: { in: statuses },
      },
      include: {
        lines: true,
        feeLines: true,
      },
      orderBy: { soldAt: "desc" },
    });

    const filteredOrders = filterReportOrders(orders, filters);
    const afterSaleFinancials = await getSalesAfterSaleFinancials(filters.ownerId, filteredOrders.map((order) => order.id));

    const summaryBucket = createMoneyBucket();
    const platformBuckets = new Map<string, ReturnType<typeof createMoneyBucket>>();
    const productBuckets = new Map<string, {
      productName: string;
      sku: string | null;
      soldItemCount: number;
      costTotal: Prisma.Decimal;
      grossAmountTotal: Prisma.Decimal;
      expectedIncomeTotal: Prisma.Decimal;
      actualReceivedAmountTotal: Prisma.Decimal;
      profitTotal: Prisma.Decimal;
      refundedAmountTotal: Prisma.Decimal;
      restockedCostReversal: Prisma.Decimal;
      afterSaleNetProfit: Prisma.Decimal;
      refundedItemCount: number;
      restockedItemCount: number;
      problemReturnedItemCount: number;
    }>();

    let unsettledExpectedAmountTotal = zero;
    let unsettledOrderCount = 0;
    let overdueUnsettledOrderCount = 0;
    const now = new Date();

    const unsettledOrders = [];
    const trendGranularity = filters.granularity ?? "day";
    const trendBuckets = new Map<string, ReturnType<typeof createTrendBucket>>();
    const getTrendBucket = (date: Date) => {
      const key = periodKey(date, trendGranularity);
      const bucket = trendBuckets.get(key) ?? createTrendBucket(key);
      trendBuckets.set(key, bucket);
      return bucket;
    };

    for (const order of filteredOrders) {
      addOrderToBucket(summaryBucket, order);
      const orderFinancial = afterSaleFinancials.orders.get(order.id) ?? emptySaleOrderAfterSaleFinancial(order.id);
      addAfterSaleFinancialsToBucket(summaryBucket, order, orderFinancial);

      const platformBucket = platformBuckets.get(order.platform) ?? createMoneyBucket();
      addOrderToBucket(platformBucket, order);
      addAfterSaleFinancialsToBucket(platformBucket, order, orderFinancial);
      platformBuckets.set(order.platform, platformBucket);

      const trend = getTrendBucket(effectiveReportDate(order));
      trend.originalActualReceivedAmount = trend.originalActualReceivedAmount.plus(actualReceivedForReport(order));
      trend.netReceivedAmount = trend.netReceivedAmount.plus(actualReceivedForReport(order));
      trend.originalProfit = trend.originalProfit.plus(orderFinancial.originalProfit);
      trend.afterSaleNetProfit = trend.afterSaleNetProfit.plus(orderFinancial.originalProfit);

      if (isUnsettled(order)) {
        const unsettledSince = order.confirmedAt ?? order.soldAt;
        const daysUnsettled = daysBetween(unsettledSince, now);
        const isOverdue = daysUnsettled > DEFAULT_OVERDUE_DAYS;

        unsettledOrderCount += 1;
        if (isOverdue) overdueUnsettledOrderCount += 1;
        unsettledExpectedAmountTotal = unsettledExpectedAmountTotal.plus(decimal(order.expectedIncome));

        unsettledOrders.push({
          saleOrderId: order.id,
          saleNo: order.saleNo,
          platform: order.platform,
          platformOrderNo: order.platformOrderNo,
          soldAt: order.soldAt.toISOString(),
          confirmedAt: order.confirmedAt?.toISOString() ?? null,
          expectedIncome: order.expectedIncome ? money(order.expectedIncome) : null,
          grossAmount: money(order.grossAmount),
          daysUnsettled,
          isOverdue,
        });
      }

      for (const line of order.lines) {
        const key = `${line.productNameSnapshot}\u0000${line.skuSnapshot ?? ""}`;
        const productBucket = productBuckets.get(key) ?? {
          productName: line.productNameSnapshot,
          sku: line.skuSnapshot,
          soldItemCount: 0,
          costTotal: zero,
          grossAmountTotal: zero,
          expectedIncomeTotal: zero,
          actualReceivedAmountTotal: zero,
          profitTotal: zero,
          refundedAmountTotal: zero,
          restockedCostReversal: zero,
          afterSaleNetProfit: zero,
          refundedItemCount: 0,
          restockedItemCount: 0,
          problemReturnedItemCount: 0,
        };

        const lineGross = lineGrossAmount(order, line);
        productBucket.soldItemCount += 1;
        productBucket.costTotal = productBucket.costTotal.plus(decimal(line.costAmount).isZero() ? decimal(line.unitCostSnapshot) : decimal(line.costAmount));
        productBucket.grossAmountTotal = productBucket.grossAmountTotal.plus(lineGross);
        productBucket.expectedIncomeTotal = productBucket.expectedIncomeTotal.plus(
          allocateOrderAmountByLineGross(order, lineGross, order.expectedIncome),
        );
        // Actual receipt is an order-level fact. Do not make up a SKU allocation.
        productBucket.profitTotal = productBucket.profitTotal.plus(line.profitAmount);
        const lineFinancial = afterSaleFinancials.lines.get(line.id);
        if (lineFinancial) {
          productBucket.refundedAmountTotal = productBucket.refundedAmountTotal.plus(lineFinancial.refundedAmount);
          productBucket.restockedCostReversal = productBucket.restockedCostReversal.plus(lineFinancial.restockedCostReversal);
          productBucket.afterSaleNetProfit = productBucket.afterSaleNetProfit.plus(lineFinancial.afterSaleNetProfit);
          if (lineFinancial.refundedAmount.greaterThan(0)) productBucket.refundedItemCount += 1;
          if (lineFinancial.isRestocked) productBucket.restockedItemCount += 1;
          if (lineFinancial.isProblemReturned) productBucket.problemReturnedItemCount += 1;
        }
        productBuckets.set(key, productBucket);
      }
    }

    const filteredOrderIds = new Set(filteredOrders.map((order) => order.id));
    const dateFrom = parseDate(filters.dateFrom);
    const dateTo = parseDate(filters.dateTo);
    for (const refund of afterSaleFinancials.refundRecords) {
      if (!filteredOrderIds.has(refund.saleOrderId)) continue;
      if (dateFrom && refund.refundedAt < dateFrom) continue;
      if (dateTo && refund.refundedAt > dateTo) continue;
      const trend = getTrendBucket(refund.refundedAt);
      trend.refundedAmount = trend.refundedAmount.plus(refund.refundAmount);
      trend.netReceivedAmount = trend.netReceivedAmount.minus(refund.refundAmount);
      trend.afterSaleNetProfit = trend.afterSaleNetProfit.minus(refund.refundAmount);
    }
    for (const restock of afterSaleFinancials.restockEvents) {
      if (!filteredOrderIds.has(restock.saleOrderId) || !restock.completedAt) continue;
      if (dateFrom && restock.completedAt < dateFrom) continue;
      if (dateTo && restock.completedAt > dateTo) continue;
      getTrendBucket(restock.completedAt).afterSaleNetProfit = getTrendBucket(restock.completedAt).afterSaleNetProfit.plus(restock.amount);
    }

    const summary = {
      ...serializeSummaryBucket(summaryBucket),
      unsettledExpectedAmountTotal: money(unsettledExpectedAmountTotal),
      unsettledOrderCount,
      overdueUnsettledOrderCount,
    };

    return {
      summary,
      platformBreakdown: [...platformBuckets.entries()].map(([platform, bucket]) => ({
        platform,
        orderCount: bucket.orderCount,
        soldItemCount: bucket.soldItemCount,
        grossAmountTotal: money(bucket.grossAmountTotal),
        expectedIncomeTotal: money(bucket.expectedIncomeTotal),
        actualReceivedAmountTotal: money(bucket.actualReceivedAmountTotal),
        profitTotal: money(bucket.profitTotal),
        refundedAmountTotal: money(bucket.totalSalesRefundedAmount),
        restockedCostReversal: money(bucket.restockedCostReversal),
        afterSaleNetProfit: money(bucket.afterSaleNetProfit),
        grossMarginRate: serializeSummaryBucket(bucket).grossMarginRate,
      })),
      productBreakdown: [...productBuckets.values()].map((bucket) => ({
        productName: bucket.productName,
        sku: bucket.sku,
        soldItemCount: bucket.soldItemCount,
        costTotal: money(bucket.costTotal),
        grossAmountTotal: money(bucket.grossAmountTotal),
        expectedIncomeTotal: money(bucket.expectedIncomeTotal),
        // Retained for API compatibility only. SKU data never allocates order receipt.
        actualReceivedAmountTotal: null,
        profitTotal: money(bucket.profitTotal),
        originalProfitTotal: money(bucket.profitTotal),
        refundedAmountTotal: money(bucket.refundedAmountTotal),
        restockedCostReversal: money(bucket.restockedCostReversal),
        afterSaleNetProfit: money(bucket.afterSaleNetProfit),
        refundedItemCount: bucket.refundedItemCount,
        restockedItemCount: bucket.restockedItemCount,
        problemReturnedItemCount: bucket.problemReturnedItemCount,
        averageProfitPerItem: bucket.soldItemCount === 0
          ? null
          : bucket.profitTotal.div(bucket.soldItemCount).toDecimalPlaces(2).toNumber(),
      })),
      unsettledOrders,
      trend: [...trendBuckets.values()]
        .sort((left, right) => left.period.localeCompare(right.period))
        .map((bucket) => ({
          period: bucket.period,
          originalActualReceivedAmount: money(bucket.originalActualReceivedAmount),
          refundedAmount: money(bucket.refundedAmount),
          netReceivedAmount: money(bucket.netReceivedAmount),
          originalProfit: money(bucket.originalProfit),
          afterSaleNetProfit: money(bucket.afterSaleNetProfit),
        })),
      afterSaleStatusBreakdown: (() => {
        const counts = new Map<string, number>();
        for (const afterSaleCase of afterSaleFinancials.cases) {
          if (!filteredOrderIds.has(afterSaleCase.saleOrderId)) continue;
          counts.set(afterSaleCase.status, (counts.get(afterSaleCase.status) ?? 0) + 1);
        }
        return [...counts.entries()].map(([status, count]) => ({ status, count }));
      })(),
      returnInspectionBreakdown: (() => {
        const counts = new Map<string, number>();
        for (const inspection of afterSaleFinancials.returnInspections) {
          if (!filteredOrderIds.has(inspection.saleOrderId)) continue;
          counts.set(inspection.result, (counts.get(inspection.result) ?? 0) + 1);
        }
        return [...counts.entries()].map(([result, count]) => ({ result, count }));
      })(),
    };
  }

  async getSalesReportOrders(filters: SalesReportOrdersFilters) {
    const statuses: ReportStatus[] = filters.status
      ? [filters.status]
      : [...VALID_REPORT_STATUSES];
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

    const orders = await db.saleOrder.findMany({
      where: {
        ownerId: filters.ownerId,
        platform: filters.platform,
        status: { in: statuses },
      },
      include: {
        lines: true,
        feeLines: true,
      },
    });

    const filteredOrders = filterReportOrders(orders, filters)
      .sort((a, b) => effectiveReportDate(b).getTime() - effectiveReportDate(a).getTime());
    const afterSaleFinancials = await getSalesAfterSaleFinancials(filters.ownerId, filteredOrders.map((order) => order.id));
    const total = filteredOrders.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;

    return {
      items: filteredOrders.slice(offset, offset + pageSize).map((order) => serializeReportOrder(
        order,
        afterSaleFinancials.orders.get(order.id) ?? emptySaleOrderAfterSaleFinancial(order.id),
      )),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  async getSalesReportProducts(filters: SalesProductReportFilters) {
    const statuses: ReportStatus[] = filters.status
      ? [filters.status]
      : [...VALID_REPORT_STATUSES];
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const sortBy = filters.sortBy ?? "profitTotal";
    const sortOrder = filters.sortOrder ?? "desc";

    const orders = await db.saleOrder.findMany({
      where: { ownerId: filters.ownerId, platform: filters.platform, status: { in: statuses } },
      include: { lines: true, feeLines: true },
    });
    const reportOrders = filterReportOrders(orders, { ...filters, keyword: undefined });
    const afterSaleFinancials = await getSalesAfterSaleFinancials(filters.ownerId, reportOrders.map((order) => order.id));
    const groups = new Map<string, {
      productName: string;
      skuText: string | null;
      saleOrderIds: Set<string>;
      soldItemCount: number;
      confirmedItemCount: number;
      settledItemCount: number;
      inventoryCostTotal: Prisma.Decimal;
      lineSaleAmountTotal: Prisma.Decimal;
      hasReliableLineSaleAmount: boolean;
      profitTotal: Prisma.Decimal;
      refundedAmountTotal: Prisma.Decimal;
      restockedCostReversal: Prisma.Decimal;
      afterSaleNetProfit: Prisma.Decimal;
      refundedItemCount: number;
      restockedItemCount: number;
      problemReturnedItemCount: number;
      firstSoldAt: Date;
      lastSoldAt: Date;
    }>();

    for (const order of reportOrders) {
      const soldAt = effectiveReportDate(order);
      for (const line of order.lines) {
        const skuText = normalizeSku(line.skuSnapshot);
        const key = `${line.productNameSnapshot}\u0000${skuText ?? ""}`;
        const group = groups.get(key) ?? {
          productName: line.productNameSnapshot,
          skuText,
          saleOrderIds: new Set<string>(),
          soldItemCount: 0,
          confirmedItemCount: 0,
          settledItemCount: 0,
          inventoryCostTotal: zero,
          lineSaleAmountTotal: zero,
          hasReliableLineSaleAmount: true,
          profitTotal: zero,
          refundedAmountTotal: zero,
          restockedCostReversal: zero,
          afterSaleNetProfit: zero,
          refundedItemCount: 0,
          restockedItemCount: 0,
          problemReturnedItemCount: 0,
          firstSoldAt: soldAt,
          lastSoldAt: soldAt,
        };
        const saleAmount = decimal(line.saleAmount);
        group.saleOrderIds.add(order.id);
        group.soldItemCount += 1;
        group.confirmedItemCount += order.status === "CONFIRMED" ? 1 : 0;
        group.settledItemCount += order.status === "SETTLED" ? 1 : 0;
        group.inventoryCostTotal = group.inventoryCostTotal.plus(decimal(line.costAmount).isZero() ? decimal(line.unitCostSnapshot) : decimal(line.costAmount));
        group.lineSaleAmountTotal = group.lineSaleAmountTotal.plus(saleAmount);
        group.hasReliableLineSaleAmount = group.hasReliableLineSaleAmount && saleAmount.greaterThan(0);
        group.profitTotal = group.profitTotal.plus(decimal(line.profitAmount));
        const lineFinancial = afterSaleFinancials.lines.get(line.id);
        if (lineFinancial) {
          group.refundedAmountTotal = group.refundedAmountTotal.plus(lineFinancial.refundedAmount);
          group.restockedCostReversal = group.restockedCostReversal.plus(lineFinancial.restockedCostReversal);
          group.afterSaleNetProfit = group.afterSaleNetProfit.plus(lineFinancial.afterSaleNetProfit);
          if (lineFinancial.refundedAmount.greaterThan(0)) group.refundedItemCount += 1;
          if (lineFinancial.isRestocked) group.restockedItemCount += 1;
          if (lineFinancial.isProblemReturned) group.problemReturnedItemCount += 1;
        }
        if (soldAt < group.firstSoldAt) group.firstSoldAt = soldAt;
        if (soldAt > group.lastSoldAt) group.lastSoldAt = soldAt;
        groups.set(key, group);
      }
    }

    const keyword = filters.keyword?.trim().toLowerCase();
    const items = [...groups.values()]
      .map((group) => {
        const lineSaleAmountTotal = group.hasReliableLineSaleAmount ? group.lineSaleAmountTotal : null;
        const averageUnitCost = group.inventoryCostTotal.div(group.soldItemCount);
        const averageProfitPerItem = group.profitTotal.div(group.soldItemCount);
        return {
          productName: group.productName,
          skuText: group.skuText,
          orderCount: group.saleOrderIds.size,
          soldItemCount: group.soldItemCount,
          confirmedItemCount: group.confirmedItemCount,
          settledItemCount: group.settledItemCount,
          inventoryCostTotal: money(group.inventoryCostTotal),
          lineSaleAmountTotal: lineSaleAmountTotal ? money(lineSaleAmountTotal) : null,
          profitTotal: money(group.profitTotal),
          originalProfitTotal: money(group.profitTotal),
          refundedAmountTotal: money(group.refundedAmountTotal),
          restockedCostReversal: money(group.restockedCostReversal),
          afterSaleNetProfit: money(group.afterSaleNetProfit),
          refundedItemCount: group.refundedItemCount,
          restockedItemCount: group.restockedItemCount,
          problemReturnedItemCount: group.problemReturnedItemCount,
          averageUnitCost: money(averageUnitCost),
          averageSaleAmountPerItem: lineSaleAmountTotal ? money(lineSaleAmountTotal.div(group.soldItemCount)) : null,
          averageProfitPerItem: money(averageProfitPerItem),
          profitMarginRate: lineSaleAmountTotal && !lineSaleAmountTotal.isZero()
            ? nullableRate(group.profitTotal, lineSaleAmountTotal)
            : null,
          firstSoldAt: group.firstSoldAt.toISOString(),
          lastSoldAt: group.lastSoldAt.toISOString(),
        };
      })
      .filter((item) => !keyword || item.productName.toLowerCase().includes(keyword) || item.skuText?.toLowerCase().includes(keyword));

    items.sort((left, right) => {
      const leftValue = sortBy === "lastSoldAt" ? new Date(left.lastSoldAt).getTime() : new Prisma.Decimal(left[sortBy]);
      const rightValue = sortBy === "lastSoldAt" ? new Date(right.lastSoldAt).getTime() : new Prisma.Decimal(right[sortBy]);
      const result = typeof leftValue === "number"
        ? leftValue - (rightValue as number)
        : leftValue.comparedTo(rightValue as Prisma.Decimal);
      return sortOrder === "asc" ? result : -result;
    });

    const total = items.length;
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
    };
  }
}

export const salesReportService = new SalesReportService();
