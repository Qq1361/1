import "dotenv/config";
import { spawn } from "node:child_process";
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

  const inspectionOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("INSPECTION"));
  assert(inspectionOrderResponse.status === 201, "inspection lock fixture can be created");
  const inspectionOrderId = inspectionOrderResponse.body.id;
  orderIds.push(inspectionOrderId);
  await db.inspection.create({ data: { ownerId, purchaseOrderItemId: inspectionOrderResponse.body.items[0].id, sequence: 1, status: "PENDING" } });
  const inspectionLocked = await apiJson(`/api/purchases/${inspectionOrderId}/items`, "POST", { name: "不应新增", quantity: 1, referenceAmount: "1.00" });
  assert(inspectionLocked.status === 409 && inspectionLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "started inspection locks item maintenance even before inventory exists");

  const inventoryOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("INVENTORY"));
  assert(inventoryOrderResponse.status === 201, "inventory lock fixture can be created");
  const inventoryOrderId = inventoryOrderResponse.body.id;
  orderIds.push(inventoryOrderId);
  const inventoryItemId = `inventory-${runId}`;
  const inspection = await db.inspection.create({ data: { ownerId, purchaseOrderItemId: inventoryOrderResponse.body.items[0].id, sequence: 1, status: "PENDING" } });
  await db.inventoryItem.create({ data: { id: inventoryItemId, ownerId, purchaseOrderItemId: inventoryOrderResponse.body.items[0].id, inspectionId: inspection.id, inventoryCode: `${runId}-INV`, name: `${runId} 库存`, unitCost: "100.00", itemStatus: "STOCKED", stockedAt: new Date() } });
  const inventoryLocked = await apiJson(`/api/purchases/${inventoryOrderId}/items`, "POST", { name: "不应新增", quantity: 1, referenceAmount: "1.00" });
  assert(inventoryLocked.status === 409, "generated inventory locks item maintenance");

  const afterSaleOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("AFTER-SALE"));
  assert(afterSaleOrderResponse.status === 201, "after-sale lock fixture can be created");
  const afterSaleOrderId = afterSaleOrderResponse.body.id;
  orderIds.push(afterSaleOrderId);
  await db.purchaseAfterSaleCase.create({ data: { ownerId, caseNo: `${runId}-CASE`, purchaseOrderId: afterSaleOrderId, type: "REFUND_ONLY", status: "DRAFT" } });
  const afterSaleLocked = await apiJson(`/api/purchases/${afterSaleOrderId}/items`, "POST", { name: "不应新增", quantity: 1, referenceAmount: "1.00" });
  assert(afterSaleLocked.status === 409 && afterSaleLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "purchase after-sale locks item maintenance");

  const refundOrderResponse = await apiJson("/api/purchase-orders", "POST", orderInput("REFUND"));
  assert(refundOrderResponse.status === 201, "purchase refund lock fixture can be created");
  const refundOrderId = refundOrderResponse.body.id;
  orderIds.push(refundOrderId);
  const refundCase = await db.purchaseAfterSaleCase.create({ data: { ownerId, caseNo: `${runId}-REFUND-CASE`, purchaseOrderId: refundOrderId, type: "REFUND_ONLY", status: "REFUNDED" } });
  const refundRecord = await db.purchaseRefundRecord.create({ data: { ownerId, afterSaleCaseId: refundCase.id, purchaseOrderId: refundOrderId, refundAmount: "10.00", refundedAt: new Date(), idempotencyKey: `${runId}-REFUND`, note: "M5 fixture" } });
  refundRecordIds.push(refundRecord.id);
  const refundLocked = await apiJson(`/api/purchases/${refundOrderId}/items`, "POST", { name: "不应新增", quantity: 1, referenceAmount: "1.00" });
  assert(refundLocked.status === 409 && refundLocked.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "purchase refund record locks item maintenance");

  otherOwnerId = `${runId}-OTHER-OWNER`;
  await db.user.create({ data: { id: otherOwnerId, name: "M5 Cross Owner" } });
  const otherOwnerOrder = await db.purchaseOrder.create({ data: { ownerId: otherOwnerId, orderNo: `${runId}-OTHER`, paidAt: new Date(), totalAmount: "1.00", shippingAmount: "0.00", items: { create: { name: "隔离商品", quantity: 1 } } } });
  orderIds.push(otherOwnerOrder.id);
  const crossOwner = await apiJson(`/api/purchases/${otherOwnerOrder.id}/items`, "POST", { name: "不应访问", quantity: 1, referenceAmount: "1.00" });
  assert(crossOwner.status === 404 && crossOwner.body.code === "ORDER_NOT_FOUND", "item maintenance does not expose another owner's purchase order");

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
