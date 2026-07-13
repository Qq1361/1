import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

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

export class SalesReportService {
  async getSalesReportSummary(filters: SalesReportFilters) {
    const dateFrom = parseDate(filters.dateFrom);
    const dateTo = parseDate(filters.dateTo);
    const settlementStatus = filters.settlementStatus ?? "ALL";

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

    const filteredOrders = orders.filter((order) => {
      if (settlementStatus === "SETTLED" && order.status !== "SETTLED") return false;
      if (settlementStatus === "UNSETTLED" && !isUnsettled(order)) return false;

      const reportDate = effectiveReportDate(order);
      if (dateFrom && reportDate < dateFrom) return false;
      if (dateTo && reportDate > dateTo) return false;

      // TODO(M3-B): keyword, purchaseOrderNo, sellerNickname, storageLocation and saleMode
      // need joins against purchase/inventory data. Keep this first cut read-only and
      // limited to core report filters.
      void filters.keyword;
      void filters.purchaseOrderNo;
      void filters.sellerNickname;
      void filters.storageLocation;
      void filters.saleMode;

      return true;
    });

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
    }>();

    let unsettledExpectedAmountTotal = zero;
    let unsettledOrderCount = 0;
    let overdueUnsettledOrderCount = 0;
    const now = new Date();

    const unsettledOrders = [];

    for (const order of filteredOrders) {
      addOrderToBucket(summaryBucket, order);

      const platformBucket = platformBuckets.get(order.platform) ?? createMoneyBucket();
      addOrderToBucket(platformBucket, order);
      platformBuckets.set(order.platform, platformBucket);

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
        };

        const lineGross = lineGrossAmount(order, line);
        productBucket.soldItemCount += 1;
        productBucket.costTotal = productBucket.costTotal.plus(decimal(line.costAmount).isZero() ? decimal(line.unitCostSnapshot) : decimal(line.costAmount));
        productBucket.grossAmountTotal = productBucket.grossAmountTotal.plus(lineGross);
        productBucket.expectedIncomeTotal = productBucket.expectedIncomeTotal.plus(
          allocateOrderAmountByLineGross(order, lineGross, order.expectedIncome),
        );
        productBucket.actualReceivedAmountTotal = productBucket.actualReceivedAmountTotal.plus(
          allocateOrderAmountByLineGross(order, lineGross, actualReceivedForReport(order)),
        );
        productBucket.profitTotal = productBucket.profitTotal.plus(line.profitAmount);
        productBuckets.set(key, productBucket);
      }
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
        grossMarginRate: serializeSummaryBucket(bucket).grossMarginRate,
      })),
      productBreakdown: [...productBuckets.values()].map((bucket) => ({
        productName: bucket.productName,
        sku: bucket.sku,
        soldItemCount: bucket.soldItemCount,
        costTotal: money(bucket.costTotal),
        grossAmountTotal: money(bucket.grossAmountTotal),
        expectedIncomeTotal: money(bucket.expectedIncomeTotal),
        actualReceivedAmountTotal: money(bucket.actualReceivedAmountTotal),
        profitTotal: money(bucket.profitTotal),
        averageProfitPerItem: bucket.soldItemCount === 0
          ? null
          : bucket.profitTotal.div(bucket.soldItemCount).toDecimalPlaces(2).toNumber(),
      })),
      unsettledOrders,
    };
  }
}

export const salesReportService = new SalesReportService();
