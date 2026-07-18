import { Prisma } from "@/generated/prisma/client";
import { MarketQuoteType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { getPlatformReturnSummary } from "./platform-return-summary";
import { DAILY_REPORT_THRESHOLDS } from "./daily-business-report-thresholds";
import { resolveDailyReportPeriod, type DailyReportPeriod } from "./daily-business-report-period";
import type { DailyBusinessReportDto, DailyReportPriority, DailyReportRisk, DailyReportTodo } from "./daily-business-report-types";
import { getSalesAfterSaleFinancials } from "./sales-after-sales-financials";
import { selectCurrentQuote } from "@/server/market/market-rules";
import { purchaseLogisticsRiskService } from "@/server/services/purchase-logistics-risk-service";

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal | null | undefined) => (value ?? ZERO).toDecimalPlaces(2).toFixed(2);
function sum(values: (Prisma.Decimal | null | undefined)[]) {
  let total = ZERO;
  for (const value of values) total = total.plus(value ?? ZERO);
  return total;
}
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const within = (start: Date, end: Date) => ({ gte: start, lt: end });
const SAMPLE_LIMIT = 3;

function sample<T extends { id: string }>(items: T[], label: (item: T) => string, at: (item: T) => Date | null | undefined) {
  return items.slice(0, SAMPLE_LIMIT).map((item) => ({ id: item.id, label: label(item), at: iso(at(item)) }));
}

function todo(code: string, priority: DailyReportPriority, count: number, href: string, samples: DailyReportTodo["samples"]): DailyReportTodo {
  return { code, priority, count, href, samples };
}

function risk(code: string, severity: DailyReportPriority, items: { id: string; label: string; at: Date | null }[], href: string): DailyReportRisk {
  const ordered = [...items].sort((a, b) => (a.at?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.at?.getTime() ?? Number.MAX_SAFE_INTEGER));
  return { code, severity, count: items.length, href, oldestAt: iso(ordered[0]?.at), samples: ordered.slice(0, SAMPLE_LIMIT).map((item) => ({ id: item.id, label: item.label, at: iso(item.at) })) };
}

export async function getDailyBusinessReport(input: {
  ownerId: string;
  date?: string | null;
  timezone?: string | null;
  generatedAt: Date;
}): Promise<DailyBusinessReportDto> {
  const period = resolveDailyReportPeriod(input);
  const { ownerId } = input;
  const report = await Promise.all([
    getSalesSummary(ownerId, period),
    getPurchaseSummary(ownerId, period),
    getInventorySnapshot(ownerId),
    getDailyTodos(ownerId, period),
    getRiskSummary(ownerId, period.generatedAt),
    getMarketSummary(ownerId, period),
  ]);
  const [sales, purchases, inventory, todos, risks, market] = report;
  return {
    reportDate: period.reportDate,
    timezone: period.timezone,
    periodStart: period.periodStart.toISOString(),
    periodEnd: period.periodEnd.toISOString(),
    generatedAt: period.generatedAt.toISOString(),
    sales,
    purchases,
    inventory,
    todos,
    risks,
    market,
  };
}

async function getSalesSummary(ownerId: string, period: DailyReportPeriod) {
  const [confirmedOrders, settledOrders, refundRecords] = await Promise.all([
    db.saleOrder.findMany({
      where: { ownerId, status: { in: ["CONFIRMED", "SETTLED"] }, confirmedAt: within(period.periodStart, period.periodEnd) },
      include: { lines: { select: { id: true, profitAmount: true } } },
    }),
    db.saleOrder.findMany({ where: { ownerId, status: "SETTLED", settledAt: within(period.periodStart, period.periodEnd) }, select: { id: true, actualReceivedAmount: true } }),
    db.saleRefundRecord.findMany({ where: { ownerId, refundedAt: within(period.periodStart, period.periodEnd) }, select: { id: true, refundAmount: true } }),
  ]);
  const financials = await getSalesAfterSaleFinancials(ownerId, confirmedOrders.map((order) => order.id));
  const originalProfit = sum(confirmedOrders.flatMap((order) => order.lines.map((line) => line.profitAmount)));
  const afterSaleNetProfit = sum(confirmedOrders.map((order) => financials.orders.get(order.id)?.afterSaleNetProfit));
  const actualReceived = sum(settledOrders.map((order) => order.actualReceivedAmount));
  const actualRefund = sum(refundRecords.map((record) => record.refundAmount));
  return {
    confirmedOrderCount: confirmedOrders.length,
    confirmedItemCount: confirmedOrders.reduce((count, order) => count + order.lines.length, 0),
    grossSalesAmount: money(sum(confirmedOrders.map((order) => order.grossAmount))),
    expectedIncomeAmount: money(sum(confirmedOrders.map((order) => order.expectedIncome))),
    actualReceivedAmount: money(actualReceived),
    actualRefundAmount: money(actualRefund),
    netReceivedAmount: money(actualReceived.minus(actualRefund)),
    originalProfitAmount: money(originalProfit),
    afterSaleNetProfitAmount: money(afterSaleNetProfit),
  };
}

async function getPurchaseSummary(ownerId: string, period: DailyReportPeriod) {
  const [createdOrders, arrivedOrders, inspections, inventory, refunds] = await Promise.all([
    db.purchaseOrder.count({ where: { ownerId, createdAt: within(period.periodStart, period.periodEnd) } }),
    db.purchaseOrder.count({ where: { ownerId, deliveredAt: within(period.periodStart, period.periodEnd) } }),
    db.inspection.count({ where: { ownerId, completedAt: within(period.periodStart, period.periodEnd) } }),
    db.inventoryItem.count({ where: { ownerId, createdAt: within(period.periodStart, period.periodEnd) } }),
    db.purchaseRefundRecord.findMany({ where: { ownerId, refundedAt: within(period.periodStart, period.periodEnd) }, select: { refundAmount: true } }),
  ]);
  return {
    createdOrderCount: createdOrders,
    arrivedOrderCount: arrivedOrders,
    inspectedItemCount: inspections,
    createdInventoryItemCount: inventory,
    purchaseRefundAmount: money(sum(refunds.map((record) => record.refundAmount))),
  };
}

async function getInventorySnapshot(ownerId: string) {
  const [returnSummary, items] = await Promise.all([
    getPlatformReturnSummary(ownerId),
    db.inventoryItem.findMany({ where: { ownerId, ownershipStatus: "OWNED" }, select: { itemStatus: true, unitCost: true } }),
  ]);
  const platformProcessingCount = items.filter((item) => ["PLATFORM_SHIPPED", "PLATFORM_RECEIVED", "PLATFORM_IN_WAREHOUSE", "PLATFORM_LISTED"].includes(item.itemStatus)).length;
  return {
    stockedCount: returnSummary.currentAssets.normalLocal.count,
    stockedAssetCost: returnSummary.currentAssets.normalLocal.assetCost,
    platformProcessingCount,
    platformReturningCount: returnSummary.currentAssets.platformReturning.count,
    platformReturnedPendingCount: returnSummary.currentAssets.platformReturnedPending.count,
    pendingDecisionCount: returnSummary.currentAssets.platformPendingDecision.count,
    problemCount: items.filter((item) => item.itemStatus === "PROBLEM").length,
    problemAssetCost: money(sum(items.filter((item) => item.itemStatus === "PROBLEM").map((item) => item.unitCost))),
    totalUnsoldAssetCount: returnSummary.currentAssets.totalUnsold.count,
    totalUnsoldAssetCost: returnSummary.currentAssets.totalUnsold.assetCost,
  };
}

async function getDailyTodos(ownerId: string, period: DailyReportPeriod) {
  const [arrivalOrders, inspections, problems, draftSales, unsettledSales, purchaseCases, saleCases, buyerReturns, returningItems, returnedItems, purchaseLogisticsRisks] = await Promise.all([
    db.purchaseOrder.findMany({ where: { ownerId, status: { in: ["PAID", "WAITING_SHIPMENT", "IN_TRANSIT"] } }, select: { id: true, orderNo: true, paidAt: true } }),
    db.inspection.findMany({ where: { ownerId, status: { in: ["PENDING", "IN_PROGRESS"] } }, select: { id: true, createdAt: true, purchaseOrderItem: { select: { name: true, purchaseOrder: { select: { id: true, orderNo: true } } } } } }),
    db.inventoryItem.findMany({ where: { ownerId, ownershipStatus: "OWNED", itemStatus: "PROBLEM" }, select: { id: true, inventoryCode: true, name: true, stockedAt: true } }),
    db.saleOrder.findMany({ where: { ownerId, status: "DRAFT" }, select: { id: true, saleNo: true, createdAt: true } }),
    db.saleOrder.findMany({ where: { ownerId, status: "CONFIRMED", actualReceivedAmount: null }, select: { id: true, saleNo: true, confirmedAt: true } }),
    db.purchaseAfterSaleCase.findMany({ where: { ownerId, status: { notIn: ["COMPLETED", "CANCELLED", "SELLER_REJECTED", "REFUNDED"] } }, select: { id: true, caseNo: true, createdAt: true } }),
    db.saleAfterSaleCase.findMany({ where: { ownerId, status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED", "REFUNDED"] } }, select: { id: true, caseNo: true, createdAt: true } }),
    db.saleAfterSaleCase.findMany({ where: { ownerId, status: "RETURN_RECEIVED" }, select: { id: true, caseNo: true, returnReceivedAt: true } }),
    db.inventoryItem.findMany({ where: { ownerId, ownershipStatus: "OWNED", itemStatus: "RETURNING" }, select: { id: true, inventoryCode: true, name: true, updatedAt: true } }),
    db.inventoryItem.findMany({ where: { ownerId, ownershipStatus: "OWNED", itemStatus: "RETURNED" }, select: { id: true, inventoryCode: true, name: true, updatedAt: true, shipmentLines: { where: { lineStatus: "RETURNED" }, orderBy: { createdAt: "desc" }, take: 1, select: { returnInspection: { select: { result: true } } } } } }),
    purchaseLogisticsRiskService.list(ownerId, period.generatedAt),
  ]);
  const returnedAwaiting = returnedItems.filter((item) => !item.shipmentLines[0]?.returnInspection);
  const pendingDecision = returnedItems.filter((item) => item.shipmentLines[0]?.returnInspection?.result === "PENDING_DECISION");
  const missingTracking = purchaseLogisticsRisks.filter((item) => item.type === "MISSING_TRACKING_NUMBER").map((item) => ({ ...item, id: item.purchaseOrderId }));
  const trackingNotReceived = purchaseLogisticsRisks.filter((item) => item.type === "TRACKING_NOT_RECEIVED_OVERDUE").map((item) => ({ ...item, id: item.purchaseOrderId }));
  const items = [
    todo("purchaseMissingTracking", "P2", missingTracking.length, "/purchases?todo=missingTracking", sample(missingTracking, (item) => item.orderNumber, (item) => item.referenceAt)),
    todo("purchaseTrackingNotReceivedOverdue", "P1", trackingNotReceived.length, "/purchases?todo=trackingNotReceivedOverdue", sample(trackingNotReceived, (item) => `${item.orderNumber}${item.maskedTrackingNumber ? ` ${item.maskedTrackingNumber}` : ""}`, (item) => item.referenceAt)),
    todo("purchaseAwaitingArrival", "P2", arrivalOrders.length, "/purchases?status=IN_TRANSIT", sample(arrivalOrders, (item) => item.orderNo, (item) => item.paidAt)),
    todo("purchaseAwaitingInspection", "P2", inspections.length, "/inspections", sample(inspections, (item) => `${item.purchaseOrderItem.purchaseOrder.orderNo} ${item.purchaseOrderItem.name}`, (item) => item.createdAt)),
    todo("problemItems", "P2", problems.length, "/inventory?status=PROBLEM", sample(problems, (item) => `${item.inventoryCode} ${item.name}`, (item) => item.stockedAt)),
    todo("salesAwaitingConfirmation", "P2", draftSales.length, "/sales", sample(draftSales, (item) => item.saleNo, (item) => item.createdAt)),
    todo("salesAwaitingSettlement", "P1", unsettledSales.length, "/sales/settlements?settlementStatus=UNSETTLED", sample(unsettledSales, (item) => item.saleNo, (item) => item.confirmedAt)),
    todo("purchaseAfterSalesPending", "P1", purchaseCases.length, "/purchase-after-sales", sample(purchaseCases, (item) => item.caseNo, (item) => item.createdAt)),
    todo("saleAfterSalesPending", "P1", saleCases.length, "/sales-after-sales", sample(saleCases, (item) => item.caseNo, (item) => item.createdAt)),
    todo("buyerReturnsAwaitingInspection", "P1", buyerReturns.length, "/sales-after-sales", sample(buyerReturns, (item) => item.caseNo, (item) => item.returnReceivedAt)),
    todo("platformReturnsInTransit", "P2", returningItems.length, "/platform-returns?category=RETURNING", sample(returningItems, (item) => `${item.inventoryCode} ${item.name}`, (item) => item.updatedAt)),
    todo("platformReturnsAwaitingInspection", "P1", returnedAwaiting.length, "/platform-returns?category=PENDING_INSPECTION", sample(returnedAwaiting, (item) => `${item.inventoryCode} ${item.name}`, (item) => item.updatedAt)),
    todo("platformReturnsPendingDecision", "P1", pendingDecision.length, "/platform-returns?category=PENDING_DECISION", sample(pendingDecision, (item) => `${item.inventoryCode} ${item.name}`, (item) => item.updatedAt)),
  ].filter((item) => item.count > 0);
  const priorityCounts: Record<DailyReportPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const item of items) priorityCounts[item.priority] += item.count;
  return { items: items.sort((a, b) => a.priority.localeCompare(b.priority) || b.count - a.count || a.code.localeCompare(b.code)), totalCount: items.reduce((count, item) => count + item.count, 0), priorityCounts };
}

async function getRiskSummary(ownerId: string, generatedAt: Date) {
  const settlementCutoff = new Date(generatedAt.getTime() - DAILY_REPORT_THRESHOLDS.salesSettlementOverdueDays * 86_400_000);
  const inspectionCutoff = new Date(generatedAt.getTime() - DAILY_REPORT_THRESHOLDS.purchaseInspectionOverdueDays * 86_400_000);
  const returnCutoff = new Date(generatedAt.getTime() - DAILY_REPORT_THRESHOLDS.returnInspectionOverdueHours * 3_600_000);
  const [unsettled, purchaseInspections, buyerReturns, platformReturns, problems] = await Promise.all([
    db.saleOrder.findMany({ where: { ownerId, status: "CONFIRMED", actualReceivedAmount: null, confirmedAt: { lt: settlementCutoff } }, select: { id: true, saleNo: true, confirmedAt: true } }),
    db.inspection.findMany({ where: { ownerId, status: { in: ["PENDING", "IN_PROGRESS"] }, createdAt: { lt: inspectionCutoff } }, select: { id: true, createdAt: true, purchaseOrderItem: { select: { name: true } } } }),
    db.saleAfterSaleCase.findMany({ where: { ownerId, status: "RETURN_RECEIVED", returnReceivedAt: { lt: returnCutoff } }, select: { id: true, caseNo: true, returnReceivedAt: true } }),
    db.inventoryItem.findMany({ where: { ownerId, ownershipStatus: "OWNED", itemStatus: "RETURNED", updatedAt: { lt: returnCutoff } }, select: { id: true, inventoryCode: true, updatedAt: true } }),
    db.inventoryItem.findMany({ where: { ownerId, ownershipStatus: "OWNED", itemStatus: "PROBLEM", stockedAt: { lt: new Date(generatedAt.getTime() - DAILY_REPORT_THRESHOLDS.problemItemBacklogDays * 86_400_000) } }, select: { id: true, inventoryCode: true, stockedAt: true } }),
  ]);
  const items = [
    risk("salesSettlementOverdue", "P1", unsettled.map((item) => ({ id: item.id, label: item.saleNo, at: item.confirmedAt })), "/sales/settlements?settlementStatus=UNSETTLED"),
    risk("purchaseInspectionOverdue", "P2", purchaseInspections.map((item) => ({ id: item.id, label: item.purchaseOrderItem.name, at: item.createdAt })), "/inspections"),
    risk("buyerReturnInspectionOverdue", "P1", buyerReturns.map((item) => ({ id: item.id, label: item.caseNo, at: item.returnReceivedAt })), "/sales-after-sales"),
    risk("platformReturnInspectionOverdue", "P1", platformReturns.map((item) => ({ id: item.id, label: item.inventoryCode, at: item.updatedAt })), "/platform-returns?category=PENDING_INSPECTION"),
    risk("problemItemBacklog", "P2", problems.map((item) => ({ id: item.id, label: item.inventoryCode, at: item.stockedAt })), "/inventory?status=PROBLEM"),
  ].filter((item) => item.count > 0);
  const severityCounts: Record<DailyReportPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const item of items) severityCounts[item.severity] += item.count;
  return { items: items.sort((a, b) => a.severity.localeCompare(b.severity) || b.count - a.count || a.code.localeCompare(b.code)), totalCount: items.reduce((count, item) => count + item.count, 0), severityCounts };
}

async function getMarketSummary(ownerId: string, period: DailyReportPeriod) {
  const [items, quotes] = await Promise.all([
    db.marketItem.findMany({ where: { ownerId }, select: { id: true, isActive: true } }),
    db.marketQuote.findMany({ where: { ownerId }, select: { id: true, marketItemId: true, quoteType: true, recordedAt: true, expiresAt: true, confirmedAt: true, invalidatedAt: true, createdAt: true } }),
  ]);
  const active = items.filter((item) => item.isActive);
  const effectiveExpected = new Set(active.filter((item) => Boolean(selectCurrentQuote(quotes.filter((quote) => quote.marketItemId === item.id && quote.quoteType === MarketQuoteType.EXPECTED_INCOME), period.generatedAt))).map((item) => item.id));
  const expiringAt = new Date(period.generatedAt.getTime() + DAILY_REPORT_THRESHOLDS.marketQuoteExpiringHours * 3_600_000);
  return {
    activeMarketItemCount: active.length,
    withCurrentExpectedIncomeCount: effectiveExpected.size,
    withoutCurrentExpectedIncomeCount: active.length - effectiveExpected.size,
    quotesCreatedInPeriodCount: quotes.filter((quote) => quote.createdAt >= period.periodStart && quote.createdAt < period.periodEnd).length,
    quotesConfirmedInPeriodCount: quotes.filter((quote) => quote.confirmedAt && quote.confirmedAt >= period.periodStart && quote.confirmedAt < period.periodEnd).length,
    expiringQuoteCount: quotes.filter((quote) => quote.expiresAt && quote.expiresAt > period.generatedAt && quote.expiresAt <= expiringAt && !quote.invalidatedAt).length,
    expiredQuoteCount: quotes.filter((quote) => quote.expiresAt && quote.expiresAt <= period.generatedAt && !quote.invalidatedAt).length,
  };
}
