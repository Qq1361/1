import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "../src/server/db.ts";
import { InventoryService } from "../src/server/services/inventory-service.ts";
import { getDailyBusinessReport } from "../src/server/reports/daily-business-report.ts";
import {
  classifyInventoryExpiryRisk,
  getShanghaiBusinessDate,
} from "../src/lib/inventory-expiry-risk.ts";

const runId = `M7-EXPIRY-${Date.now()}-${randomUUID().slice(0, 8)}`;
const ownerId = `${runId}-owner`;
const otherOwnerId = `${runId}-other-owner`;
const orderIds = [];
const warehouseIds = [];
const warehouseLocationIds = [];
const inventoryIds = [];
const asOf = new Date("2026-07-21T12:00:00.000Z");
let checks = 0;

function assert(value, message) {
  if (!value) throw new Error(message);
  checks += 1;
}

function dateAt(offset) {
  return new Date(Date.UTC(2026, 6, 21 + offset));
}

async function createInventory(owner, suffix, expiryDate, extra = {}) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId: owner,
      orderNo: `${runId}-${suffix}`,
      paidAt: asOf,
      totalAmount: "10.00",
      shippingAmount: "0.00",
      status: "PENDING_INSPECTION",
      allocationStatus: "CONFIRMED",
      allocationConfirmedAt: asOf,
      items: { create: { name: `${runId}-${suffix}`, skuText: suffix.includes("SKU") ? "2C0" : null, quantity: 1, allocatedTotalCost: "10.00" } },
    },
    include: { items: true },
  });
  orderIds.push(order.id);
  const inspection = await db.inspection.create({ data: { ownerId: owner, purchaseOrderItemId: order.items[0].id, sequence: 1 } });
  const inventory = await db.inventoryItem.create({
    data: {
      ownerId: owner,
      purchaseOrderItemId: order.items[0].id,
      inspectionId: inspection.id,
      inventoryCode: `${runId}-${suffix}`,
      name: `${runId}-${suffix}`,
      skuText: suffix.includes("SKU") ? "2C0" : null,
      unitCost: "10.00",
      itemStatus: "STOCKED",
      ownershipStatus: "OWNED",
      stockedAt: asOf,
      expiryDate,
      condition: "LIKE_NEW",
      ...extra,
    },
  });
  inventoryIds.push(inventory.id);
  return inventory;
}

try {
  await db.user.createMany({ data: [{ id: ownerId, name: ownerId }, { id: otherOwnerId, name: otherOwnerId }] });
  const warehouse = await db.warehouse.create({ data: { ownerId, name: `${runId}-仓库` } });
  warehouseIds.push(warehouse.id);
  const location = await db.warehouseLocation.create({ data: { ownerId, warehouseId: warehouse.id, name: "A-01" } });
  warehouseLocationIds.push(location.id);

  assert(classifyInventoryExpiryRisk(dateAt(-1), asOf) === "EXPIRED", "yesterday is expired");
  assert(classifyInventoryExpiryRisk(dateAt(0), asOf) === "WITHIN_30_DAYS", "today is within 30 days");
  assert(classifyInventoryExpiryRisk(dateAt(1), asOf) === "WITHIN_30_DAYS", "one day is within 30 days");
  assert(classifyInventoryExpiryRisk(dateAt(30), asOf) === "WITHIN_30_DAYS", "30 day boundary is within 30 days");
  assert(classifyInventoryExpiryRisk(dateAt(31), asOf) === "WITHIN_90_DAYS", "31 days is within 90 days");
  assert(classifyInventoryExpiryRisk(dateAt(90), asOf) === "WITHIN_90_DAYS", "90 day boundary is within 90 days");
  assert(classifyInventoryExpiryRisk(dateAt(91), asOf) === "WITHIN_180_DAYS", "91 days is within 180 days");
  assert(classifyInventoryExpiryRisk(dateAt(180), asOf) === "WITHIN_180_DAYS", "180 day boundary is within 180 days");
  assert(classifyInventoryExpiryRisk(dateAt(181), asOf) === null && classifyInventoryExpiryRisk(null, asOf) === null, "over 180 days and empty expiry have no risk");
  assert(getShanghaiBusinessDate(new Date("2026-07-20T16:30:00.000Z")).toISOString() === "2026-07-21T00:00:00.000Z", "Shanghai business date is timezone-stable");

  const expired = await createInventory(ownerId, "EXPIRED", dateAt(-1), { warehouseId: warehouse.id, storageLocationId: location.id });
  const within30 = await createInventory(ownerId, "SKU-30", dateAt(20), { warehouseId: warehouse.id, storageLocation: "手动库位" });
  const within90 = await createInventory(ownerId, "SKU-90", dateAt(60), { itemStatus: "PLATFORM_LISTED", storageLocation: "历史自由文本" });
  const within180 = await createInventory(ownerId, "SKU-180", dateAt(120), { itemStatus: "RETURNING" });
  await createInventory(ownerId, "NO-DATE", null);
  await createInventory(ownerId, "SOLD", dateAt(20), { itemStatus: "SOLD" });
  await createInventory(ownerId, "UPSTREAM-RETURN", dateAt(20), { ownershipStatus: "RETURNED_TO_UPSTREAM_SELLER" });
  await createInventory(otherOwnerId, "OTHER-OWNER", dateAt(20));

  const inventory = new InventoryService();
  const summary = await inventory.expiryRiskSummary(ownerId, asOf);
  const counts = Object.fromEntries(summary.risks.map((risk) => [risk.risk, risk.count]));
  assert(counts.EXPIRED === 1 && counts.WITHIN_30_DAYS === 1 && counts.WITHIN_90_DAYS === 1 && counts.WITHIN_180_DAYS === 1, "four risk ranges are mutually exclusive and count owned inventory");
  assert(summary.risks.find((risk) => risk.risk === "EXPIRED")?.nearestExpiryDate === "2026-07-20", "summary returns the nearest expiry date");
  assert(summary.risks.find((risk) => risk.risk === "WITHIN_30_DAYS")?.locations.some((entry) => entry.name.includes("手动库位")), "summary uses manual storage display location");
  assert(summary.risks.find((risk) => risk.risk === "EXPIRED")?.samples[0]?.displayStorageLocation.includes("A-01"), "summary uses standard warehouse location display");
  assert(summary.risks.find((risk) => risk.risk === "WITHIN_90_DAYS")?.samples[0]?.displayStorageLocation === "历史自由文本", "summary uses historical free-text location display");

  for (const [risk, id] of [["EXPIRED", expired.id], ["WITHIN_30_DAYS", within30.id], ["WITHIN_90_DAYS", within90.id], ["WITHIN_180_DAYS", within180.id]]) {
    const list = await inventory.list(ownerId, { expiryRisk: risk, page: 1, pageSize: 20, sort: "STOCKED_AT_DESC" });
    assert(list.total === 1 && list.data[0]?.id === id, `${risk} inventory filter uses the complete owner-scoped dataset`);
    assert(list.data[0]?.expiryRisk === risk, `${risk} list row exposes the same derived risk`);
  }
  const emptyExpiry = await inventory.list(ownerId, { expiryRisk: "NO_EXPIRY_DATE", page: 1, pageSize: 20, sort: "STOCKED_AT_DESC" });
  assert(emptyExpiry.total === 1 && emptyExpiry.data[0]?.inventoryCode.endsWith("NO-DATE"), "no-expiry filter is server-side and paginated");
  const skuAndRisk = await inventory.list(ownerId, { expiryRisk: "WITHIN_30_DAYS", query: "SKU-30", page: 1, pageSize: 20, sort: "STOCKED_AT_DESC" });
  assert(skuAndRisk.total === 1 && skuAndRisk.data[0]?.id === within30.id, "expiry risk combines with keyword filtering");
  const warehouseAndRisk = await inventory.list(ownerId, { expiryRisk: "EXPIRED", warehouseId: warehouse.id, page: 1, pageSize: 20, sort: "STOCKED_AT_DESC" });
  assert(warehouseAndRisk.total === 1 && warehouseAndRisk.data[0]?.id === expired.id, "expiry risk combines with warehouse filtering");

  const before = await db.inventoryItem.findMany({ where: { id: { in: inventoryIds } }, select: { id: true, expiryDate: true, itemStatus: true, unitCost: true, updatedAt: true }, orderBy: { id: "asc" } });
  const report = await getDailyBusinessReport({ ownerId, date: "2026-07-20", timezone: "Asia/Shanghai", generatedAt: asOf });
  assert(report.inventoryExpiry.counts.EXPIRED === 1 && report.inventoryExpiry.counts.WITHIN_30_DAYS === 1 && report.inventoryExpiry.counts.WITHIN_90_DAYS === 1 && report.inventoryExpiry.counts.WITHIN_180_DAYS === 1, "daily report reuses the four expiry counts");
  assert(report.inventoryExpiry.samples.length === 4 && report.inventoryExpiry.samples[0]?.expiryDate === "2026-07-20", "daily report exposes at most five nearest expiry samples in order");
  const after = await db.inventoryItem.findMany({ where: { id: { in: inventoryIds } }, select: { id: true, expiryDate: true, itemStatus: true, unitCost: true, updatedAt: true }, orderBy: { id: "asc" } });
  assert(JSON.stringify(before) === JSON.stringify(after), "expiry aggregation does not modify inventory dates, status, cost, or timestamps");
  assert((await db.saleOrder.count({ where: { ownerId } })) === 0 && (await db.saleAfterSaleCase.count({ where: { ownerId } })) === 0, "expiry aggregation creates no sales or after-sales records");
  assert((await db.inventoryItem.count({ where: { ownerId, itemStatus: "SOLD" } })) === 1, "expiry aggregation does not add SOLD writes");

  const [routeSource, dashboardSource, listSource] = await Promise.all([
    readFile(new URL("../src/app/api/inventory/expiry-risk/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/inventory/inventory-list.tsx", import.meta.url), "utf8"),
  ]);
  assert(routeSource.includes("expiryRiskSummary") && !/\.(create|update|delete|upsert)\(/.test(routeSource), "expiry summary API is read-only");
  assert(dashboardSource.includes("/api/inventory/expiry-risk") && dashboardSource.includes("/inventory?expiryRisk="), "dashboard renders expiry risks with direct inventory links");
  assert(dashboardSource.includes("setLoadError(true)") && dashboardSource.includes("loadDashboard") && !dashboardSource.includes("setExpiryRiskSummary(null)"), "dashboard failure keeps the prior expiry summary and exposes the existing retry path");
  assert(listSource.includes('aria-label="效期状态"') && listSource.includes("expiryRisk"), "inventory page exposes an expiry status filter");
  assert(!routeSource.includes("SOLD") && !dashboardSource.includes("itemStatus:"), "expiry dashboard path has no SOLD or inventory-status write logic");

  console.log(`verify:m7-expiry-reminders passed: ${checks} checks`);
} finally {
  await db.inventoryItem.deleteMany({ where: { id: { in: inventoryIds } } });
  await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  await db.warehouseLocation.deleteMany({ where: { id: { in: warehouseLocationIds } } });
  await db.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } });
  const residual = await db.inventoryItem.count({ where: { ownerId: { in: [ownerId, otherOwnerId] } } });
  if (residual !== 0) throw new Error(`fixture cleanup failed: ${residual} inventory records remain`);
}
