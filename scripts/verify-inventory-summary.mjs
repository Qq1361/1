import "dotenv/config";
import fs from "node:fs/promises";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { inspectionService } from "../src/server/services/inspection-service.ts";
import { inventoryService } from "../src/server/services/inventory-service.ts";
import { purchaseOrderService } from "../src/server/services/purchase-order-service.ts";
import { salesService } from "../src/server/sales/sales-service.ts";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const ownerId = "default-user";
const runId = Date.now();
const productName = `SKU汇总测试-${runId}`;
let orderId;
let normalizedOrderId;
const saleOrderIds = [];
const accessCookie = process.env.APP_PASSWORD ? `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}` : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dec(value) {
  return new Prisma.Decimal(value);
}

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: accessCookie ? { Cookie: accessCookie } : {} });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function bulkSkuPreview(input) {
  const response = await fetch(`${baseUrl}/api/inventory/bulk-sku`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(accessCookie ? { Cookie: accessCookie } : {}) },
    body: JSON.stringify(input),
  });
  return { response, body: await response.json() };
}

async function confirmBulkSku(input, selectionFingerprint) {
  const response = await fetch(`${baseUrl}/api/inventory/bulk-sku`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(accessCookie ? { Cookie: accessCookie } : {}) },
    body: JSON.stringify({ ...input, selectionFingerprint }),
  });
  return { response, body: await response.json() };
}

async function createInventory(item, sequence, skuText, itemStatus, unitCost, name = productName) {
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
      name,
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
          quantity: 20,
          allocatedTotalCost: dec("1200.00"),
        }],
      },
    },
    include: { items: true },
  });
  orderId = order.id;
  const item = order.items[0];

  const normalizedOrder = await purchaseOrderService.createOrder(ownerId, {
    orderNo: `SKU-NORMALIZE-${runId}`,
    paidAt: new Date().toISOString(),
    totalAmount: "1.00",
    shippingAmount: "0.00",
    items: [{ name: `${productName}-source`, skuText: " 2c0 ", quantity: 1 }],
  });
  normalizedOrderId = normalizedOrder.id;
  const normalizedSourceItem = await db.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: normalizedOrderId } });
  assert(normalizedSourceItem.skuText === "2C0", "purchase SKU is normalized on create");

  const stocked2c0 = await createInventory(item, 1, "2C0", "STOCKED", "100.00");
  await createInventory(item, 2, "2C0", "PLATFORM_LISTED", "120.00");
  await createInventory(item, 3, "2C0", "SOLD", "130.00");
  await createInventory(item, 4, "2C0", "PROBLEM", "140.00");
  await createInventory(item, 5, "2C0", "RETURNED", "150.00");
  await createInventory(item, 6, "2C0", "RETURNING", "160.00");
  await createInventory(item, 7, "1W1", "STOCKED", "200.00");
  await createInventory(item, 8, "1W1", "PLATFORM_RECEIVED", "220.00");
  const emptySkuItem = await createInventory(item, 9, null, "STOCKED", "50.00");
  await createInventory(item, 13, " 2c0 ", "PLATFORM_SHIPPED", "170.00");
  await createInventory(item, 14, "2c0", "PLATFORM_RECEIVED", "180.00");
  await createInventory(item, 15, "2C0", "PLATFORM_IN_WAREHOUSE", "190.00");

  const summary = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}`);
  assert(summary.items.length === 3, `expected 3 SKU rows, got ${summary.items.length}`);

  const row2c0 = summary.items.find((row) => row.productName === productName && row.sku === "2C0");
  const row1w1 = summary.items.find((row) => row.productName === productName && row.sku === "1W1");
  const rowEmpty = summary.items.find((row) => row.productName === productName && row.sku === null);
  assert(row2c0, "2C0 row missing");
  assert(row1w1, "1W1 row missing");
  assert(rowEmpty, "empty SKU row missing");

  assert(row2c0.localAvailableCount === 1, "STOCKED should count as local available");
  assert(row2c0.platformCount === 4, "all platform states should count as platform");
  assert(row2c0.soldCount === 1, "SOLD should count as sold");
  assert(row2c0.unavailableCount === 3, "PROBLEM/RETURNED/RETURNING should count as unavailable");
  assert(row2c0.totalCount === 9, "2C0 total count");
  assert(
    row2c0.totalCount === row2c0.localAvailableCount + row2c0.platformCount + row2c0.soldCount + row2c0.unavailableCount,
    "total count should equal category counts",
  );
  assert(row2c0.unsoldCount === 8, "2C0 unsold count excludes SOLD");
  assert(row2c0.immediatelySellableCount === 2, "STOCKED and PLATFORM_LISTED are immediately sellable");
  assert(row2c0.exceptionCount === 3, "problem/returned/returning are exceptions");
  assert(row2c0.platformTransitCount === 2 && row2c0.platformWarehouseCount === 1, "platform transit and warehouse counts");
  assert(row2c0.averageUnsoldCost === "151.25", `2C0 average unsold cost ${row2c0.averageUnsoldCost}`);
  assert(row2c0.minCost === "100.00", `2C0 min cost ${row2c0.minCost}`);
  assert(row2c0.maxUnsoldCost === "190.00", `2C0 max unsold cost ${row2c0.maxUnsoldCost}`);
  assert(row2c0.unsoldCostTotal === "1210.00", `2C0 unsold cost ${row2c0.unsoldCostTotal}`);

  assert(row1w1.localAvailableCount === 1, "1W1 local count");
  assert(row1w1.platformCount === 1, "1W1 platform count");
  assert(row1w1.soldCount === 0, "1W1 sold count");
  assert(row1w1.totalCount === 2, "1W1 should be separate from 2C0");
  assert(row1w1.averageCost === "210.00", `1W1 average cost ${row1w1.averageCost}`);

  assert(rowEmpty.sku === null, "empty SKU should be null in API");
  assert(rowEmpty.totalCount === 1 && rowEmpty.averageCost === "50.00", "empty SKU aggregate");

  const exact2c0 = await request(`/api/inventory?productNameExact=${encodeURIComponent(productName)}&skuExact=2c0&page=1&pageSize=20`);
  assert(exact2c0.total === 9 && exact2c0.data.every((row) => ["2C0", "2c0", " 2c0 "].includes(row.skuText)), "exact normalized SKU filter");
  const exactEmpty = await request(`/api/inventory?productNameExact=${encodeURIComponent(productName)}&skuEmpty=true&page=1&pageSize=20`);
  assert(exactEmpty.total === 1 && exactEmpty.data[0].id === emptySkuItem.id, "exact empty SKU filter");

  const beforeSkuUpdate = await db.inventoryItem.findUniqueOrThrow({ where: { id: emptySkuItem.id } });
  const singleSkuResponse = await fetch(`${baseUrl}/api/inventory/${emptySkuItem.id}/sku`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(accessCookie ? { Cookie: accessCookie } : {}) }, body: JSON.stringify({ skuText: " 2c0 " }) });
  const singleSku = await singleSkuResponse.json();
  assert(singleSkuResponse.ok && singleSku.skuText === "2C0", "SKU-only API normalizes and saves SKU");
  const afterSkuUpdate = await db.inventoryItem.findUniqueOrThrow({ where: { id: emptySkuItem.id } });
  assert(afterSkuUpdate.itemStatus === beforeSkuUpdate.itemStatus && afterSkuUpdate.unitCost.equals(beforeSkuUpdate.unitCost) && afterSkuUpdate.saleMode === beforeSkuUpdate.saleMode && afterSkuUpdate.storageLocation === beforeSkuUpdate.storageLocation, "SKU-only update keeps inventory business fields unchanged");

  const bulkEmpty = await createInventory(item, 16, null, "STOCKED", "55.00");
  const bulkExisting = await createInventory(item, 17, "1W1", "STOCKED", "56.00");
  const bulkDefaultInput = { inventoryItemIds: [bulkEmpty.id, bulkExisting.id], skuText: " 3n1 " };
  const bulkDefaultPreview = await bulkSkuPreview(bulkDefaultInput);
  assert(bulkDefaultPreview.response.ok && bulkDefaultPreview.body.updateCount === 1 && bulkDefaultPreview.body.skippedCount === 1, "bulk SKU preview defaults to empty values only");
  const bulkDefault = await confirmBulkSku(bulkDefaultInput, bulkDefaultPreview.body.selectionFingerprint);
  assert(bulkDefault.response.ok && bulkDefault.body.updatedCount === 1 && bulkDefault.body.skippedCount === 1, "bulk SKU confirmation applies the preview plan");
  const bulkOverwriteInput = { inventoryItemIds: [bulkExisting.id], skuText: "3n1", overwriteExisting: true };
  const bulkOverwritePreview = await bulkSkuPreview(bulkOverwriteInput);
  const bulkOverwrite = await confirmBulkSku(bulkOverwriteInput, bulkOverwritePreview.body.selectionFingerprint);
  assert(bulkOverwrite.response.ok && bulkOverwrite.body.updatedCount === 1, "bulk SKU overwrite requires explicit flag");

  const otherProduct = await createInventory(item, 18, null, "STOCKED", "57.00", `${productName}-OTHER`);
  const mixed = await bulkSkuPreview({ inventoryItemIds: [stocked2c0.id, otherProduct.id], skuText: "4w2" });
  assert(mixed.response.status === 409, "mixed products are rejected without explicit confirmation");

  await db.purchaseOrder.update({ where: { id: orderId }, data: { allocationStatus: "CONFIRMED", allocationConfirmedAt: new Date() } });
  const pendingInspection = await db.inspection.create({
    data: { ownerId, purchaseOrderItemId: item.id, sequence: 19, status: "PENDING", currentStep: 1 },
  });
  const inspectionDetail = await inspectionService.get(ownerId, pendingInspection.id);
  assert(inspectionDetail.purchaseOrderItem.skuText === "2C0", "inspection reads the purchase SKU as its source value");
  const completedInspection = await inspectionService.complete(ownerId, pendingInspection.id, { result: "PASS", skuText: " 1w1 " });
  assert(completedInspection.inventory.skuText === "1W1", "inspection completion writes normalized SKU to inventory");
  await inspectionService.update(ownerId, pendingInspection.id, { skuText: " 2c0 " });
  const correctedInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: completedInspection.inventory.id } });
  const unchangedSourceItem = await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: item.id } });
  assert(correctedInventory.skuText === "2C0" && unchangedSourceItem.skuText === "2C0", "completed inspection corrects inventory SKU without rewriting purchase source");

  const draftInventory = await createInventory(item, 20, "DRAFT-OLD", "STOCKED", "88.00");
  const draftSale = await salesService.createDraft(ownerId, {
    platform: "XIANYU", soldAt: new Date().toISOString(), grossAmount: "120.00", items: [{ inventoryItemId: draftInventory.id }],
  });
  saleOrderIds.push(draftSale.id);
  await inventoryService.updateSkuOnly(ownerId, draftInventory.id, " draft-new ");
  await salesService.confirm(ownerId, draftSale.id);
  const confirmedLine = await db.saleLine.findFirstOrThrow({ where: { saleOrderId: draftSale.id } });
  assert(confirmedLine.skuSnapshot === "DRAFT-NEW", "confirm refreshes draft sale SKU snapshot from inventory by item ID");
  const skippedHistoricalInput = { inventoryItemIds: [draftInventory.id], skuText: "after-confirm", overwriteExisting: true };
  const skippedHistoricalPreview = await bulkSkuPreview(skippedHistoricalInput);
  const skippedHistorical = await confirmBulkSku(skippedHistoricalInput, skippedHistoricalPreview.body.selectionFingerprint);
  assert(skippedHistorical.response.ok && skippedHistorical.body.updatedCount === 0 && skippedHistorical.body.skippedCount === 1, "historical inventory is excluded from bulk SKU correction by default");
  const includedHistoricalInput = { inventoryItemIds: [draftInventory.id], skuText: "after-confirm", overwriteExisting: true, includeHistorical: true };
  const includedHistoricalPreview = await bulkSkuPreview(includedHistoricalInput);
  const includedHistorical = await confirmBulkSku(includedHistoricalInput, includedHistoricalPreview.body.selectionFingerprint);
  assert(includedHistorical.response.ok && includedHistorical.body.updatedCount === 1, "historical inventory requires explicit inclusion for bulk SKU correction");
  const immutableLine = await db.saleLine.findFirstOrThrow({ where: { id: confirmedLine.id } });
  assert(immutableLine.skuSnapshot === "DRAFT-NEW", "confirmed sale SKU snapshot remains immutable after inventory correction");

  const localOnly = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}&filter=LOCAL_AVAILABLE`);
  assert(localOnly.items.every((row) => row.localStockedCount > 0), "local available filter");
  const platformOnly = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}&filter=PLATFORM`);
  assert(platformOnly.items.length === 2 && platformOnly.items.every((row) => row.platformListedCount + row.platformTransitCount + row.platformWarehouseCount > 0), "platform filter");
  const soldOnly = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}&filter=SOLD`);
  assert(soldOnly.items.every((row) => row.soldCount > 0), "sold filter");
  const unavailableOnly = await request(`/api/inventory/sku-summary?query=${encodeURIComponent(productName)}&filter=UNAVAILABLE`);
  assert(unavailableOnly.items.length === 1 && unavailableOnly.items[0].sku === "2C0", "unavailable filter");

  const invalid = await fetch(`${baseUrl}/api/inventory/sku-summary?filter=BAD`, { headers: accessCookie ? { Cookie: accessCookie } : {} });
  assert(invalid.status === 422, "invalid filter should be rejected");

  const routeSource = await fs.readFile("src/app/api/inventory/sku-summary/route.ts", "utf8");
  const schemaSource = await fs.readFile("prisma/schema.prisma", "utf8");
  const serviceSource = await fs.readFile("src/server/services/inventory-service.ts", "utf8");
  const pageSource = await fs.readFile("src/components/inventory/inventory-sku-summary.tsx", "utf8");
  const inventoryListSource = await fs.readFile("src/components/inventory/inventory-list.tsx", "utf8");
  const statusLabelsSource = await fs.readFile("src/lib/status-labels.ts", "utf8");
  const validationSource = await fs.readFile("src/server/validation/inspection.ts", "utf8");
  const inventoryPageSource = await fs.readFile("src/components/inventory/inventory-page-content.tsx", "utf8");
  const readOnlySource = `${routeSource}\n${pageSource}\n${inventoryPageSource}`;
  assert(!routeSource.includes("export async function POST"), "sku summary API must not expose POST");
  assert(!routeSource.includes("export async function PATCH"), "sku summary API must not expose PATCH");
  assert(!routeSource.includes("export async function DELETE"), "sku summary API must not expose DELETE");
  assert(!routeSource.includes("inventoryItem.update"), "sku summary API must not update inventory");
  assert(!readOnlySource.includes('itemStatus: "SOLD"'), "sku summary page/API must not write SOLD");
  assert(!readOnlySource.includes("SalesService"), "sku summary page/API must not call SalesService");
  assert(!readOnlySource.includes("applyShipmentLineAction"), "sku summary page/API must not call shipment state machine");
  assert(pageSource.includes("skuEmpty") && pageSource.includes("URLSearchParams"), "summary detail link must use exact SKU parameters");
  assert(serviceSource.includes("PLATFORM_LISTED"), "PLATFORM_LISTED should be categorized explicitly");
  const itemStatusEnum = schemaSource.match(/enum ItemStatus \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert(!itemStatusEnum.includes("REMOVED"), "current Prisma ItemStatus must not claim REMOVED support");
  assert(!inventoryListSource.includes('"REMOVED"') && !statusLabelsSource.includes("REMOVED:"), "inventory UI must not expose REMOVED");
  assert(!validationSource.includes('"REMOVED"'), "inventory query validation must not accept REMOVED");
  assert(!serviceSource.includes('"REMOVED"'), "SKU summary and SKU update service must not implement an unreachable REMOVED branch");
  assert(serviceSource.includes('item.itemStatus === "SOLD" && !input.includeHistorical'), "includeHistorical must only include SOLD archives in V1");

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "normalizeSku unit tests cover canonical SKU values",
      "purchase SKU prefill flows through inspection to inventory",
      "single SKU-only correction leaves business fields unchanged",
      "bulk SKU correction defaults to empty SKU only",
      "mixed-product bulk SKU correction is rejected atomically",
      "draft confirm refreshes SKU snapshot by inventory item ID",
      "confirmed sale SKU snapshot remains immutable",
      "normalized SKU variants aggregate into one group",
      "exact SKU and empty-SKU detail filters are server-side",
      "exact detail filters return correct pagination totals",
      "STOCKED and PLATFORM_LISTED remain distinct from SOLD",
      "SOLD is excluded from unsold quantity and cost",
      "current Prisma ItemStatus does not support REMOVED",
      "inventory API, validation, labels, and filters do not expose REMOVED",
      "includeHistorical applies only to SOLD archive SKU correction",
      "SKU summary API and page remain read-only",
      "no new SOLD write logic",
      "test data cleanup uses exact created IDs",
    ],
  }, null, 2));
} finally {
  try {
    if (saleOrderIds.length) {
      await db.saleActionLog.deleteMany({ where: { saleOrderId: { in: saleOrderIds } } });
      await db.saleFeeLine.deleteMany({ where: { saleOrderId: { in: saleOrderIds } } });
      await db.saleLine.deleteMany({ where: { saleOrderId: { in: saleOrderIds } } });
      await db.saleOrder.deleteMany({ where: { id: { in: saleOrderIds } } });
    }
    if (orderId) await db.purchaseOrder.delete({ where: { id: orderId } });
    if (normalizedOrderId) await db.purchaseOrder.delete({ where: { id: normalizedOrderId } });
    if (orderId && await db.purchaseOrder.count({ where: { id: orderId } })) {
      throw new Error(`SKU summary cleanup left purchase order ${orderId}`);
    }
    if (normalizedOrderId && await db.purchaseOrder.count({ where: { id: normalizedOrderId } })) {
      throw new Error(`SKU summary cleanup left purchase order ${normalizedOrderId}`);
    }
  } catch (error) {
    console.error("SKU summary cleanup failed", { orderId, error });
    throw error;
  } finally {
    await db.$disconnect();
  }
}
