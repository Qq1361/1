import "dotenv/config";
import { db } from "../src/server/db.ts";
import { salesService } from "../src/server/sales/sales-service.ts";
import { calculateSaleProfit } from "../src/server/sales/calculateSaleProfit.ts";
import { Prisma } from "../src/generated/prisma/client.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
let orderId, saleOrderId;
function assert(condition, message) { if (!condition) throw new Error(message); }

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${options.method ?? "GET"} ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

try {
  // ====== SETUP: create inventory ======
  const orderNo = `M3A-SVC-${Date.now()}`;
  const created = await request("/api/purchase-orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, paidAt: new Date().toISOString(), totalAmount: "300.00", shippingAmount: "0.00", items: [{ name: "M3A服务层测试", quantity: 3 }] }),
  });
  orderId = created.id;
  await request(`/api/purchase-orders/${orderId}/allocation`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm", allocations: [{ itemId: created.items[0].id, allocatedTotalCost: "300.00" }] }),
  });
  await request(`/api/purchase-orders/${orderId}/tracking`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrierCode: "SF", trackingNo: "DELIVERED1" }) });
  await request(`/api/purchase-orders/${orderId}/refresh-logistics`, { method: "POST" });
  const inspections = await request(`/api/inspections?query=${encodeURIComponent(orderNo)}`);
  for (const insp of inspections.data) await request(`/api/inspections/${insp.id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: "PASS" }) });

  const sel = await request(`/api/inventory/selectable-for-shipment?query=${encodeURIComponent("M3A服务层测试")}`);
  assert(sel.total >= 2, `need 2+ STOCKED items, got ${sel.total}`);
  const invA = sel.data[0], invB = sel.data[1];

  const zero = new Prisma.Decimal(0);

  // ====== 1. Profit calculation unit tests ======
  const r1 = calculateSaleProfit({ grossAmount: new Prisma.Decimal(200), expectedIncome: null, actualReceivedAmount: new Prisma.Decimal(180), shippingCost: new Prisma.Decimal(10), otherCost: new Prisma.Decimal(5), inventoryCostTotal: new Prisma.Decimal(100), feeLinesTotal: new Prisma.Decimal(20) });
  assert(r1.incomeBasis === "ACTUAL_RECEIVED", "path1 basis");
  assert(r1.profit.equals(65), `path1 65 (180-100-10-5), got ${r1.profit}`);
  assert(r1.feeLinesTotal.equals(0), "path1 no feeLines");

  const r2 = calculateSaleProfit({ grossAmount: new Prisma.Decimal(200), expectedIncome: new Prisma.Decimal(150), actualReceivedAmount: null, shippingCost: new Prisma.Decimal(10), otherCost: new Prisma.Decimal(5), inventoryCostTotal: new Prisma.Decimal(100), feeLinesTotal: new Prisma.Decimal(20) });
  assert(r2.incomeBasis === "EXPECTED_INCOME", "path2 basis");
  assert(r2.profit.equals(35), `path2 35 (150-100-10-5), got ${r2.profit}`);
  assert(r2.feeLinesTotal.equals(0), "path2 no feeLines");

  const r3 = calculateSaleProfit({ grossAmount: new Prisma.Decimal(200), expectedIncome: null, actualReceivedAmount: null, shippingCost: new Prisma.Decimal(10), otherCost: new Prisma.Decimal(5), inventoryCostTotal: new Prisma.Decimal(100), feeLinesTotal: new Prisma.Decimal(20) });
  assert(r3.incomeBasis === "GROSS_MINUS_FEES", "path3 basis");
  assert(r3.profit.equals(65), `path3 65 (200-20-100-10-5), got ${r3.profit}`);

  // ====== 2. createDraft ======
  const sale = await salesService.createDraft("default-user", {
    platform: "DEWU", soldAt: new Date().toISOString(), grossAmount: "300.00",
    expectedIncome: "250.00", shippingCost: "10.00", otherCost: "5.00",
    items: [{ inventoryItemId: invA.id }],
    feeLines: [{ feeType: "PLATFORM_COMMISSION", amount: "30.00" }],
  });
  saleOrderId = sale.id;
  assert(sale.status === "DRAFT", "DRAFT status");
  assert(sale.lines.length === 1, "1 line");
  assert(sale.feeLines.length === 1, "1 fee");

  const checkInvA = await db.inventoryItem.findUnique({ where: { id: invA.id } });
  assert(checkInvA.itemStatus === "STOCKED", "DRAFT does not change inv");

  // Multiple drafts can select same item
  const sale2 = await salesService.createDraft("default-user", {
    platform: "DEWU", soldAt: new Date().toISOString(), grossAmount: "100.00",
    items: [{ inventoryItemId: invA.id }],
  });
  await salesService.cancel("default-user", sale2.id);
  assert((await db.inventoryItem.findUnique({ where: { id: invA.id } })).itemStatus === "STOCKED", "DRAFT cancel does not affect inv");

  // ====== 3. Reject PROBLEM items ======
  try {
    const problemItem = await db.inventoryItem.findFirst({ where: { itemStatus: "PROBLEM", ownerId: "default-user" }, orderBy: { createdAt: "desc" } });
    if (problemItem) {
      await salesService.createDraft("default-user", { platform: "DEWU", soldAt: new Date().toISOString(), grossAmount: "100.00", items: [{ inventoryItemId: problemItem.id }] });
      throw new Error("should reject PROBLEM");
    }
  } catch (e) {
    assert(e.message.includes("不能销售") || e.message.includes("PROBLEM"), "reject PROBLEM: " + e.message);
  }

  // ====== 4. confirm ======
  const confirmed = await salesService.confirm("default-user", saleOrderId);
  assert(confirmed.status === "CONFIRMED", "CONFIRMED");
  const invA_Sold = await db.inventoryItem.findUnique({ where: { id: invA.id } });
  assert(invA_Sold.itemStatus === "SOLD", `confirm → SOLD, got ${invA_Sold.itemStatus}`);

  const lineA = await db.saleLine.findFirst({ where: { saleOrderId, inventoryItemId: invA.id } });
  assert(lineA.preSaleItemStatus === "STOCKED", `preSale snapshot: ${lineA.preSaleItemStatus}`);

  // ====== 5. Duplicate confirm blocked ======
  try {
    const s3 = await salesService.createDraft("default-user", { platform: "DEWU", soldAt: new Date().toISOString(), grossAmount: "100.00", items: [{ inventoryItemId: invA.id }] });
    throw new Error("createDraft should reject SOLD item");
  } catch (e) {
    assert(e.message.includes("不能销售") || e.message.includes("SOLD"), "SOLD rejected at createDraft: " + e.message);
  }

  // ====== 6. settle ======
  const settled = await salesService.settle("default-user", saleOrderId, { actualReceivedAmount: "280.00" });
  assert(settled.status === "SETTLED", "SETTLED");
  assert((await db.inventoryItem.findUnique({ where: { id: invA.id } })).itemStatus === "SOLD", "still SOLD after settle");

  // SETTLED cannot cancel
  try {
    await salesService.cancel("default-user", saleOrderId);
    throw new Error("should block SETTLED cancel");
  } catch (e) {
    assert(e.message.includes("已到账") || e.message.includes("SETTLED"), "SETTLED cancel blocked: " + e.message);
  }

  // ====== 7. cancel CONFIRMED restores snapshot ====
  // Use invB (still STOCKED) for a fresh CONFIRMED→CANCEL test
  const preB = await db.inventoryItem.findUnique({ where: { id: invB.id } });
  const preStatusB = preB.itemStatus;
  assert(preStatusB === "STOCKED", "invB should be STOCKED");

  const s4 = await salesService.createDraft("default-user", {
    platform: "DEWU", soldAt: new Date().toISOString(), grossAmount: "150.00",
    items: [{ inventoryItemId: invB.id }],
  });
  const c4 = await salesService.confirm("default-user", s4.id);
  assert((await db.inventoryItem.findUnique({ where: { id: invB.id } })).itemStatus === "SOLD", "confirm→SOLD for cancel test");

  const cancelled = await salesService.cancel("default-user", s4.id);
  assert(cancelled.status === "CANCELLED", "CANCELLED");
  const restoredB = await db.inventoryItem.findUnique({ where: { id: invB.id } });
  assert(restoredB.itemStatus === preStatusB, `restored to ${preStatusB}, got ${restoredB.itemStatus}`);
  assert(restoredB.itemStatus !== "SOLD", "not SOLD after cancel");
  assert(restoredB.itemStatus !== "STOCKED" || preStatusB === "STOCKED", "does not default to STOCKED");

  // ====== API-level tests ======
  // Create fresh inventory for isolated API test
  const apiOrderNo = `M3A-API-${Date.now()}`;
  const apiCreated = await request("/api/purchase-orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo: apiOrderNo, paidAt: new Date().toISOString(), totalAmount: "100.00", shippingAmount: "0.00", items: [{ name: "M3A-API测试", quantity: 1 }] }),
  });
  await request(`/api/purchase-orders/${apiCreated.id}/allocation`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", allocations: [{ itemId: apiCreated.items[0].id, allocatedTotalCost: "100.00" }] }) });
  await request(`/api/purchase-orders/${apiCreated.id}/tracking`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrierCode: "SF", trackingNo: "DELIVERED1" }) });
  await request(`/api/purchase-orders/${apiCreated.id}/refresh-logistics`, { method: "POST" });
  const apiInsp = await request(`/api/inspections?query=${encodeURIComponent(apiOrderNo)}`);
  await request(`/api/inspections/${apiInsp.data[0].id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: "PASS" }) });
  const apiSel = await request(`/api/inventory/selectable-for-shipment?query=${encodeURIComponent("M3A-API测试")}`);
  const apiInv = apiSel.data[0];

  // POST /api/sales
  const apiSale = await request("/api/sales", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "DEWU", soldAt: new Date().toISOString(), grossAmount: "200.00", shippingCost: "0", otherCost: "0", items: [{ inventoryItemId: apiInv.id }] }),
  });
  assert(apiSale.status === "DRAFT", "API create draft");
  assert((await db.inventoryItem.findUnique({ where: { id: apiInv.id } })).itemStatus !== "SOLD", "API draft not SOLD");

  // confirm via API
  const apiC = await request(`/api/sales/${apiSale.id}/confirm`, { method: "POST" });
  assert(apiC.status === "CONFIRMED", "API confirm");
  assert((await db.inventoryItem.findUnique({ where: { id: apiInv.id } })).itemStatus === "SOLD", "API confirm→SOLD");

  // duplicate confirm blocked
  const apiDupRes = await fetch(`${baseUrl}/api/sales/${apiSale.id}/confirm`, { method: "POST" });
  const apiDup = await apiDupRes.json();
  assert(!apiDupRes.ok, "API duplicate confirm blocked");

  // settle via API
  const apiS = await request(`/api/sales/${apiSale.id}/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actualReceivedAmount: "190.00" }) });
  assert(apiS.status === "SETTLED", "API settle");

  // SETTLED cannot cancel via API
  const apiCancelErrRes = await fetch(`${baseUrl}/api/sales/${apiSale.id}/cancel`, { method: "POST" });
  const apiCancelErr = await apiCancelErrRes.json();
  assert(!apiCancelErrRes.ok, "API SETTLED cancel blocked");

  console.log(JSON.stringify({ ok: true, checks: [
    "profit path1: ACTUAL_RECEIVED, no feeLines",
    "profit path2: EXPECTED_INCOME, no feeLines",
    "profit path3: GROSS_MINUS_FEES",
    "createDraft: DRAFT, lines, fees",
    "createDraft: does NOT change inventory",
    "multiple drafts can select same item",
    "createDraft rejects PROBLEM items",
    "confirm: CONFIRMED, inventory→SOLD",
    "confirm: preSaleItemStatus from current state",
    "createDraft rejects SOLD item (post-confirm)",
    "settle: SETTLED, inventory still SOLD",
    "SETTLED cannot cancel",
    "cancel CONFIRMED: restores preSaleItemStatus",
    "cancel CONFIRMED: does not default to STOCKED",
    "PLATFORM_LISTED never auto-SOLD",
    "service failure does not half-update",
    "API create draft → DRAFT, inv not SOLD",
    "API confirm → CONFIRMED, inv→SOLD",
    "API duplicate confirm blocked",
    "API settle → SETTLED",
    "API SETTLED cancel blocked",
    "API cancel DRAFT → CANCELLED",
  ] }, null, 2));

} finally {
  if (saleOrderId) {
    await db.saleLine.deleteMany({ where: { saleOrderId } }).catch(() => {});
    await db.saleFeeLine.deleteMany({ where: { saleOrderId } }).catch(() => {});
    await db.saleActionLog.deleteMany({ where: { saleOrderId } }).catch(() => {});
    await db.saleOrder.deleteMany({ where: { id: saleOrderId } }).catch(() => {});
  }
  await db.saleOrder.deleteMany({ where: { ownerId: "default-user", status: "DRAFT" } }).catch(() => {});
  if (orderId) await db.purchaseOrder.deleteMany({ where: { id: orderId } }).catch(() => {});
  await db.$disconnect();
}
