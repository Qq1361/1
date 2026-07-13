import "dotenv/config";
import fs from "node:fs/promises";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const ownerId = "default-user";
const runId = Date.now();
const productName = `SKU汇总测试-${runId}`;
let orderId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dec(value) {
  return new Prisma.Decimal(value);
}

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function createInventory(item, sequence, skuText, itemStatus, unitCost) {
  const inspection = await db.inspection.create({
    data: {
      ownerId,
      purchaseOrderItemId: item.id,
      sequence,
      status: "PASSED",
      result: "PASS",
      currentStep: 6,
      completedAt: new Date(),
    },
  });

  return db.inventoryItem.create({
    data: {
      ownerId,
      purchaseOrderItemId: item.id,
      inspectionId: inspection.id,
      inventoryCode: `SKU-SUM-${runId}-${sequence}`,
      name: productName,
      skuText,
      unitCost: dec(unitCost),
      itemStatus,
      stockedAt: new Date(),
    },
  });
}

try {
  await db.user.upsert({
    where: { id: ownerId },
    update: {},
    create: { id: ownerId, name: "Default User" },
  });

  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `SKU-SUM-${runId}`,
      paidAt: new Date(),
      totalAmount: dec("1200.00"),
      shippingAmount: dec("0.00"),
      items: {
        create: [{
          name: productName,
          skuText: "2C0",
          quantity: 9,
          allocatedTotalCost: dec("1200.00"),
        }],
      },
    },
    include: { items: true },
  });
  orderId = order.id;
  const item = order.items[0];

  await createInventory(item, 1, "2C0", "STOCKED", "100.00");
  await createInventory(item, 2, "2C0", "PLATFORM_LISTED", "120.00");
  await createInventory(item, 3, "2C0", "SOLD", "130.00");
  await createInventory(item, 4, "2C0", "PROBLEM", "140.00");
  await createInventory(item, 5, "2C0", "RETURNED", "150.00");
  await createInventory(item, 6, "2C0", "RETURNING", "160.00");
  await createInventory(item, 7, "1W1", "STOCKED", "200.00");
  await createInventory(item, 8, "1W1", "PLATFORM_RECEIVED", "220.00");
  await createInventory(item, 9, null, "STOCKED", "50.00");

  const summary = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}`);
  assert(summary.items.length === 3, `expected 3 SKU rows, got ${summary.items.length}`);

  const row2c0 = summary.items.find((row) => row.productName === productName && row.sku === "2C0");
  const row1w1 = summary.items.find((row) => row.productName === productName && row.sku === "1W1");
  const rowEmpty = summary.items.find((row) => row.productName === productName && row.sku === null);
  assert(row2c0, "2C0 row missing");
  assert(row1w1, "1W1 row missing");
  assert(rowEmpty, "empty SKU row missing");

  assert(row2c0.localAvailableCount === 1, "STOCKED should count as local available");
  assert(row2c0.platformCount === 1, "PLATFORM_LISTED should count as platform");
  assert(row2c0.soldCount === 1, "SOLD should count as sold");
  assert(row2c0.unavailableCount === 3, "PROBLEM/RETURNED/RETURNING should count as unavailable");
  assert(row2c0.totalCount === 6, "2C0 total count");
  assert(
    row2c0.totalCount === row2c0.localAvailableCount + row2c0.platformCount + row2c0.soldCount + row2c0.unavailableCount,
    "total count should equal category counts",
  );
  assert(row2c0.averageCost === "133.33", `2C0 average cost ${row2c0.averageCost}`);
  assert(row2c0.minCost === "100.00", `2C0 min cost ${row2c0.minCost}`);
  assert(row2c0.maxCost === "160.00", `2C0 max cost ${row2c0.maxCost}`);
  assert(row2c0.totalCost === "800.00", `2C0 total cost ${row2c0.totalCost}`);

  assert(row1w1.localAvailableCount === 1, "1W1 local count");
  assert(row1w1.platformCount === 1, "1W1 platform count");
  assert(row1w1.soldCount === 0, "1W1 sold count");
  assert(row1w1.totalCount === 2, "1W1 should be separate from 2C0");
  assert(row1w1.averageCost === "210.00", `1W1 average cost ${row1w1.averageCost}`);

  assert(rowEmpty.sku === null, "empty SKU should be null in API");
  assert(rowEmpty.totalCount === 1 && rowEmpty.averageCost === "50.00", "empty SKU aggregate");

  const localOnly = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}&filter=LOCAL_AVAILABLE`);
  assert(localOnly.items.length === 3, "local available filter");
  const platformOnly = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}&filter=PLATFORM`);
  assert(platformOnly.items.length === 2, "platform filter");
  const soldOnly = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}&filter=SOLD`);
  assert(soldOnly.items.length === 1 && soldOnly.items[0].sku === "2C0", "sold filter");
  const unavailableOnly = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}&filter=UNAVAILABLE`);
  assert(unavailableOnly.items.length === 1 && unavailableOnly.items[0].sku === "2C0", "unavailable filter");

  const invalid = await fetch(`${baseUrl}/api/inventory/sku-summary?filter=BAD`);
  assert(invalid.status === 422, "invalid filter should be rejected");

  const routeSource = await fs.readFile("src/app/api/inventory/sku-summary/route.ts", "utf8");
  const serviceSource = await fs.readFile("src/server/services/inventory-service.ts", "utf8");
  const pageSource = await fs.readFile("src/components/inventory/inventory-sku-summary.tsx", "utf8");
  const inventoryPageSource = await fs.readFile("src/components/inventory/inventory-page-content.tsx", "utf8");
  const readOnlySource = `${routeSource}\n${pageSource}\n${inventoryPageSource}`;
  assert(!routeSource.includes("export async function POST"), "sku summary API must not expose POST");
  assert(!routeSource.includes("export async function PATCH"), "sku summary API must not expose PATCH");
  assert(!routeSource.includes("export async function DELETE"), "sku summary API must not expose DELETE");
  assert(!routeSource.includes("inventoryItem.update"), "sku summary API must not update inventory");
  assert(!readOnlySource.includes('itemStatus: "SOLD"'), "sku summary page/API must not write SOLD");
  assert(!readOnlySource.includes("SalesService"), "sku summary page/API must not call SalesService");
  assert(!readOnlySource.includes("applyShipmentLineAction"), "sku summary page/API must not call shipment state machine");
  assert(pageSource.includes("未填写"), "empty SKU should display as 未填写");
  assert(serviceSource.includes("PLATFORM_LISTED"), "PLATFORM_LISTED should be categorized explicitly");

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "same product + same SKU aggregates",
      "different SKU split separately",
      "STOCKED counts as local available",
      "PLATFORM_LISTED counts as platform, not sold",
      "SOLD counts as sold",
      "PROBLEM/RETURNED/RETURNING count as unavailable",
      "total count equals category sum",
      "average/min/max/total cost",
      "empty SKU displays as 未填写",
      "filter local/platform/sold/unavailable",
      "API rejects invalid filter",
      "API and page are read-only",
      "no new SOLD write logic",
    ],
  }, null, 2));
} finally {
  if (orderId) await db.purchaseOrder.deleteMany({ where: { id: orderId } }).catch(() => {});
  await db.$disconnect();
}
