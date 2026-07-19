import "dotenv/config";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createAccessToken, ACCESS_COOKIE_NAME } from "../src/lib/access-protection.ts";
import { db } from "../src/server/db.ts";
import { PurchaseOrderService } from "../src/server/services/purchase-order-service.ts";

const ownerId = "default-user";
const runId = `M5A3-${Date.now()}`;
const orderIds = [];
const attachmentIds = [];
let checks = 0;
let baseUrl = process.env.APP_BASE_URL ?? null;
let temporaryServer = null;
let accessCookie = null;
let otherOwnerId = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Cannot allocate verification port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startServer() {
  if (!process.env.APP_PASSWORD) throw new Error("APP_PASSWORD is required for HTTP verification");
  accessCookie = `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`;
  if (baseUrl) return;
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  temporaryServer = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), env: process.env, stdio: ["ignore", "ignore", "ignore"], windowsHide: true,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/access`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Temporary M5A3 HTTP server did not become ready");
}

async function stopServer() {
  if (!temporaryServer) return;
  temporaryServer.kill();
  temporaryServer = null;
}

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { ...(accessCookie ? { Cookie: accessCookie } : {}), ...(options.headers ?? {}) },
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) };
}

function json(pathname, method, body) {
  return api(pathname, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function input(suffix) {
  return {
    orderNo: `${runId}-${suffix}`,
    paidAt: "2026-07-20T00:00:00.000Z",
    sellerNickname: "M5A3 verification seller",
    totalAmount: "250.00",
    shippingAmount: "10.00",
    notes: "entry error removal verification",
    items: [{ name: `${runId} product 1`, skuText: "2C0", quantity: 1 }],
  };
}

async function createSignedOrder(suffix, count = 2) {
  const created = await json("/api/purchase-orders", "POST", input(suffix));
  assert(created.status === 201, `${suffix}: create purchase order`);
  const orderId = created.body.id;
  orderIds.push(orderId);
  if (count > 1) {
    const added = await json(`/api/purchases/${orderId}/items/batch`, "POST", {
      items: Array.from({ length: count - 1 }, (_, index) => ({
        name: `${runId} ${suffix} product ${index + 2}`, skuText: "2C0", referenceAmount: null, notes: null,
      })),
    });
    assert(added.status === 201 && added.body.items.length === count, `${suffix}: creates ${count} independent purchase items`);
  }
  await db.purchaseOrder.update({
    where: { id: orderId },
    data: { carrierCode: "YTO", trackingNo: `${runId}-${suffix}`, trackingNumberRecordedAt: new Date(), shippedAt: new Date(), logisticsStatus: "IN_TRANSIT" },
  });
  const delivered = await api(`/api/purchase-orders/${orderId}/manual-delivery`, { method: "POST" });
  assert(delivered.status === 200, `${suffix}: manual receipt creates pending inspections`);
  const order = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: { inspections: { orderBy: { sequence: "asc" } } },
      },
    },
  });
  assert(order.status === "PENDING_INSPECTION" && order.items.every((item) => item.inspections.length === 1), `${suffix}: one untouched pending inspection per item`);
  return order;
}

async function removeEntryError(orderId, itemId, body = { reason: "ACTUALLY_NOT_RECEIVED" }) {
  return json(`/api/purchases/${orderId}/items/${itemId}/remove-entry-error`, "POST", body);
}

try {
  await startServer();
  const soldBefore = await db.inventoryItem.findMany({ where: { ownerId, itemStatus: "SOLD" }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } });

  const twentyFive = await createSignedOrder("TWENTY-FIVE", 25);
  const target = twentyFive.items[24];
  const retainedIds = twentyFive.items.slice(0, 24).map((item) => item.id);
  const factsBefore = {
    paidAt: twentyFive.paidAt.getTime(), total: twentyFive.totalAmount.toFixed(2), shipping: twentyFive.shippingAmount.toFixed(2),
    deliveredAt: twentyFive.deliveredAt?.getTime(), manuallyReceivedAt: twentyFive.manuallyReceivedAt?.getTime(),
  };
  const removed = await removeEntryError(twentyFive.id, target.id, { reason: "ACTUALLY_NOT_RECEIVED", note: "25 items were entered; only 24 were received." });
  assert(removed.status === 200 && removed.body.items.length === 24, "25 to 24: entry-error removal succeeds");
  assert(await db.purchaseOrderItem.count({ where: { purchaseOrderId: twentyFive.id } }) === 24, "25 to 24: exactly one purchase item is removed");
  assert(await db.inspection.count({ where: { purchaseOrderItem: { purchaseOrderId: twentyFive.id } } }) === 24, "25 to 24: matching placeholder inspection is explicitly removed");
  assert((await db.purchaseOrderItem.count({ where: { id: { in: retainedIds } } })) === 24, "25 to 24: the remaining 24 items are unchanged");
  const twentyFiveAfter = await db.purchaseOrder.findUniqueOrThrow({ where: { id: twentyFive.id } });
  assert(JSON.stringify({ paidAt: twentyFiveAfter.paidAt.getTime(), total: twentyFiveAfter.totalAmount.toFixed(2), shipping: twentyFiveAfter.shippingAmount.toFixed(2), deliveredAt: twentyFiveAfter.deliveredAt?.getTime(), manuallyReceivedAt: twentyFiveAfter.manuallyReceivedAt?.getTime() }) === JSON.stringify(factsBefore), "entry-error removal leaves payment and receipt facts unchanged");
  const log = await db.purchaseOrderActionLog.findFirstOrThrow({ where: { purchaseOrderId: twentyFive.id, purchaseOrderItemId: target.id } });
  assert(log.actionType === "PURCHASE_ITEM_REMOVED_AS_ENTRY_ERROR" && log.reasonCode === "ACTUALLY_NOT_RECEIVED" && log.beforeItemCount === 25 && log.afterItemCount === 24 && log.productNameSnapshot === target.name && log.skuSnapshot === target.skuText, "entry-error audit log has snapshots and counts");
  const duplicate = await removeEntryError(twentyFive.id, target.id);
  assert(duplicate.status === 404 && duplicate.body.code === "PURCHASE_ITEM_NOT_FOUND", "repeated removal is rejected without a duplicate log");
  const strict = await removeEntryError(twentyFive.id, retainedIds[0], { reason: "DUPLICATE_ENTRY", ownerId: "forbidden" });
  assert(strict.status === 400, "entry-error API rejects ownership injection");

  const resultFixture = await createSignedOrder("RESULT");
  await db.inspection.update({ where: { id: resultFixture.items[1].inspections[0].id }, data: { status: "PASSED", result: "PASS", completedAt: new Date() } });
  const resultBlocked = await removeEntryError(resultFixture.id, resultFixture.items[1].id);
  assert(resultBlocked.status === 409 && resultBlocked.body.code === "PURCHASE_ITEM_ALREADY_INSPECTED", "inspection result blocks removal");
  assert(await db.purchaseOrderItem.count({ where: { purchaseOrderId: resultFixture.id } }) === 2 && await db.inspection.count({ where: { purchaseOrderItem: { purchaseOrderId: resultFixture.id } } }) === 2, "inspection-result rejection leaves items and inspections intact");

  const noteFixture = await createSignedOrder("NOTE-ATTACHMENT");
  await db.inspection.update({ where: { id: noteFixture.items[1].inspections[0].id }, data: { notes: "Manually recorded inspection fact" } });
  const noteBlocked = await removeEntryError(noteFixture.id, noteFixture.items[1].id);
  assert(noteBlocked.status === 409 && noteBlocked.body.code === "PURCHASE_ITEM_ALREADY_INSPECTED", "inspection notes block removal");
  const attachmentFixture = await createSignedOrder("ATTACHMENT");
  const attachment = await db.attachment.create({ data: { ownerId, entityType: "INSPECTION", entityId: attachmentFixture.items[1].inspections[0].id, fileName: "proof.jpg", mimeType: "image/jpeg", size: 1, storageKey: `${runId}/proof.jpg` } });
  attachmentIds.push(attachment.id);
  const attachmentBlocked = await removeEntryError(attachmentFixture.id, attachmentFixture.items[1].id);
  assert(attachmentBlocked.status === 409 && attachmentBlocked.body.code === "PURCHASE_ITEM_ALREADY_INSPECTED", "inspection attachments block removal");

  const inventoryFixture = await createSignedOrder("INVENTORY");
  const inventoryInspection = inventoryFixture.items[1].inspections[0];
  await db.inventoryItem.create({ data: { ownerId, purchaseOrderItemId: inventoryFixture.items[1].id, inspectionId: inventoryInspection.id, inventoryCode: `${runId}-inventory`, name: `${runId} inventory`, unitCost: "20.00", itemStatus: "STOCKED", stockedAt: new Date() } });
  const inventoryBlocked = await removeEntryError(inventoryFixture.id, inventoryFixture.items[1].id);
  assert(inventoryBlocked.status === 409 && inventoryBlocked.body.code === "PURCHASE_ITEM_INVENTORY_EXISTS", "inventory blocks removal without deleting inventory");

  const rollbackFixture = await createSignedOrder("LOG-ROLLBACK");
  const failingService = new PurchaseOrderService(async () => { throw new Error("intentional audit log write failure"); });
  await failingService.removePurchaseItemAsEntryError(ownerId, rollbackFixture.id, rollbackFixture.items[1].id, { reason: "OTHER", note: "rollback test" }).then(() => { throw new Error("expected audit log failure"); }).catch((error) => assert(error.message === "intentional audit log write failure", "audit log failure is surfaced"));
  assert(await db.purchaseOrderItem.count({ where: { purchaseOrderId: rollbackFixture.id } }) === 2 && await db.inspection.count({ where: { purchaseOrderItem: { purchaseOrderId: rollbackFixture.id } } }) === 2, "audit log write failure rolls back item and inspection removal");

  const concurrencyFixture = await createSignedOrder("CONCURRENCY");
  const [first, second] = await Promise.all(concurrencyFixture.items.map((item) => removeEntryError(concurrencyFixture.id, item.id)));
  const remaining = await db.purchaseOrderItem.count({ where: { purchaseOrderId: concurrencyFixture.id } });
  assert([first.status, second.status].filter((status) => status === 200).length === 1 && remaining === 1, "concurrent entry-error removals cannot delete the last item");

  otherOwnerId = `${runId}-other-owner`;
  await db.user.create({ data: { id: otherOwnerId, name: "M5A3 cross owner" } });
  const otherOrder = await db.purchaseOrder.create({ data: { ownerId: otherOwnerId, orderNo: `${runId}-OTHER`, paidAt: new Date(), totalAmount: "1.00", shippingAmount: "0.00", status: "PENDING_INSPECTION", manuallyReceivedAt: new Date(), deliveredAt: new Date(), items: { create: { name: "other item", quantity: 1 } } }, include: { items: true } });
  orderIds.push(otherOrder.id);
  const otherInspection = await db.inspection.create({ data: { ownerId: otherOwnerId, purchaseOrderItemId: otherOrder.items[0].id, sequence: 1, status: "PENDING" } });
  assert(Boolean(otherInspection.id), "cross-owner fixture has an inspection");
  const crossOwner = await removeEntryError(otherOrder.id, otherOrder.items[0].id);
  assert(crossOwner.status === 404 && crossOwner.body.code === "ORDER_NOT_FOUND", "entry-error removal rejects a different owner");
  const soldAfter = await db.inventoryItem.findMany({ where: { ownerId, itemStatus: "SOLD" }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } });
  assert(JSON.stringify(soldAfter) === JSON.stringify(soldBefore), "entry-error removal does not create or update SOLD inventory");
  console.log(`verify:m5a3-entry-error-removal passed: ${checks} checks`);
} finally {
  if (attachmentIds.length) await db.attachment.deleteMany({ where: { id: { in: attachmentIds } } });
  if (orderIds.length) {
    await db.purchaseOrderActionLog.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (otherOwnerId) await db.user.delete({ where: { id: otherOwnerId } });
  await stopServer();
}
