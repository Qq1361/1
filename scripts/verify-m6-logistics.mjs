import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { ServiceError } from "../src/server/errors.ts";
import { LogisticsProviderRegistry } from "../src/server/logistics/logistics-provider-registry.ts";
import { GenericLogisticsService } from "../src/server/logistics/logistics-service.ts";
import { LogisticsProviderError } from "../src/server/logistics/logistics-types.ts";

const runId = `M6A1-${Date.now()}-${process.pid}`;
const ownerId = `${runId}-OWNER-A`;
const otherOwnerId = `${runId}-OWNER-B`;
const fixedNow = new Date("2026-07-18T08:00:00.000Z");
const created = {
  shipmentIds: [],
  ownerIds: [ownerId, otherOwnerId],
  purchaseOrderId: null,
  inspectionId: null,
  inventoryId: null,
  batchId: null,
  lineId: null,
  purchaseAfterSaleCaseId: null,
  saleOrderId: null,
  saleAfterSaleCaseId: null,
  legacyEventId: null,
};
let checks = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

async function rejectsCode(action, code, message) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ServiceError && error.code === code, `${message}: expected ${code}`);
    return;
  }
  throw new Error(`${message}: expected rejection`);
}

function decimal(value) {
  return new Prisma.Decimal(value);
}

function stable(value) {
  return JSON.stringify(value, (_key, entry) => entry instanceof Date ? entry.toISOString() : entry);
}

async function businessSnapshot() {
  return {
    purchaseOrder: await db.purchaseOrder.findUnique({ where: { id: created.purchaseOrderId }, select: { status: true, logisticsStatus: true, deliveredAt: true, updatedAt: true } }),
    inventory: await db.inventoryItem.findUnique({ where: { id: created.inventoryId }, select: { itemStatus: true, ownershipStatus: true, updatedAt: true } }),
    batch: await db.platformShipmentBatch.findUnique({ where: { id: created.batchId }, select: { status: true, receivedAt: true, updatedAt: true } }),
    line: await db.platformShipmentLine.findUnique({ where: { id: created.lineId }, select: { lineStatus: true, returnedAt: true, updatedAt: true } }),
    purchaseAfterSale: await db.purchaseAfterSaleCase.findUnique({ where: { id: created.purchaseAfterSaleCaseId }, select: { status: true, sellerReceivedAt: true, updatedAt: true } }),
    saleOrder: await db.saleOrder.findUnique({ where: { id: created.saleOrderId }, select: { status: true, settledAt: true, updatedAt: true } }),
    saleAfterSale: await db.saleAfterSaleCase.findUnique({ where: { id: created.saleAfterSaleCaseId }, select: { status: true, returnReceivedAt: true, updatedAt: true } }),
    legacyEvent: await db.logisticsEvent.findUnique({ where: { id: created.legacyEventId } }),
  };
}

async function createFixture() {
  await db.user.createMany({
    data: [
      { id: ownerId, name: `${runId} Owner A` },
      { id: otherOwnerId, name: `${runId} Owner B` },
    ],
  });

  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-PO`,
      paidAt: fixedNow,
      totalAmount: decimal("100.00"),
      shippingAmount: decimal("0.00"),
      status: "PAID",
      items: { create: { name: `${runId} Product`, skuText: "M6-A1", quantity: 1 } },
    },
    include: { items: true },
  });
  created.purchaseOrderId = purchaseOrder.id;

  const inspection = await db.inspection.create({
    data: {
      ownerId,
      purchaseOrderItemId: purchaseOrder.items[0].id,
      sequence: 1,
      status: "PASSED",
      result: "PASS",
      currentStep: 6,
      completedAt: fixedNow,
    },
  });
  created.inspectionId = inspection.id;

  const inventory = await db.inventoryItem.create({
    data: {
      ownerId,
      purchaseOrderItemId: purchaseOrder.items[0].id,
      inspectionId: inspection.id,
      inventoryCode: `${runId}-INV`,
      name: `${runId} Product`,
      skuText: "M6-A1",
      unitCost: decimal("100.00"),
      itemStatus: "STOCKED",
      stockedAt: fixedNow,
    },
  });
  created.inventoryId = inventory.id;

  const batch = await db.platformShipmentBatch.create({
    data: {
      ownerId,
      batchNo: `${runId}-BATCH`,
      platform: "DEWU",
      defaultPurpose: "DEWU_LIGHTNING_INBOUND",
      status: "DRAFT",
    },
  });
  created.batchId = batch.id;

  const line = await db.platformShipmentLine.create({
    data: {
      ownerId,
      batchId: batch.id,
      inventoryItemId: inventory.id,
      lineStatus: "DRAFT",
      inventoryCodeSnapshot: inventory.inventoryCode,
      productNameSnapshot: inventory.name,
      skuSnapshot: inventory.skuText,
      unitCostSnapshot: inventory.unitCost,
      sourcePurchaseOrderId: purchaseOrder.id,
    },
  });
  created.lineId = line.id;

  const purchaseAfterSaleCase = await db.purchaseAfterSaleCase.create({
    data: {
      ownerId,
      caseNo: `${runId}-PURCHASE-AS`,
      purchaseOrderId: purchaseOrder.id,
      type: "RETURN_AND_REFUND",
      status: "DRAFT",
    },
  });
  created.purchaseAfterSaleCaseId = purchaseAfterSaleCase.id;

  const saleOrder = await db.saleOrder.create({
    data: {
      ownerId,
      saleNo: `${runId}-SALE`,
      platform: "XIANYU",
      soldAt: fixedNow,
      grossAmount: decimal("120.00"),
      status: "DRAFT",
    },
  });
  created.saleOrderId = saleOrder.id;

  const saleAfterSaleCase = await db.saleAfterSaleCase.create({
    data: {
      ownerId,
      caseNo: `${runId}-SALE-AS`,
      saleOrderId: saleOrder.id,
      type: "RETURN_AND_REFUND",
      status: "DRAFT",
    },
  });
  created.saleAfterSaleCaseId = saleAfterSaleCase.id;

  const legacyEvent = await db.logisticsEvent.create({
    data: {
      ownerId,
      purchaseOrderId: purchaseOrder.id,
      carrierCode: "MOCK",
      trackingNo: `${runId}-LEGACY`,
      eventTime: fixedNow,
      eventText: "Existing M2-A event",
      status: "IN_TRANSIT",
    },
  });
  created.legacyEventId = legacyEvent.id;
}

function stageEvent(trackingNumber, index, status, description) {
  return {
    providerEventId: `${trackingNumber}-${index}-${status}`,
    eventTime: new Date(Date.UTC(2026, 0, 1, index, 0, 0)),
    status,
    description,
    rawStatusCode: status,
  };
}

class StagedMockProvider {
  code = "MOCK";
  calls = 0;
  supportsCarrier() { return true; }
  async queryTracking(input) {
    this.calls += 1;
    const all = [
      stageEvent(input.trackingNumber, 1, "PENDING_PICKUP", "Pending pickup"),
      stageEvent(input.trackingNumber, 2, "PICKED_UP", "Picked up"),
      stageEvent(input.trackingNumber, 3, "IN_TRANSIT", "In transit"),
      stageEvent(input.trackingNumber, 4, "OUT_FOR_DELIVERY", "Out for delivery"),
      stageEvent(input.trackingNumber, 5, "DELIVERED", "Delivered"),
    ];
    const events = this.calls === 1 ? all.slice(0, 3) : all;
    return {
      provider: "MOCK",
      carrierCode: input.carrierCode,
      trackingNumber: input.trackingNumber,
      currentStatus: events.at(-1).status,
      rawStatusCode: events.at(-1).status,
      events,
      queriedAt: new Date(`2026-01-01T${this.calls === 1 ? "06" : "12"}:00:00.000Z`),
    };
  }
}

class FailingMockProvider {
  code = "MOCK";
  supportsCarrier() { return true; }
  async queryTracking() {
    throw new LogisticsProviderError("MOCK_TEMPORARY_FAILURE", "safe mock failure", true);
  }
}

async function cleanup() {
  const failures = [];
  async function clean(label, action) {
    try { await action(); } catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (created.shipmentIds.length) await clean("logistics shipments", () => db.logisticsShipment.deleteMany({ where: { id: { in: created.shipmentIds } } }));
  if (created.saleAfterSaleCaseId) await clean("sale after-sale case", () => db.saleAfterSaleCase.delete({ where: { id: created.saleAfterSaleCaseId } }));
  if (created.purchaseAfterSaleCaseId) await clean("purchase after-sale case", () => db.purchaseAfterSaleCase.delete({ where: { id: created.purchaseAfterSaleCaseId } }));
  if (created.saleOrderId) await clean("sale order", () => db.saleOrder.delete({ where: { id: created.saleOrderId } }));
  if (created.lineId) await clean("shipment line", () => db.platformShipmentLine.delete({ where: { id: created.lineId } }));
  if (created.batchId) await clean("shipment batch", () => db.platformShipmentBatch.delete({ where: { id: created.batchId } }));
  if (created.inventoryId) await clean("inventory", () => db.inventoryItem.delete({ where: { id: created.inventoryId } }));
  if (created.inspectionId) await clean("inspection", () => db.inspection.delete({ where: { id: created.inspectionId } }));
  if (created.purchaseOrderId) await clean("purchase order", () => db.purchaseOrder.delete({ where: { id: created.purchaseOrderId } }));
  await clean("owners", () => db.user.deleteMany({ where: { id: { in: created.ownerIds } } }));
  const leftovers = await Promise.all([
    db.logisticsShipment.count({ where: { ownerId: { in: created.ownerIds } } }),
    db.logisticsTrackingEvent.count({ where: { ownerId: { in: created.ownerIds } } }),
    db.user.count({ where: { id: { in: created.ownerIds } } }),
  ]);
  if (leftovers.some(Boolean)) failures.push(`leftovers remain: ${leftovers.join(",")}`);
  if (failures.length) throw new Error(`M6-A1 cleanup failed: ${failures.join(" | ")}`);
}

try {
  const migration = "prisma/migrations/20260718033824_add_generic_logistics_tracking_foundation/migration.sql";
  assert(await fs.stat(path.join(process.cwd(), migration)).then(() => true), "M6-A1 migration exists");
  const migrationSql = await fs.readFile(path.join(process.cwd(), migration), "utf8");
  assert(migrationSql.includes('CREATE TABLE "logistics_shipments"'), "migration creates logistics shipment table");
  assert(migrationSql.includes('CREATE TABLE "logistics_tracking_events"'), "migration creates logistics tracking event table");
  assert(!/DROP\s+(TABLE|COLUMN)|TRUNCATE/i.test(migrationSql), "migration is additive");

  await createFixture();
  const before = await businessSnapshot();
  const legacyCountBefore = await db.logisticsEvent.count();
  const service = new GenericLogisticsService(undefined, () => fixedNow);
  const registrations = [
    ["PURCHASE_INBOUND", created.purchaseOrderId, `${runId}-05`],
    ["PLATFORM_OUTBOUND", created.batchId, `${runId}-03`],
    ["PLATFORM_RETURN", created.lineId, `${runId}-06`],
    ["PURCHASE_AFTER_SALE_RETURN", created.purchaseAfterSaleCaseId, `${runId}-07`],
    ["SALE_AFTER_SALE_RETURN", created.saleAfterSaleCaseId, `${runId}-01`],
  ];
  const shipments = [];
  for (const [businessType, businessId, trackingNumber] of registrations) {
    const shipment = await service.registerShipment(ownerId, {
      businessType,
      businessId,
      provider: "mock",
      carrierCode: "mock-carrier",
      carrierName: "Mock Carrier",
      trackingNumber,
    });
    created.shipmentIds.push(shipment.id);
    shipments.push(shipment);
    assert(shipment.ownerId === ownerId, `${businessType} shipment is owner-scoped`);
    assert(shipment.normalizedTrackingNumber === trackingNumber.toUpperCase(), `${businessType} tracking number is normalized`);
  }
  assert(shipments.length === 5, "all five business types register against their real models");
  assert(new Set(shipments.map((shipment) => shipment.trackingNumber)).size === 5, "each fixture keeps its original tracking number");

  await rejectsCode(
    () => service.registerShipment(ownerId, { businessType: "PURCHASE_INBOUND", businessId: created.purchaseOrderId, provider: "MOCK", carrierCode: "MOCK", trackingNumber: `${runId}-DUP` }),
    "LOGISTICS_SHIPMENT_ALREADY_EXISTS",
    "same business object cannot register twice",
  );
  await rejectsCode(
    () => service.registerShipment(otherOwnerId, { businessType: "PURCHASE_INBOUND", businessId: created.purchaseOrderId, provider: "MOCK", carrierCode: "MOCK", trackingNumber: `${runId}-CROSS` }),
    "LOGISTICS_BUSINESS_OBJECT_NOT_FOUND",
    "cross-owner business object is hidden",
  );
  await rejectsCode(
    () => service.registerShipment(ownerId, { businessType: "PURCHASE_INBOUND", businessId: `${runId}-MISSING`, provider: "MOCK", carrierCode: "MOCK", trackingNumber: `${runId}-MISSING` }),
    "LOGISTICS_BUSINESS_OBJECT_NOT_FOUND",
    "missing business object is rejected",
  );
  await rejectsCode(
    () => service.registerShipment(ownerId, { businessType: "PURCHASE_INBOUND", businessId: `${runId}-OTHER`, provider: "UNKNOWN", carrierCode: "MOCK", trackingNumber: `${runId}-UNKNOWN` }),
    "LOGISTICS_PROVIDER_NOT_FOUND",
    "unknown provider is rejected",
  );
  await rejectsCode(() => service.getShipment(otherOwnerId, shipments[0].id), "LOGISTICS_SHIPMENT_NOT_FOUND", "cross-owner shipment is hidden");

  const firstSync = await service.syncShipmentWithProvider(ownerId, shipments[0].id);
  assert(firstSync.insertedEventCount === 5, "first delivered sync inserts all mock events");
  assert(firstSync.shipment.currentStatus === "DELIVERED", "delivered mock result maps to DELIVERED");
  assert(firstSync.shipment.deliveredAt instanceof Date, "first delivered sync records deliveredAt");
  assert(firstSync.shipment.syncStatus === "SYNCED", "successful sync records SYNCED");
  assert(firstSync.shipment.lastSyncedAt?.toISOString() === "2026-01-01T12:00:00.000Z", "lastSyncedAt uses provider query time");
  const deliveredAt = firstSync.shipment.deliveredAt?.toISOString();
  const repeatedSync = await service.syncShipmentWithProvider(ownerId, shipments[0].id);
  assert(repeatedSync.insertedEventCount === 0, "repeated sync does not duplicate events");
  assert(repeatedSync.shipment.deliveredAt?.toISOString() === deliveredAt, "repeated sync preserves first deliveredAt");
  assert((await service.listTrackingEvents(ownerId, shipments[0].id)).length === 5, "event listing remains idempotent");

  const stagedProvider = new StagedMockProvider();
  const stagedService = new GenericLogisticsService(new LogisticsProviderRegistry([stagedProvider]), () => fixedNow);
  const stagedFirst = await stagedService.syncShipmentWithProvider(ownerId, shipments[1].id);
  const stagedSecond = await stagedService.syncShipmentWithProvider(ownerId, shipments[1].id);
  assert(stagedFirst.insertedEventCount === 3, "staged provider first sync inserts initial events");
  assert(stagedSecond.insertedEventCount === 2, "staged provider later sync appends only new events");
  assert(stagedSecond.shipment.currentStatus === "DELIVERED", "later staged result advances generic status");
  assert((await service.listTrackingEvents(ownerId, shipments[1].id)).length === 5, "staged event history is complete without duplicates");

  const exceptionSync = await service.syncShipmentWithProvider(ownerId, shipments[2].id);
  assert(exceptionSync.shipment.currentStatus === "EXCEPTION", "exception mock result maps to EXCEPTION");
  const oldEventCount = await db.logisticsTrackingEvent.count({ where: { logisticsShipmentId: shipments[2].id } });
  const oldStatus = exceptionSync.shipment.currentStatus;
  const failingService = new GenericLogisticsService(new LogisticsProviderRegistry([new FailingMockProvider()]), () => fixedNow);
  await rejectsCode(() => failingService.syncShipmentWithProvider(ownerId, shipments[2].id), "MOCK_TEMPORARY_FAILURE", "provider failure returns stable code");
  const failedShipment = await service.getShipment(ownerId, shipments[2].id);
  assert(failedShipment.syncStatus === "RETRYABLE_ERROR", "retryable provider failure records retryable status");
  assert(failedShipment.failureCount === 1, "provider failure increments failureCount");
  assert(failedShipment.currentStatus === oldStatus, "provider failure preserves current status");
  assert(await db.logisticsTrackingEvent.count({ where: { logisticsShipmentId: shipments[2].id } }) === oldEventCount, "provider failure preserves old events");
  const recovered = await service.syncShipmentWithProvider(ownerId, shipments[2].id);
  assert(recovered.shipment.failureCount === 0 && recovered.shipment.lastErrorCode === null, "successful retry clears failure state");

  await db.logisticsTrackingEvent.create({
    data: {
      ownerId,
      logisticsShipmentId: shipments[3].id,
      dedupeKey: `${runId}-SHARED-DEDUPE`,
      eventTime: fixedNow,
      status: "UNKNOWN",
      description: "Constraint fixture",
    },
  });
  await rejectsCode(
    async () => {
      try {
        await db.logisticsTrackingEvent.create({
          data: { ownerId, logisticsShipmentId: shipments[3].id, dedupeKey: `${runId}-SHARED-DEDUPE`, eventTime: fixedNow, status: "UNKNOWN", description: "Duplicate" },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ServiceError("LOGISTICS_EVENT_DUPLICATE", "duplicate", 409);
        throw error;
      }
    },
    "LOGISTICS_EVENT_DUPLICATE",
    "same shipment dedupe key is unique",
  );
  await db.logisticsTrackingEvent.create({
    data: { ownerId, logisticsShipmentId: shipments[4].id, dedupeKey: `${runId}-SHARED-DEDUPE`, eventTime: fixedNow, status: "UNKNOWN", description: "Allowed on another shipment" },
  });
  assert(await db.logisticsTrackingEvent.count({ where: { dedupeKey: `${runId}-SHARED-DEDUPE` } }) === 2, "different shipments may share a dedupe key");

  const after = await businessSnapshot();
  assert(stable(after) === stable(before), "generic logistics sync does not modify any bound business object");
  assert(await db.logisticsEvent.count() === legacyCountBefore, "legacy purchase LogisticsEvent count is unchanged");
  assert(after.legacyEvent?.eventText === "Existing M2-A event", "legacy purchase LogisticsEvent remains intact");
  assert((await db.inventoryItem.findUnique({ where: { id: created.inventoryId } }))?.itemStatus === "STOCKED", "generic sync does not write inventory status");

  const serviceSource = await fs.readFile(path.join(process.cwd(), "src/server/logistics/logistics-service.ts"), "utf8");
  assert(!serviceSource.includes("inventoryItem.update"), "generic service has no inventory update path");
  assert(!serviceSource.includes("purchaseOrder.update"), "generic service has no purchase-order update path");
  assert(!serviceSource.includes("platformShipmentBatch.update"), "generic service has no platform-shipment update path");
  assert(!serviceSource.includes("purchaseAfterSaleCase.update"), "generic service has no purchase-after-sale update path");
  assert(!serviceSource.includes("saleAfterSaleCase.update"), "generic service has no sale-after-sale update path");
  assert(!serviceSource.includes('itemStatus: "SOLD"'), "generic service introduces no SOLD write");
  assert(!serviceSource.includes("fetch("), "generic service does not access a network");
  assert(!(await fs.readdir(path.join(process.cwd(), "src/app/api"))).includes("logistics-tracking"), "M6-A1 adds no public logistics API");

  console.log(`M6-A1 logistics verification passed (${checks} checks).`);
} finally {
  await cleanup();
  await db.$disconnect();
}
