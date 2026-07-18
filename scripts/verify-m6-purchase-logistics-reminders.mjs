import "dotenv/config";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { getDailyBusinessReport } from "../src/server/reports/daily-business-report.ts";
import { purchaseLogisticsRiskService, maskTrackingNumber } from "../src/server/services/purchase-logistics-risk-service.ts";
import { logisticsService } from "../src/server/services/logistics-service.ts";
import { purchaseOrderService } from "../src/server/services/purchase-order-service.ts";

const runId = `M6B1-${Date.now()}-${process.pid}`;
const ownerId = `${runId}-OWNER`;
const otherOwnerId = `${runId}-OTHER`;
const now = new Date("2026-07-18T01:00:00.000Z");
let checks = 0;
const createdOrderIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

async function createOrder(ownerId, suffix, values = {}) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-${suffix}`,
      paidAt: values.paidAt ?? new Date(now.getTime() - 49 * 3_600_000),
      totalAmount: new Prisma.Decimal("100.00"),
      shippingAmount: new Prisma.Decimal("0.00"),
      status: values.status ?? "PAID",
      carrierCode: values.carrierCode ?? null,
      trackingNo: values.trackingNo ?? null,
      trackingNumberRecordedAt: values.trackingNumberRecordedAt ?? null,
      manuallyReceivedAt: values.manuallyReceivedAt ?? null,
      logisticsStatus: values.logisticsStatus ?? "NOT_SHIPPED",
      items: { create: { name: `${runId} 商品 ${suffix}`, quantity: 1 } },
    },
  });
  createdOrderIds.push(order.id);
  return order;
}

async function main() {
  await db.user.createMany({ data: [{ id: ownerId, name: `${runId} Owner` }, { id: otherOwnerId, name: `${runId} Other` }] });
  const before = await Promise.all([
    db.logisticsEvent.count({ where: { ownerId } }),
    db.logisticsShipment.count({ where: { ownerId } }),
    db.logisticsTrackingEvent.count({ where: { ownerId } }),
    db.inspection.count({ where: { ownerId } }),
    db.inventoryItem.count({ where: { ownerId } }),
  ]);
  const justBefore = new Date(now.getTime() - 48 * 3_600_000 + 1_000);
  const exactlyMissing = new Date(now.getTime() - 48 * 3_600_000);
  const at119 = new Date(now.getTime() - 120 * 3_600_000 + 1_000);
  const at120 = new Date(now.getTime() - 120 * 3_600_000);
  await createOrder(ownerId, "MISSING-BEFORE", { paidAt: justBefore });
  const missing = await createOrder(ownerId, "MISSING-EXACT", { paidAt: exactlyMissing });
  await createOrder(ownerId, "PENDING-WITHOUT-TRACKING", { status: "PENDING_INSPECTION", paidAt: exactlyMissing });
  await createOrder(ownerId, "TRACKING-119", { carrierCode: "SF", trackingNo: "SF1234567890", trackingNumberRecordedAt: at119, logisticsStatus: "IN_TRANSIT" });
  const exact = await createOrder(ownerId, "TRACKING-120", { carrierCode: "SF", trackingNo: "SF1234567890", trackingNumberRecordedAt: at120, logisticsStatus: "IN_TRANSIT" });
  const externalDelivered = await createOrder(ownerId, "EXTERNAL-DELIVERED", { status: "PENDING_INSPECTION", carrierCode: "SF", trackingNo: "SF0000123456", trackingNumberRecordedAt: at120, logisticsStatus: "DELIVERED" });
  const manualReceived = await createOrder(ownerId, "MANUAL-RECEIVED", { status: "PENDING_INSPECTION", carrierCode: "SF", trackingNo: "SF9999123456", trackingNumberRecordedAt: at120, manuallyReceivedAt: now, logisticsStatus: "DELIVERED" });
  await createOrder(ownerId, "CANCELLED", { status: "CANCELLED", carrierCode: "SF", trackingNo: "SF8888123456", trackingNumberRecordedAt: at120 });
  const other = await createOrder(otherOwnerId, "OTHER", { carrierCode: "SF", trackingNo: "SF7777123456", trackingNumberRecordedAt: at120 });
  const timestamped = await createOrder(ownerId, "TIMESTAMP", { paidAt: now });
  const firstSave = await logisticsService.saveTracking(ownerId, timestamped.id, { carrierCode: "SF", trackingNo: "SF1111222233" });
  assert(firstSave.order.trackingNumberRecordedAt !== null, "first tracking number save records the server timestamp");
  const firstRecordedAt = firstSave.order.trackingNumberRecordedAt?.toISOString();
  const secondSave = await logisticsService.saveTracking(ownerId, timestamped.id, { carrierCode: "SF", trackingNo: "SF3333444455" });
  assert(secondSave.order.trackingNumberRecordedAt?.toISOString() === firstRecordedAt, "changing a tracking number does not reset the first-recorded timestamp");
  const carrierUpdate = await logisticsService.saveTracking(ownerId, timestamped.id, { carrierCode: "YTO", trackingNo: "SF3333444455" });
  assert(carrierUpdate.order.trackingNumberRecordedAt?.toISOString() === firstRecordedAt, "changing a carrier does not reset the first-recorded timestamp");
  const correctedReceivedTracking = await logisticsService.saveTracking(ownerId, manualReceived.id, { carrierCode: "SF", trackingNo: "SF9999000000" });
  assert(correctedReceivedTracking.order.manuallyReceivedAt?.toISOString() === now.toISOString(), "correcting a tracking number does not clear manual receipt");

  const risks = await purchaseLogisticsRiskService.list(ownerId, now);
  const ids = new Set(risks.map((risk) => risk.purchaseOrderId));
  assert(ids.has(missing.id), "48 hour missing-tracking boundary is included");
  assert(!risks.some((risk) => risk.orderNumber.endsWith("MISSING-BEFORE")), "missing-tracking rule excludes the pre-boundary order");
  assert(!risks.some((risk) => risk.orderNumber.endsWith("PENDING-WITHOUT-TRACKING")), "missing-tracking rule preserves the waiting-shipment status scope");
  assert(!risks.some((risk) => risk.orderNumber.endsWith("TRACKING-119")), "120 hour rule excludes the pre-boundary order");
  assert(ids.has(exact.id), "120 hour tracking rule includes the exact boundary order");
  assert(ids.has(externalDelivered.id), "external DELIVERED does not stop a manual-receipt reminder");
  assert(!risks.some((risk) => risk.orderNumber.endsWith("MANUAL-RECEIVED")), "manual confirmation stops the reminder");
  assert(!risks.some((risk) => risk.orderNumber.endsWith("CANCELLED")), "cancelled orders are excluded");
  assert(!risks.some((risk) => risk.purchaseOrderId === other.id), "owner isolation excludes other owners");
  assert(risks.every((risk) => risk.type === "MISSING_TRACKING_NUMBER" || risk.type === "TRACKING_NOT_RECEIVED_OVERDUE"), "risk types are constrained");
  assert(!risks.some((risk) => risk.type === "MISSING_TRACKING_NUMBER" && risk.maskedTrackingNumber), "missing-tracking risks do not invent a tracking number");
  assert(risks.filter((risk) => risk.purchaseOrderId === exact.id).length === 1, "an order has at most one logistics risk");
  assert(risks.find((risk) => risk.purchaseOrderId === exact.id)?.maskedTrackingNumber === "SF12****7890", "long tracking numbers are masked");
  assert(maskTrackingNumber("1234") === "****" && maskTrackingNumber(null) === null, "short and empty tracking numbers are masked safely");
  assert(risks.find((risk) => risk.purchaseOrderId === exact.id)?.elapsedDays === 5, "elapsed days are stable whole-day values");

  const missingList = await purchaseOrderService.listOrders(ownerId, {
    todo: "missingTracking",
    page: 1,
    pageSize: 100,
  });
  const overdueList = await purchaseOrderService.listOrders(ownerId, {
    todo: "trackingNotReceivedOverdue",
    page: 1,
    pageSize: 100,
  });
  const listRisks = await purchaseLogisticsRiskService.list(ownerId);
  const missingRiskIds = listRisks.filter((risk) => risk.type === "MISSING_TRACKING_NUMBER").map((risk) => risk.purchaseOrderId).sort();
  const overdueRiskIds = listRisks.filter((risk) => risk.type === "TRACKING_NOT_RECEIVED_OVERDUE").map((risk) => risk.purchaseOrderId).sort();
  assert(missingList.data.map((order) => order.id).sort().join(",") === missingRiskIds.join(","), "missing-tracking order filter reuses the unified risk result");
  assert(overdueList.data.map((order) => order.id).sort().join(",") === overdueRiskIds.join(","), "overdue-tracking order filter reuses the unified risk result");

  const report = await getDailyBusinessReport({ ownerId, generatedAt: now, timezone: "Asia/Shanghai" });
  const reportMissing = report.todos.items.find((item) => item.code === "purchaseMissingTracking");
  const reportOverdue = report.todos.items.find((item) => item.code === "purchaseTrackingNotReceivedOverdue");
  assert(reportMissing?.count === 1, "daily report reuses missing-tracking risk count");
  assert(reportOverdue?.count === 2, "daily report reuses overdue tracking risk count");
  assert(!reportOverdue?.samples.some((sample) => sample.label.includes("SF1234567890")), "daily report does not expose a full tracking number");

  const after = await Promise.all([
    db.logisticsEvent.count({ where: { ownerId } }),
    db.logisticsShipment.count({ where: { ownerId } }),
    db.logisticsTrackingEvent.count({ where: { ownerId } }),
    db.inspection.count({ where: { ownerId } }),
    db.inventoryItem.count({ where: { ownerId } }),
  ]);
  assert(JSON.stringify(before) === JSON.stringify(after), "risk aggregation creates no logistics, inspection, or inventory records");
  assert((await db.inventoryItem.count({ where: { ownerId, itemStatus: "SOLD" } })) === 0, "risk aggregation has no SOLD write path");
  console.log(`verify:m6-purchase-logistics-reminders passed: ${checks} checks`);
}

try {
  await main();
} finally {
  if (createdOrderIds.length) await db.purchaseOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } });
}
