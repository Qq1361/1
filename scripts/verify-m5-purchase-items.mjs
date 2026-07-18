import "dotenv/config";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createAccessToken, ACCESS_COOKIE_NAME } from "../src/lib/access-protection.ts";
import { db } from "../src/server/db.ts";

let baseUrl = process.env.APP_BASE_URL ?? null;
const ownerId = "default-user";
const runId = `M5-PURCHASE-ITEMS-${Date.now()}`;
const orderIds = [];
const refundRecordIds = [];
let otherOwnerId = null;
let checks = 0;
let temporaryServer = null;
let temporaryPort = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

let accessCookie = process.env.APP_PASSWORD
  ? `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`
  : null;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate verification port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/access`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Temporary M5 HTTP server did not become ready");
}

async function startTemporaryServer() {
  if (baseUrl) return;
  if (!process.env.APP_PASSWORD) throw new Error("APP_PASSWORD is required for HTTP verification");
  temporaryPort = await findFreePort();
  baseUrl = `http://127.0.0.1:${temporaryPort}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  temporaryServer = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(temporaryPort)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  await waitForReady();
  accessCookie = `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`;
}

async function stopTemporaryServer() {
  if (!temporaryServer) return;
  const pid = temporaryServer.pid;
  temporaryServer.kill();
  if (pid && process.platform === "win32") {
    const { execFileSync } = await import("node:child_process");
    try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
  }
  temporaryServer = null;
  baseUrl = process.env.APP_BASE_URL ?? null;
  accessCookie = process.env.APP_PASSWORD
    ? `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`
    : null;
}

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(accessCookie ? { Cookie: accessCookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body };
}

async function apiJson(pathname, method, body) {
  return api(pathname, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function orderInput(suffix, itemName = `${runId} 商品`) {
  return {
    orderNo: `${runId}-${suffix}`,
    paidAt: "2026-07-17T00:00:00.000Z",
    sellerNickname: "M5 验证卖家",
    totalAmount: "100.00",
    shippingAmount: "5.00",
    notes: "M5 verification fixture",
    items: [{ name: itemName, skuText: "2c0", quantity: 1, referenceAmount: "120.50", notes: "初始明细" }],
  };
}

async function createTwoItemOrder(suffix) {
  const created = await apiJson("/api/purchase-orders", "POST", orderInput(suffix));
  assert(created.status === 201, `${suffix} fixture can be created`);
  const orderId = created.body.id;
  orderIds.push(orderId);
  const added = await apiJson(`/api/purchases/${orderId}/items`, "POST", {
    name: `${runId} ${suffix} 第二件`, skuText: "2c0", quantity: 1, referenceAmount: "20.00", notes: "delete fixture",
  });
  assert(added.status === 201 && added.body.items.length === 2, `${suffix} fixture has two purchase items`);
  return { orderId, firstItem: added.body.items[0], secondItem: added.body.items[1] };
}

try {
  await startTemporaryServer();
  assert(Boolean(accessCookie), "APP_PASSWORD session is available");
  const dailyDeliveryBefore = await db.dailyBusinessReportDelivery.findMany({
    where: { ownerId },
    select: { id: true, status: true, attemptCount: true, updatedAt: true, sentAt: true, failedAt: true },
    orderBy: { id: "asc" },
  });
  const soldInventoryBefore = await db.inventoryItem.findMany({
    where: { ownerId, itemStatus: "SOLD" },
    select: { id: true, itemStatus: true, updatedAt: true },
    orderBy: { id: "asc" },
  });
  const created = await apiJson("/api/purchase-orders", "POST", orderInput("CRUD"));
  assert(created.status === 201, `paid unallocated order can be created (${created.status}: ${JSON.stringify(created.body)})`);
  const orderId = created.body.id;
  orderIds.push(orderId);
  const firstItem = created.body.items[0];
  const createdDetail = await api(`/api/purchase-orders/${orderId}`);
  assert(firstItem.referenceAmount === "120.50", `reference amount is returned as a two-decimal string (${JSON.stringify(firstItem)})`);
  assert(created.body.totalAmount === "100.00" && created.body.shippingAmount === "5.00", "reference amount does not change order money");
  assert(created.body.items.length === 1, "fixture starts with one purchase item");
  assert(createdDetail.status === 200 && createdDetail.body.purchaseItemsEditability.editable === true, "paid unallocated order is editable");

  const added = await apiJson(`/api/purchases/${orderId}/items`, "POST", {
    name: `${runId} 商品二`, skuText: "1w1", quantity: "2", referenceAmount: "80", notes: "新增明细",
  });
  assert(added.status === 201 && added.body.items.length === 2, "adding a purchase item succeeds");
  assert(added.body.items[1].referenceAmount === "80.00", "added reference amount is persisted safely");
  assert(added.body.totalAmount === "100.00" && added.body.shippingAmount === "5.00", "adding item preserves order money");
  const afterAddInventoryCount = await db.inventoryItem.count({ where: { purchaseOrderItem: { purchaseOrderId: orderId } } });
  assert(afterAddInventoryCount === 0, "adding a purchase item does not create inventory");
  const afterAddDetail = await api(`/api/purchase-orders/${orderId}`);
  assert(afterAddDetail.body.purchaseAfterSalesSummary.totalPurchaseRefundedAmount === "0.00" && afterAddDetail.body.purchaseAfterSalesSummary.netPurchasePaidAmount === "105.00", "adding an item leaves purchase refunds and net paid amount unchanged");

  const secondItem = added.body.items[1];
  const edited = await apiJson(`/api/purchases/${orderId}/items/${secondItem.id}`, "PATCH", {
    name: `${runId} 商品二已编辑`, skuText: "1w1-new", quantity: 3, referenceAmount: "81.25", notes: "编辑明细",
  });
  assert(edited.status === 200, "editing a purchase item succeeds");
  assert(edited.body.items[1].name === `${runId} 商品二已编辑`, "editing name persists without losing Chinese text");
  assert(edited.body.items[1].skuText === "1W1-NEW", "editing SKU uses existing normalization");
  assert(edited.body.items[1].quantity === 3, "editing quantity persists");
  assert(edited.body.items[1].referenceAmount === "81.25", "editing reference amount persists");
  assert(edited.body.items[1].notes === "编辑明细", "editing notes persists");
  assert(edited.body.totalAmount === "100.00", "editing item does not change original paid amount");

  const deleted = await api(`/api/purchases/${orderId}/items/${secondItem.id}`, { method: "DELETE" });
  assert(deleted.status === 200 && deleted.body.items.length === 1, "deleting a normal item succeeds");
  const deleteLast = await api(`/api/purchases/${orderId}/items/${firstItem.id}`, { method: "DELETE" });
  assert(deleteLast.status === 409 && deleteLast.body.code === "PURCHASE_ORDER_REQUIRES_ITEM", "last purchase item cannot be deleted");
  const afterDeleteDetail = await api(`/api/purchase-orders/${orderId}`);
  assert(afterDeleteDetail.body.totalAmount === "100.00" && afterDeleteDetail.body.shippingAmount === "5.00" && afterDeleteDetail.body.purchaseAfterSalesSummary.netPurchasePaidAmount === "105.00", "deleting a temporary item leaves order money, refunds and net paid amount unchanged");

  const logisticsDeleteFixture = await createTwoItemOrder("DELETE-LOGISTICS");
  await db.purchaseOrder.update({
    where: { id: logisticsDeleteFixture.orderId },
    data: {
      carrierCode: "YTO",
      trackingNo: `${runId}-TRACKING`,
      trackingNumberRecordedAt: new Date(),
      shippedAt: new Date(),
      logisticsStatus: "IN_TRANSIT",
    },
  });
  const logisticsDelete = await api(`/api/purchases/${logisticsDeleteFixture.orderId}/items/${logisticsDeleteFixture.secondItem.id}`, { method: "DELETE" });
  assert(logisticsDelete.status === 200 && logisticsDelete.body.items.length === 1, "tracking fields and logistics reminder timestamps do not lock item deletion");

  const unrelatedInspectionFixture = await createTwoItemOrder("DELETE-UNRELATED-INSPECTION");
  await db.inspection.create({
    data: { ownerId, purchaseOrderItemId: unrelatedInspectionFixture.firstItem.id, sequence: 1, status: "PENDING" },
  });
  const unrelatedDetail = await api(`/api/purchase-orders/${unrelatedInspectionFixture.orderId}`);
  assert(unrelatedDetail.status === 200 && unrelatedDetail.body.purchaseItemsEditability.editable === false, "generic item maintenance remains locked when another item has inspection facts");
  assert(unrelatedDetail.body.purchaseItemsDeleteability[unrelatedInspectionFixture.firstItem.id].deletable === false, "inspected item is marked non-deletable");
  assert(unrelatedDetail.body.purchaseItemsDeleteability[unrelatedInspectionFixture.secondItem.id].deletable === true, "unrelated item remains deletable");
  const unrelatedDelete = await api(`/api/purchases/${unrelatedInspectionFixture.orderId}/items/${unrelatedInspectionFixture.secondItem.id}`, { method: "DELETE" });
  assert(unrelatedDelete.status === 200 && unrelatedDelete.body.items.length === 1, "service deletes an unlocked item even when another item has downstream facts");

  const allocationDraftFixture = await createTwoItemOrder("DELETE-ALLOCATION-DRAFT");
  await db.purchaseOrder.update({ where: { id: allocationDraftFixture.orderId }, data: { allocationStatus: "DRAFT" } });
  const allocationDraftDelete = await api(`/api/purchases/${allocationDraftFixture.orderId}/items/${allocationDraftFixture.secondItem.id}`, { method: "DELETE" });
  assert(allocationDraftDelete.status === 409 && allocationDraftDelete.body.code === "PURCHASE_ITEM_DOWNSTREAM_LOCKED", "allocation draft locks item deletion");

  const allocationConfirmedFixture = await createTwoItemOrder("DELETE-ALLOCATION-CONFIRMED");
  await db.purchaseOrder.update({ where: { id: allocationConfirmedFixture.orderId }, data: { allocationStatus: "CONFIRMED", allocationConfirmedAt: new Date() } });
  const allocationConfirmedDelete = await api(`/api/purchases/${allocationConfirmedFixture.orderId}/items/${allocationConfirmedFixture.secondItem.id}`, { method: "DELETE" });
  assert(allocationConfirmedDelete.status === 409 && allocationConfirmedDelete.body.code === "PURCHASE_ITEM_DOWNSTREAM_LOCKED", "confirmed allocation locks item deletion");

  const inventoryDeleteFixture = await createTwoItemOrder("DELETE-INVENTORY");
  const inventoryInspection = await db.inspection.create({
    data: { ownerId, purchaseOrderItemId: inventoryDeleteFixture.firstItem.id, sequence: 1, status: "PASSED", result: "PASS", completedAt: new Date() },
  });
  await db.inventoryItem.create({
    data: {
      ownerId,
      purchaseOrderItemId: inventoryDeleteFixture.firstItem.id,
      inspectionId: inventoryInspection.id,
      inventoryCode: `${runId}-DELETE-LOCK-INV`,
      name: `${runId} inventory lock`,
      unitCost: "20.00",
      itemStatus: "STOCKED",
      stockedAt: new Date(),
    },
  });
  const inventoryDelete = await api(`/api/purchases/${inventoryDeleteFixture.orderId}/items/${inventoryDeleteFixture.firstItem.id}`, { method: "DELETE" });
  assert(inventoryDelete.status === 409 && inventoryDelete.body.code === "PURCHASE_ITEM_DOWNSTREAM_LOCKED", "inventory facts lock their own purchase item deletion");

  const concurrencyFixture = await createTwoItemOrder("DELETE-CONCURRENCY");
  const [concurrentFirst, concurrentSecond] = await Promise.all([
    api(`/api/purchases/${concurrencyFixture.orderId}/items/${concurrencyFixture.firstItem.id}`, { method: "DELETE" }),
    api(`/api/purchases/${concurrencyFixture.orderId}/items/${concurrencyFixture.secondItem.id}`, { method: "DELETE" }),
  ]);
  const concurrencyRemaining = await db.purchaseOrderItem.count({ where: { purchaseOrderId: concurrencyFixture.orderId } });
  assert([concurrentFirst.status, concurrentSecond.status].filter((status) => status === 200).length === 1 && concurrencyRemaining === 1, "concurrent deletes cannot leave an empty purchase order");
  const repeatedDelete = await api(`/api/purchases/${concurrencyFixture.orderId}/items/${concurrentFirst.status === 200 ? concurrencyFixture.firstItem.id : concurrencyFixture.secondItem.id}`, { method: "DELETE" });
  assert(repeatedDelete.status === 404 && repeatedDelete.body.code === "PURCHASE_ITEM_NOT_FOUND", "repeating a successful delete returns a stable not-found result");

  const batchDailyBefore = await db.dailyBusinessReportDelivery.findMany({ where: { ownerId }, select: { id: true, status: true, attemptCount: true, updatedAt: true, sentAt: true, failedAt: true }, orderBy: { id: "asc" } });
  const batchInventoryBefore = await db.inventoryItem.count({ where: { ownerId } });
  const batchInspectionBefore = await db.inspection.count({ where: { ownerId } });
  const batchSoldBefore = await db.inventoryItem.findMany({ where: { ownerId, itemStatus: "SOLD" }, select: { id: true, itemStatus: true, updatedAt: true }, orderBy: { id: "asc" } });

  const sameBatchOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("BATCH-SAME"));
  assert(sameBatchOrderResponse.status === 201, "batch fixture for duplicate products can be created");
  const sameBatchOrderId = sameBatchOrderResponse.body.id;
  orderIds.push(sameBatchOrderId);
  const sameExistingIds = new Set(sameBatchOrderResponse.body.items.map((item) => item.id));
  const sameBatchResponse = await apiJson(`/api/purchases/${sameBatchOrderId}/items/batch`, "POST", {
    items: [
      { name: `${runId} 同款商品`, skuText: "2c0", referenceAmount: "625.00", notes: "无盒" },
      { name: `${runId} 同款商品`, skuText: "2c0", referenceAmount: "625.00", notes: "无盒" },
    ],
  });
  const sameBatchItems = sameBatchResponse.body?.items?.filter((item) => !sameExistingIds.has(item.id)) ?? [];
  assert(sameBatchResponse.status === 201 && sameBatchItems.length === 2, "batch API creates two duplicate product rows in one request");
  assert(sameBatchItems[0].id !== sameBatchItems[1].id, "duplicate batch rows have different ids");
  assert(sameBatchItems.every((item) => item.quantity === 1), "duplicate batch rows each have quantity one");
  assert(!sameBatchItems.some((item) => item.quantity === 2), "batch API does not collapse duplicate rows into quantity two");
  assert(sameBatchResponse.body.items.length === 3, "batch API returns the complete refreshed order DTO");
  assert(sameBatchItems.every((item) => item.skuText === "2C0" && item.referenceAmount === "625.00"), "batch rows normalize SKU and preserve reference amount");
  const sameBatchDetail = await api(`/api/purchase-orders/${sameBatchOrderId}`);
  const sameBatchDetailItems = sameBatchDetail.body.items.filter((item) => !sameExistingIds.has(item.id));
  assert(sameBatchDetail.status === 200 && sameBatchDetailItems.length === 2 && sameBatchDetailItems.every((item) => item.quantity === 1), "batch detail refresh keeps two independent duplicate rows");
  assert(sameBatchDetail.body.totalAmount === "100.00" && sameBatchDetail.body.shippingAmount === "5.00", "batch creation leaves order money unchanged");

  const fiveBatchOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("BATCH-FIVE"));
  assert(fiveBatchOrderResponse.status === 201, "five-row batch fixture can be created");
  const fiveBatchOrderId = fiveBatchOrderResponse.body.id;
  orderIds.push(fiveBatchOrderId);
  const fiveExistingIds = new Set(fiveBatchOrderResponse.body.items.map((item) => item.id));
  const fiveBatchResponse = await apiJson(`/api/purchases/${fiveBatchOrderId}/items/batch`, "POST", {
    items: Array.from({ length: 5 }, () => ({ name: `${runId} 五件商品`, skuText: "1w1", referenceAmount: null, notes: null })),
  });
  const fiveBatchItems = fiveBatchResponse.body?.items?.filter((item) => !fiveExistingIds.has(item.id)) ?? [];
  assert(fiveBatchResponse.status === 201 && fiveBatchItems.length === 5, "batch API creates five independent rows in one request");
  assert(new Set(fiveBatchItems.map((item) => item.id)).size === 5 && fiveBatchItems.every((item) => item.quantity === 1), "five-row batch has unique ids and quantity one");
  assert(fiveBatchItems.every((item) => item.referenceAmount === null), "batch rows preserve null reference amounts");

  const mixedBatchOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("BATCH-MIXED"));
  assert(mixedBatchOrderResponse.status === 201, "mixed-product batch fixture can be created");
  const mixedBatchOrderId = mixedBatchOrderResponse.body.id;
  orderIds.push(mixedBatchOrderId);
  const mixedExistingIds = new Set(mixedBatchOrderResponse.body.items.map((item) => item.id));
  const mixedBatchResponse = await apiJson(`/api/purchases/${mixedBatchOrderId}/items/batch`, "POST", {
    items: [
      { name: `${runId} DW 粉底液`, skuText: "2c0", referenceAmount: "625.00", notes: "正常中文" },
      { name: `${runId} DW 粉底液`, skuText: "1w1", referenceAmount: "625.00", notes: "正常中文" },
      { name: `${runId} 小棕瓶`, skuText: "30ml", referenceAmount: null, notes: "正常中文" },
    ],
  });
  const mixedBatchItems = mixedBatchResponse.body?.items?.filter((item) => !mixedExistingIds.has(item.id)) ?? [];
  assert(mixedBatchResponse.status === 201 && mixedBatchItems.length === 3, "three different products save in one batch");
  assert(mixedBatchItems.map((item) => item.skuText).join(",") === "2C0,1W1,30ML", "mixed batch normalizes each SKU independently");
  assert(mixedBatchItems.every((item) => item.notes === "正常中文"), "mixed batch preserves normal Chinese notes");

  const beforeRollbackCount = await db.purchaseOrderItem.count({ where: { purchaseOrderId: mixedBatchOrderId } });
  const failedBatch = await apiJson(`/api/purchases/${mixedBatchOrderId}/items/batch`, "POST", {
    items: [
      { name: `${runId} 回滚一`, skuText: "A", referenceAmount: "10.00", notes: null },
      { name: `${runId} 回滚二`, skuText: "B", referenceAmount: "1.001", notes: null },
      { name: `${runId} 回滚三`, skuText: "C", referenceAmount: "10.00", notes: null },
    ],
  });
  const afterRollbackCount = await db.purchaseOrderItem.count({ where: { purchaseOrderId: mixedBatchOrderId } });
  assert(failedBatch.status === 400 && afterRollbackCount === beforeRollbackCount, "invalid batch row rejects the whole batch without partial writes");

  for (const amount of ["-1", "1.001", "1e3", "NaN", "Infinity"]) {
    const invalidAmount = await apiJson(`/api/purchases/${sameBatchOrderId}/items/batch`, "POST", {
      items: [{ name: `${runId} invalid`, skuText: "X", referenceAmount: amount, notes: null }],
    });
    assert(invalidAmount.status === 400, `batch rejects invalid reference amount ${amount}`);
  }
  for (const field of ["ownerId", "purchaseOrderId", "quantity", "unitCost", "allocatedTotalCost", "inventoryStatus", "SOLD"]) {
    const invalidField = await apiJson(`/api/purchases/${sameBatchOrderId}/items/batch`, "POST", {
      items: [{ name: `${runId} forbidden`, skuText: "X", referenceAmount: null, notes: null, [field]: field === "quantity" ? 2 : "forbidden" }],
    });
    assert(invalidField.status === 400, `batch rejects forbidden field ${field}`);
  }
  const emptyBatch = await apiJson(`/api/purchases/${sameBatchOrderId}/items/batch`, "POST", { items: [] });
  assert(emptyBatch.status === 400, "batch rejects empty items");
  const oversizedBatch = await apiJson(`/api/purchases/${sameBatchOrderId}/items/batch`, "POST", { items: Array.from({ length: 51 }, () => ({ name: `${runId} too many`, skuText: "X", referenceAmount: null, notes: null })) });
  assert(oversizedBatch.status === 400, "batch rejects more than fifty rows");

  const batchDailyAfter = await db.dailyBusinessReportDelivery.findMany({ where: { ownerId }, select: { id: true, status: true, attemptCount: true, updatedAt: true, sentAt: true, failedAt: true }, orderBy: { id: "asc" } });
  const batchInventoryAfter = await db.inventoryItem.count({ where: { ownerId } });
  const batchInspectionAfter = await db.inspection.count({ where: { ownerId } });
  const batchSoldAfter = await db.inventoryItem.findMany({ where: { ownerId, itemStatus: "SOLD" }, select: { id: true, itemStatus: true, updatedAt: true }, orderBy: { id: "asc" } });
  assert(JSON.stringify(batchDailyAfter) === JSON.stringify(batchDailyBefore), "batch maintenance leaves DailyBusinessReportDelivery unchanged");
  assert(batchInventoryAfter === batchInventoryBefore && batchInspectionAfter === batchInspectionBefore, "batch maintenance does not create inventory or inspections");
  assert(JSON.stringify(batchSoldAfter) === JSON.stringify(batchSoldBefore), "batch maintenance does not create or update SOLD inventory");

  const detailSource = await readFile("src/components/purchases/order-detail.tsx", "utf8");
  const batchRouteSource = await readFile("src/app/api/purchases/[purchaseOrderId]/items/batch/route.ts", "utf8");
  assert(detailSource.includes("批量添加商品"), "purchase detail has an independent batch entry");
  assert(detailSource.includes("复制此行") && detailSource.includes("复制第一行多件"), "batch dialog supports row and multi-copy actions");
  assert(detailSource.includes("数量固定为 1"), "batch dialog explains quantity is fixed at one");
  assert(detailSource.includes("/items/batch") && !detailSource.includes("Promise.all"), "page submits one batch request instead of looping single-item APIs");
  assert(batchRouteSource.includes("purchaseItemBatchSchema") && batchRouteSource.includes("addPurchaseItemsBatch"), "batch route uses strict schema and batch service");

  for (const unknownField of ["ownerId", "unitCost", "allocatedCost", "inventoryStatus"]) {
    const invalid = await apiJson(`/api/purchases/${orderId}/items`, "POST", {
      name: `${runId} invalid`, skuText: "X", quantity: 1, referenceAmount: "1.00", [unknownField]: "forbidden",
    });
    assert(invalid.status === 400, `${unknownField} is rejected by strict input validation`);
  }
  for (const amount of ["-1", "1.001", "1e3", "NaN", "Infinity"]) {
    const invalid = await apiJson(`/api/purchases/${orderId}/items`, "POST", {
      name: `${runId} invalid amount`, skuText: "X", quantity: 1, referenceAmount: amount,
    });
    assert(invalid.status === 400, `invalid reference amount ${amount} is rejected`);
  }
  const wrongItem = await apiJson(`/api/purchases/${orderId}/items/c${"0".repeat(24)}`, "PATCH", {
    name: "不存在", skuText: "X", quantity: 1, referenceAmount: "1.00",
  });
  assert([400, 404].includes(wrongItem.status), "invalid item id cannot update an item");
  const beforeFailedAdd = await db.purchaseOrderItem.count({ where: { purchaseOrderId: orderId } });
  const failedAdd = await apiJson(`/api/purchases/${orderId}/items`, "POST", {
    name: "不应写入", quantity: 1, referenceAmount: "1.001",
  });
  const afterFailedAdd = await db.purchaseOrderItem.count({ where: { purchaseOrderId: orderId } });
  assert(failedAdd.status === 400 && afterFailedAdd === beforeFailedAdd, "validation failure leaves purchase item rows unchanged without a partial write");

  const lockOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("LOCK"));
  assert(lockOrderResponse.status === 201, "lock fixture can be created");
  const lockOrderId = lockOrderResponse.body.id;
  orderIds.push(lockOrderId);
  await db.purchaseOrder.update({ where: { id: lockOrderId }, data: { allocationStatus: "DRAFT" } });
  const locked = await apiJson(`/api/purchases/${lockOrderId}/items`, "POST", { name: "锁定新增", quantity: 1, referenceAmount: "1.00" });
  assert(locked.status === 409 && locked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "allocation draft locks item maintenance");
  const lockedBatch = await apiJson(`/api/purchases/${lockOrderId}/items/batch`, "POST", { items: [{ name: "锁定批量", skuText: "X", referenceAmount: null, notes: null }] });
  assert(lockedBatch.status === 409 && lockedBatch.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "allocation draft locks batch item maintenance");
  const lockedDetail = await api(`/api/purchase-orders/${lockOrderId}`);
  assert(lockedDetail.status === 200 && lockedDetail.body.purchaseItemsEditability.editable === false, "detail DTO exposes lock state");
  assert(lockedDetail.body.purchaseItemsEditability.reason, "detail DTO exposes a human-readable lock reason");

  const confirmedAllocationResponse = await apiJson("/api/purchase-orders", "POST", orderInput("CONFIRMED-ALLOCATION"));
  assert(confirmedAllocationResponse.status === 201, "confirmed allocation lock fixture can be created");
  const confirmedAllocationOrderId = confirmedAllocationResponse.body.id;
  orderIds.push(confirmedAllocationOrderId);
  await db.purchaseOrder.update({ where: { id: confirmedAllocationOrderId }, data: { allocationStatus: "CONFIRMED", allocationConfirmedAt: new Date() } });
  const confirmedAllocationLocked = await apiJson(`/api/purchases/${confirmedAllocationOrderId}/items`, "POST", { name: "不应新增", quantity: 1, referenceAmount: "1.00" });
  assert(confirmedAllocationLocked.status === 409 && confirmedAllocationLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "confirmed allocation locks item maintenance");
  const confirmedAllocationBatchLocked = await apiJson(`/api/purchases/${confirmedAllocationOrderId}/items/batch`, "POST", { items: [{ name: "确认分摊批量", skuText: "X", referenceAmount: null, notes: null }] });
  assert(confirmedAllocationBatchLocked.status === 409 && confirmedAllocationBatchLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "confirmed allocation locks batch item maintenance");

  const inspectionOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("INSPECTION"));
  assert(inspectionOrderResponse.status === 201, "inspection lock fixture can be created");
  const inspectionOrderId = inspectionOrderResponse.body.id;
  orderIds.push(inspectionOrderId);
  await db.inspection.create({ data: { ownerId, purchaseOrderItemId: inspectionOrderResponse.body.items[0].id, sequence: 1, status: "PENDING" } });
  const inspectionLocked = await apiJson(`/api/purchases/${inspectionOrderId}/items`, "POST", { name: "不应新增", quantity: 1, referenceAmount: "1.00" });
  assert(inspectionLocked.status === 409 && inspectionLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "started inspection locks item maintenance even before inventory exists");
  const inspectionBatchLocked = await apiJson(`/api/purchases/${inspectionOrderId}/items/batch`, "POST", { items: [{ name: "验货批量", skuText: "X", referenceAmount: null, notes: null }] });
  assert(inspectionBatchLocked.status === 409 && inspectionBatchLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "started inspection locks batch item maintenance");

  const inventoryOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("INVENTORY"));
  assert(inventoryOrderResponse.status === 201, "inventory lock fixture can be created");
  const inventoryOrderId = inventoryOrderResponse.body.id;
  orderIds.push(inventoryOrderId);
  const inventoryItemId = `inventory-${runId}`;
  const inspection = await db.inspection.create({ data: { ownerId, purchaseOrderItemId: inventoryOrderResponse.body.items[0].id, sequence: 1, status: "PENDING" } });
  await db.inventoryItem.create({ data: { id: inventoryItemId, ownerId, purchaseOrderItemId: inventoryOrderResponse.body.items[0].id, inspectionId: inspection.id, inventoryCode: `${runId}-INV`, name: `${runId} 库存`, unitCost: "100.00", itemStatus: "STOCKED", stockedAt: new Date() } });
  const inventoryLocked = await apiJson(`/api/purchases/${inventoryOrderId}/items`, "POST", { name: "不应新增", quantity: 1, referenceAmount: "1.00" });
  assert(inventoryLocked.status === 409, "generated inventory locks item maintenance");
  const inventoryBatchLocked = await apiJson(`/api/purchases/${inventoryOrderId}/items/batch`, "POST", { items: [{ name: "库存批量", skuText: "X", referenceAmount: null, notes: null }] });
  assert(inventoryBatchLocked.status === 409, "generated inventory locks batch item maintenance");

  const afterSaleOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("AFTER-SALE"));
  assert(afterSaleOrderResponse.status === 201, "after-sale lock fixture can be created");
  const afterSaleOrderId = afterSaleOrderResponse.body.id;
  orderIds.push(afterSaleOrderId);
  await db.purchaseAfterSaleCase.create({ data: { ownerId, caseNo: `${runId}-CASE`, purchaseOrderId: afterSaleOrderId, type: "REFUND_ONLY", status: "DRAFT" } });
  const afterSaleLocked = await apiJson(`/api/purchases/${afterSaleOrderId}/items`, "POST", { name: "不应新增", quantity: 1, referenceAmount: "1.00" });
  assert(afterSaleLocked.status === 409 && afterSaleLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "purchase after-sale locks item maintenance");
  const afterSaleBatchLocked = await apiJson(`/api/purchases/${afterSaleOrderId}/items/batch`, "POST", { items: [{ name: "售后批量", skuText: "X", referenceAmount: null, notes: null }] });
  assert(afterSaleBatchLocked.status === 409 && afterSaleBatchLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "purchase after-sale locks batch item maintenance");

  const refundOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("REFUND"));
  assert(refundOrderResponse.status === 201, "purchase refund lock fixture can be created");
  const refundOrderId = refundOrderResponse.body.id;
  orderIds.push(refundOrderId);
  const refundCase = await db.purchaseAfterSaleCase.create({ data: { ownerId, caseNo: `${runId}-REFUND-CASE`, purchaseOrderId: refundOrderId, type: "REFUND_ONLY", status: "REFUNDED" } });
  const refundRecord = await db.purchaseRefundRecord.create({ data: { ownerId, afterSaleCaseId: refundCase.id, purchaseOrderId: refundOrderId, refundAmount: "10.00", refundedAt: new Date(), idempotencyKey: `${runId}-REFUND`, note: "M5 fixture" } });
  refundRecordIds.push(refundRecord.id);
  const refundLocked = await apiJson(`/api/purchases/${refundOrderId}/items`, "POST", { name: "不应新增", quantity: 1, referenceAmount: "1.00" });
  assert(refundLocked.status === 409 && refundLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "purchase refund record locks item maintenance");
  const refundBatchLocked = await apiJson(`/api/purchases/${refundOrderId}/items/batch`, "POST", { items: [{ name: "退款批量", skuText: "X", referenceAmount: null, notes: null }] });
  assert(refundBatchLocked.status === 409 && refundBatchLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "purchase refund record locks batch item maintenance");

  otherOwnerId = `${runId}-OTHER-OWNER`;
  await db.user.create({ data: { id: otherOwnerId, name: "M5 Cross Owner" } });
  const otherOwnerOrder = await db.purchaseOrder.create({ data: { ownerId: otherOwnerId, orderNo: `${runId}-OTHER`, paidAt: new Date(), totalAmount: "1.00", shippingAmount: "0.00", items: { create: { name: "隔离商品", quantity: 1 } } } });
  orderIds.push(otherOwnerOrder.id);
  const crossOwner = await apiJson(`/api/purchases/${otherOwnerOrder.id}/items`, "POST", { name: "不应访问", quantity: 1, referenceAmount: "1.00" });
  assert(crossOwner.status === 404 && crossOwner.body.code === "ORDER_NOT_FOUND", "item maintenance does not expose another owner's purchase order");
  const crossOwnerBatch = await apiJson(`/api/purchases/${otherOwnerOrder.id}/items/batch`, "POST", { items: [{ name: "跨 owner 批量", skuText: "X", referenceAmount: null, notes: null }] });
  assert(crossOwnerBatch.status === 404 && crossOwnerBatch.body.code === "ORDER_NOT_FOUND", "batch item maintenance does not expose another owner's purchase order");
  const otherOwnerItem = await db.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: otherOwnerOrder.id }, select: { id: true } });
  const crossOwnerDelete = await api(`/api/purchases/${otherOwnerOrder.id}/items/${otherOwnerItem.id}`, { method: "DELETE" });
  assert(crossOwnerDelete.status === 404 && crossOwnerDelete.body.code === "ORDER_NOT_FOUND", "delete does not expose another owner's purchase order");

  const dailyDeliveryAfter = await db.dailyBusinessReportDelivery.findMany({
    where: { ownerId },
    select: { id: true, status: true, attemptCount: true, updatedAt: true, sentAt: true, failedAt: true },
    orderBy: { id: "asc" },
  });
  const soldInventoryAfter = await db.inventoryItem.findMany({
    where: { ownerId, itemStatus: "SOLD" },
    select: { id: true, itemStatus: true, updatedAt: true },
    orderBy: { id: "asc" },
  });
  assert(JSON.stringify(dailyDeliveryAfter) === JSON.stringify(dailyDeliveryBefore), "purchase item maintenance leaves DailyBusinessReportDelivery records unchanged");
  assert(JSON.stringify(soldInventoryAfter) === JSON.stringify(soldInventoryBefore), "purchase item maintenance does not create or update SOLD inventory");

  const staticSchema = await import("node:fs/promises").then((fs) => fs.readFile("prisma/schema.prisma", "utf8"));
  assert(staticSchema.includes("referenceAmount    Decimal?"), "schema contains the optional reference amount");
  assert(!staticSchema.includes("itemStatus: SOLD"), "verification script does not introduce SOLD writes");
  console.log(`verify:m5-purchase-items passed: ${checks} checks`);
} finally {
  if (refundRecordIds.length) {
    await db.purchaseRefundRecord.deleteMany({ where: { id: { in: refundRecordIds } } });
  }
  for (const id of orderIds) {
    await db.purchaseAfterSaleCase.deleteMany({ where: { purchaseOrderId: id } });
  }
  const cleanup = await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  if (otherOwnerId) await db.user.delete({ where: { id: otherOwnerId } });
  await stopTemporaryServer();
  if (cleanup.count !== orderIds.length) throw new Error(`fixture cleanup mismatch: expected ${orderIds.length}, deleted ${cleanup.count}`);
}
