import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "../src/server/db.ts";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const runId = `M2B-BATCH-${Date.now()}-${randomUUID().slice(0, 8)}`;
const orderIds = [];
let otherOwnerId = null;
const accessCookie = process.env.APP_PASSWORD
  ? `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`
  : null;
const checks = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name) {
  checks.push(name);
}

async function call(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(accessCookie ? { Cookie: accessCookie } : {}),
    },
  });
  return {
    response,
    body: response.status === 204 ? null : await response.json().catch(() => null),
  };
}

async function createPendingOrder({ ownerId = "default-user", label, itemCount = 1 }) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-${label}`,
      paidAt: new Date(),
      totalAmount: `${itemCount * 10}.00`,
      shippingAmount: "0.00",
      status: "PENDING_INSPECTION",
      allocationStatus: "CONFIRMED",
      allocationConfirmedAt: new Date(),
      items: {
        create: Array.from({ length: itemCount }, (_, index) => ({
          name: `${runId}-同款商品`,
          skuText: "BATCH-2C0",
          quantity: 1,
          allocatedTotalCost: "10.00",
          notes: `fixture-${index + 1}`,
        })),
      },
    },
    include: { items: true },
  });
  orderIds.push(order.id);
  const inspections = await Promise.all(
    order.items.map((item) =>
      db.inspection.create({
        data: { ownerId, purchaseOrderItemId: item.id, sequence: 1 },
      }),
    ),
  );
  return { order, inspections };
}

async function postBatch(inspectionIds, extra = undefined) {
  return call("/api/inspections/batch-pass", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(extra ?? { inspectionIds }),
  });
}

async function inventoryIdsFor(inspections) {
  const rows = await db.inventoryItem.findMany({
    where: { inspectionId: { in: inspections.map((item) => item.id) } },
    select: { id: true, inspectionId: true, purchaseOrderItemId: true, itemStatus: true },
  });
  return rows;
}

try {
  const [serviceSource, routeSource, schemaSource] = await Promise.all([
    readFile(new URL("../src/server/services/inspection-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/inspections/batch-pass/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/server/validation/inspection.ts", import.meta.url), "utf8"),
  ]);
  assert(routeSource.includes("inspectionService.batchPass"), "batch route does not delegate to service");
  assert(schemaSource.includes("inspectionBatchPassSchema") && schemaSource.includes(".strict()"), "batch request schema is not strict");
  assert(serviceSource.includes("completeTx") && serviceSource.includes("isolationLevel: \"Serializable\""), "batch does not reuse transaction completion core");
  assert(!serviceSource.includes("itemStatus: \"SOLD\""), "inspection service contains a SOLD writer");
  pass("batch route, strict DTO, transaction core, and no SOLD writer");

  let result = await postBatch([]);
  assert(result.response.status === 400 && result.body?.code === "BATCH_INSPECTION_EMPTY", "empty batch was not rejected");
  pass("empty batch is rejected");

  const singleForLimits = await createPendingOrder({ label: "limits" });
  result = await postBatch(Array.from({ length: 51 }, () => singleForLimits.inspections[0].id));
  assert(result.response.status === 400 && result.body?.code === "BATCH_INSPECTION_TOO_MANY", "51 items were not rejected");
  pass("51-item batch is rejected");

  result = await postBatch([singleForLimits.inspections[0].id, singleForLimits.inspections[0].id]);
  assert(result.response.status === 400 && result.body?.code === "BATCH_INSPECTION_DUPLICATE_IDS", "duplicate inspection IDs were not rejected");
  pass("duplicate inspection IDs are rejected");

  result = await postBatch([], { inspectionIds: [singleForLimits.inspections[0].id], ownerId: "default-user" });
  assert(result.response.status === 422 && result.body?.code === "VALIDATION_ERROR", "unknown batch fields were accepted");
  pass("strict DTO rejects owner and unknown fields");

  result = await postBatch([], { inspectionIds: "not-an-array" });
  assert(result.response.status === 422 && result.body?.code === "VALIDATION_ERROR", "non-array inspection IDs were accepted");
  pass("non-array inspection IDs are rejected");

  result = await postBatch([], { inspectionIds: [123] });
  assert(result.response.status === 422 && result.body?.code === "VALIDATION_ERROR", "non-string inspection IDs were accepted");
  pass("non-string inspection IDs are rejected");

  const successful = await createPendingOrder({ label: "success", itemCount: 3 });
  const beforeSales = await db.saleOrder.count();
  const beforeRefunds = await db.purchaseRefundRecord.count();
  const beforeItems = await db.inventoryItem.count();
  const beforeOrder = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: successful.order.id },
    include: { items: { select: { id: true, allocatedTotalCost: true } } },
  });
  result = await postBatch(successful.inspections.map((item) => item.id));
  assert(result.response.status === 200, `multi-item batch failed: ${JSON.stringify(result.body)}`);
  assert(result.body?.processedCount === 3 && result.body?.skippedCount === 0, "batch response counts are incorrect");
  assert(result.body?.inspectionIds.length === 3 && result.body?.inventoryItemIds.length === 3, "batch response IDs are incomplete");
  const createdInventory = await inventoryIdsFor(successful.inspections);
  assert(createdInventory.length === 3, "batch did not create three inventory records");
  assert(new Set(createdInventory.map((item) => item.inspectionId)).size === 3, "inventory did not remain one per inspection");
  assert(new Set(createdInventory.map((item) => item.purchaseOrderItemId)).size === 3, "same name/SKU items were merged");
  assert(createdInventory.every((item) => item.itemStatus === "STOCKED"), "batch pass did not create stocked inventory");
  assert(await db.saleOrder.count() === beforeSales, "batch pass modified sales");
  assert(await db.purchaseRefundRecord.count() === beforeRefunds, "batch pass modified purchase refunds");
  assert((await db.inventoryItem.count()) === beforeItems + 3, "batch inventory count is incorrect");
  const afterOrder = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: successful.order.id },
    include: { items: { select: { id: true, allocatedTotalCost: true } } },
  });
  assert(afterOrder.totalAmount.equals(beforeOrder.totalAmount), "batch pass changed order paid amount");
  assert(
    afterOrder.items.every(
      (item) =>
        item.allocatedTotalCost?.toFixed(2) ===
        beforeOrder.items.find((before) => before.id === item.id)?.allocatedTotalCost?.toFixed(2),
    ),
    "batch pass changed allocated purchase costs",
  );
  pass("multi-item pass creates independent stocked inventory");
  pass("same name and SKU are not merged");
  pass("batch pass does not modify sales, refunds, paid amount, or allocated costs");

  const fifty = await createPendingOrder({ label: "fifty", itemCount: 50 });
  result = await postBatch(fifty.inspections.map((item) => item.id));
  assert(result.response.status === 200 && result.body?.processedCount === 50, "50-item batch did not succeed");
  assert((await inventoryIdsFor(fifty.inspections)).length === 50, "50-item batch did not create 50 independent inventory rows");
  pass("50-item boundary succeeds");

  const rollback = await createPendingOrder({ label: "rollback", itemCount: 2 });
  const singleComplete = await call(`/api/inspections/${rollback.inspections[1].id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result: "PASS" }),
  });
  assert(singleComplete.response.status === 200, "single completion fixture failed");
  result = await postBatch(rollback.inspections.map((item) => item.id));
  assert(result.response.status === 409, "mixed completed batch was not rejected");
  const rollbackInventory = await inventoryIdsFor(rollback.inspections);
  assert(rollbackInventory.length === 1 && rollbackInventory[0].inspectionId === rollback.inspections[1].id, "failed batch left partial inventory");
  pass("completed item rolls the full batch back without partial inventory");

  const wrongEntity = await createPendingOrder({ label: "wrong-entity", itemCount: 2 });
  result = await postBatch([wrongEntity.inspections[0].id, wrongEntity.order.items[1].id]);
  assert(result.response.status === 404 && result.body?.code === "INSPECTION_NOT_FOUND", "wrong entity ID was accepted");
  assert((await inventoryIdsFor(wrongEntity.inspections)).length === 0, "wrong entity failure left partial inventory");
  pass("wrong entity IDs fail the full batch without partial writes");

  otherOwnerId = `m2b-batch-owner-${randomUUID().slice(0, 12)}`;
  await db.user.create({ data: { id: otherOwnerId, name: `${runId}-other-owner` } });
  const otherOwner = await createPendingOrder({ ownerId: otherOwnerId, label: "cross-owner" });
  result = await postBatch([otherOwner.inspections[0].id]);
  assert(result.response.status === 404 && result.body?.code === "INSPECTION_NOT_FOUND", "cross-owner inspection was not opaque");
  assert((await inventoryIdsFor(otherOwner.inspections)).length === 0, "cross-owner request changed another owner data");
  pass("cross-owner batch is opaque and does not write");

  const mixedOwner = await createPendingOrder({ label: "mixed-owner" });
  result = await postBatch([mixedOwner.inspections[0].id, otherOwner.inspections[0].id]);
  assert(result.response.status === 404, "mixed-owner batch was not rejected");
  assert((await inventoryIdsFor(mixedOwner.inspections)).length === 0, "mixed-owner batch left partial inventory");
  pass("cross-owner validation rolls the full batch back");

  const concurrent = await createPendingOrder({ label: "concurrent" });
  const [first, second] = await Promise.all([
    postBatch([concurrent.inspections[0].id]),
    postBatch([concurrent.inspections[0].id]),
  ]);
  assert([first.response.status, second.response.status].filter((status) => status === 200).length === 1, "concurrent batch did not have exactly one winner");
  assert((await inventoryIdsFor(concurrent.inspections)).length === 1, "concurrent batch created duplicate inventory");
  pass("concurrent batch requests cannot create duplicate inventory");

  const mixedConcurrency = await createPendingOrder({ label: "batch-single-concurrent" });
  const [batchRequest, singleRequest] = await Promise.all([
    postBatch([mixedConcurrency.inspections[0].id]),
    call(`/api/inspections/${mixedConcurrency.inspections[0].id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: "PASS" }),
    }),
  ]);
  assert([batchRequest.response.status, singleRequest.response.status].filter((status) => status === 200).length === 1, "batch and single completion did not have exactly one winner");
  assert((await inventoryIdsFor(mixedConcurrency.inspections)).length === 1, "batch and single completion created duplicate inventory");
  pass("batch and single completion cannot create duplicate inventory");

  const noCurrent = await createPendingOrder({ label: "current-state" });
  await db.inspection.update({ where: { id: noCurrent.inspections[0].id }, data: { status: "PASSED" } });
  result = await postBatch([noCurrent.inspections[0].id]);
  assert(result.response.status === 409 && result.body?.code === "INSPECTION_NOT_PENDING", "non-pending inspection was accepted");
  pass("only current pending inspection rows are batch-eligible");

  const residualInventory = await db.inventoryItem.count({ where: { purchaseOrderItem: { purchaseOrderId: { in: orderIds } } } });
  assert(residualInventory > 0, "fixture assertions did not create expected isolated inventory before cleanup");
  pass("fixtures are isolated by exact purchase-order IDs for cleanup");

  console.log(JSON.stringify({ ok: true, checks: checks.length, checkNames: checks }, null, 2));
} finally {
  const cleanup = await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  const residual = await db.purchaseOrder.count({ where: { id: { in: orderIds } } });
  if (residual !== 0) throw new Error(`fixture cleanup failed: ${residual} purchase orders remain after deleting ${cleanup.count}`);
  if (otherOwnerId) {
    await db.user.delete({ where: { id: otherOwnerId } });
  }
  await db.$disconnect();
}
