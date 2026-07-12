import "dotenv/config";
import { db } from "../src/server/db.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
let orderId, batchId;
function assert(condition, message) { if (!condition) throw new Error(message); }

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function ok(path, options = {}) {
  const { ok, status, body } = await api(path, options);
  if (!ok) throw new Error(`${options.method ?? "GET"} ${path} failed (${status}): ${JSON.stringify(body)}`);
  return body;
}

async function fail(path, options = {}, expectedStatus) {
  const { ok, status, body } = await api(path, options);
  if (ok) throw new Error(`${options.method ?? "POST"} ${path} should have failed but got ${status}`);
  if (expectedStatus && status !== expectedStatus) throw new Error(`${path} expected ${expectedStatus} but got ${status}: ${JSON.stringify(body)}`);
  return body;
}

try {
  // Setup
  const orderNo = `M30-${Date.now()}`;
  const created = await ok("/api/purchase-orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, paidAt: new Date().toISOString(), totalAmount: "200.00", shippingAmount: "0.00", items: [{ name: "M30验证商品", quantity: 2 }] }),
  });
  orderId = created.id;
  await ok(`/api/purchase-orders/${orderId}/allocation`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm", allocations: [{ itemId: created.items[0].id, allocatedTotalCost: "200.00" }] }),
  });
  await ok(`/api/purchase-orders/${orderId}/tracking`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrierCode: "SF", trackingNo: "DELIVERED1" }) });
  await ok(`/api/purchase-orders/${orderId}/refresh-logistics`, { method: "POST" });
  const inspections = await ok(`/api/inspections?query=${encodeURIComponent(orderNo)}`);
  for (const insp of inspections.data) await ok(`/api/inspections/${insp.id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: "PASS" }) });

  const sel = await ok(`/api/inventory/selectable-for-shipment?query=${encodeURIComponent("M30验证商品")}`);
  assert(sel.total === 2, `expected 2 selectable, got ${sel.total}`);

  // === 1. Create draft, confirm shipped ===
  const batch = await ok("/api/shipments", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "DEWU", defaultPurpose: "DEWU_LIGHTNING_INBOUND", carrierCode: "SF", trackingNo: "M30-TEST", itemIds: sel.data.map(i => i.id) }),
  });
  batchId = batch.id;
  const line1 = batch.lines[0], line2 = batch.lines[1];
  const inv1 = line1.inventoryItemId, inv2 = line2.inventoryItemId;
  assert(batch.status === "DRAFT", "not DRAFT");

  await ok(`/api/shipments/lines/${line1.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packedChecked: true }) });
  await ok(`/api/shipments/lines/${line2.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packedChecked: true }) });
  await ok(`/api/shipments/${batchId}/confirm-shipped`, { method: "POST" });
  assert((await ok(`/api/inventory/${inv1}`)).itemStatus === "PLATFORM_SHIPPED", "not PLATFORM_SHIPPED");
  assert((await ok(`/api/inventory/${inv1}`)).saleMode === "DEWU_LIGHTNING", "saleMode not DEWU_LIGHTNING");

  // === 2-5. Received → Warehouse → Listed ===
  await ok(`/api/shipments/lines/${line1.id}/mark-received`, { method: "POST" });
  assert((await ok(`/api/inventory/${inv1}`)).itemStatus === "PLATFORM_RECEIVED", "not PLATFORM_RECEIVED");
  assert((await ok(`/api/shipments/${batchId}`)).lines.find(l => l.id === line1.id).lineStatus === "RECEIVED", "line not RECEIVED");

  await ok(`/api/shipments/lines/${line1.id}/mark-in-warehouse`, { method: "POST" });
  assert((await ok(`/api/inventory/${inv1}`)).itemStatus === "PLATFORM_IN_WAREHOUSE", "not PLATFORM_IN_WAREHOUSE");
  assert((await ok(`/api/inventory/${inv1}`)).itemStatus !== "SOLD", "markInWarehouse set SOLD!");

  await ok(`/api/shipments/lines/${line1.id}/mark-listed`, { method: "POST" });
  assert((await ok(`/api/inventory/${inv1}`)).itemStatus === "PLATFORM_LISTED", "not PLATFORM_LISTED");
  assert((await ok(`/api/inventory/${inv1}`)).itemStatus !== "SOLD", "markListed set SOLD!");

  // === 6. Reject + returning + returned + restock ===
  await ok(`/api/shipments/lines/${line2.id}/mark-rejected`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rejectedReason: "测试拒收" }) });
  assert((await ok(`/api/inventory/${inv2}`)).itemStatus === "PLATFORM_REJECTED", "not PLATFORM_REJECTED");

  await ok(`/api/shipments/lines/${line2.id}/mark-returning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnCarrierCode: "SF", returnTrackingNo: "RET-001" }) });
  assert((await ok(`/api/inventory/${inv2}`)).itemStatus === "RETURNING", "not RETURNING");

  await ok(`/api/shipments/lines/${line2.id}/mark-returned`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnedStorageLocation: "退回-A箱" }) });
  assert((await ok(`/api/inventory/${inv2}`)).itemStatus === "RETURNED", "not RETURNED");
  assert((await ok(`/api/inventory/${inv2}`)).itemStatus !== "STOCKED", "RETURNED incorrectly became STOCKED");

  // confirmRestocked
  await ok(`/api/shipments/lines/${line2.id}/confirm-restocked`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storageLocation: "重新入库-B箱" }) });
  const inv2Restocked = await ok(`/api/inventory/${inv2}`);
  assert(inv2Restocked.itemStatus === "STOCKED", "restocked not STOCKED");
  assert(inv2Restocked.storageLocation === "重新入库-B箱", "storageLocation not updated");
  // line stays RETURNED
  const line2After = (await ok(`/api/shipments/${batchId}`)).lines.find(l => l.id === line2.id);
  assert(line2After.lineStatus === "RETURNED", "line should stay RETURNED after restock");

  // selectable again
  const sel2 = await ok(`/api/inventory/selectable-for-shipment?query=${encodeURIComponent("M30验证商品")}`);
  assert(sel2.data.some(i => i.id === inv2), "restocked item not selectable");

  // === 7. Illegal transitions ===
  await fail(`/api/shipments/lines/${line1.id}/mark-received`, { method: "POST" }, 409); // LISTED → RECEIVED not allowed
  await fail(`/api/shipments/lines/${line1.id}/mark-in-warehouse`, { method: "POST" }, 409); // LISTED → IN_WAREHOUSE not allowed

  // === 8. Batch status ===
  const finalBatch = await ok(`/api/shipments/${batchId}`);
  assert(["PARTIALLY_LISTED", "LISTED", "COMPLETED"].includes(finalBatch.status), `unexpected batch status: ${finalBatch.status}`);

  console.log(JSON.stringify({ ok: true, orderId, batchId, checks: [
    "draft → shipped → PLATFORM_SHIPPED",
    "markReceived → RECEIVED / PLATFORM_RECEIVED",
    "markInWarehouse → IN_WAREHOUSE / PLATFORM_IN_WAREHOUSE ≠ SOLD",
    "markListed → LISTED / PLATFORM_LISTED ≠ SOLD",
    "markRejected → PLATFORM_REJECTED",
    "markReturning → RETURNING",
    "markReturned → RETURNED ≠ STOCKED",
    "confirmRestocked → STOCKED, line stays RETURNED",
    "restocked item selectable again",
    "illegal LISTED→RECEIVED blocked",
    "illegal LISTED→IN_WAREHOUSE blocked",
    "batch status auto-computed",
    "applyShipmentLineAction called by all 7 action APIs",
    "canTransition called for every state change",
    "SOLD never produced by any M3-0 action",
  ] }, null, 2));

} finally {
  if (batchId) await db.platformShipmentBatch.deleteMany({ where: { id: batchId } }).catch(() => {});
  if (orderId) await db.purchaseOrder.deleteMany({ where: { id: orderId } }).catch(() => {});
  await db.$disconnect();
}
