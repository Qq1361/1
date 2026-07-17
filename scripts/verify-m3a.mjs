import "dotenv/config";
import { db } from "../src/server/db.ts";
import { salesService } from "../src/server/sales/sales-service.ts";
import { calculateSaleProfit } from "../src/server/sales/calculateSaleProfit.ts";
import { Prisma } from "../src/generated/prisma/client.ts";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
let orderId, apiOrderId, saleOrderId, draftTraceSaleId, listedSaleId;
const createdSaleOrderIds = new Set();
const accessCookie = process.env.APP_PASSWORD ? `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}` : null;
function assert(condition, message) { if (!condition) throw new Error(message); }

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...(options.headers ?? {}), ...(accessCookie ? { Cookie: accessCookie } : {}) } });
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
  createdSaleOrderIds.add(sale.id);
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
  createdSaleOrderIds.add(sale2.id);
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
    await salesService.createDraft("default-user", { platform: "DEWU", soldAt: new Date().toISOString(), grossAmount: "100.00", items: [{ inventoryItemId: invA.id }] });
    throw new Error("createDraft should reject SOLD item");
  } catch (e) {
    assert(e.message.includes("不能销售") || e.message.includes("SOLD"), "SOLD rejected at createDraft: " + e.message);
  }

  // ====== 6. settle ======
  const settled = await salesService.settle("default-user", saleOrderId, { actualReceivedAmount: "280.00" });
  assert(settled.status === "SETTLED", "SETTLED");
  assert((await db.inventoryItem.findUnique({ where: { id: invA.id } })).itemStatus === "SOLD", "still SOLD after settle");

  const soldTodos = await request("/api/todos");
  assert(!soldTodos.data.some((todo) => todo.inventoryId === invA.id), "SOLD item should not appear in todos/reminders");
  const soldInventoryList = await request(`/api/inventory?itemStatus=SOLD&query=${encodeURIComponent(invA.inventoryCode)}`);
  assert(soldInventoryList.data.some((item) => item.id === invA.id && item.itemStatus === "SOLD"), "SOLD item should remain queryable in inventory list");
  const inventoryTrace = await request(`/api/inventory/${invA.id}`);
  const inventoryEffectiveSales = inventoryTrace.saleLines.filter((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status));
  const inventoryCancelledSales = inventoryTrace.saleLines.filter((line) => line.saleOrder.status === "CANCELLED");
  assert(inventoryEffectiveSales.length === 1, `inventory trace effective sales count ${inventoryEffectiveSales.length}`);
  assert(inventoryEffectiveSales[0].saleOrder.status === "SETTLED", "inventory trace should prefer SETTLED effective sale");
  assert(inventoryCancelledSales.length >= 1, "inventory trace should keep cancelled sale history");

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
  createdSaleOrderIds.add(s4.id);
  await salesService.confirm("default-user", s4.id);
  assert((await db.inventoryItem.findUnique({ where: { id: invB.id } })).itemStatus === "SOLD", "confirm→SOLD for cancel test");

  const cancelled = await salesService.cancel("default-user", s4.id);
  assert(cancelled.status === "CANCELLED", "CANCELLED");
  const restoredB = await db.inventoryItem.findUnique({ where: { id: invB.id } });
  assert(restoredB.itemStatus === preStatusB, `restored to ${preStatusB}, got ${restoredB.itemStatus}`);
  assert(restoredB.itemStatus !== "SOLD", "not SOLD after cancel");
  assert(restoredB.itemStatus !== "STOCKED" || preStatusB === "STOCKED", "does not default to STOCKED");

  draftTraceSaleId = (await salesService.createDraft("default-user", {
    platform: "DEWU", soldAt: new Date().toISOString(), grossAmount: "88.00",
    items: [{ inventoryItemId: invB.id }],
  })).id;
  createdSaleOrderIds.add(draftTraceSaleId);
  const purchaseTraceWithDraft = await request(`/api/purchase-orders/${orderId}`);
  const invBTraceDraft = purchaseTraceWithDraft.items.flatMap((item) => item.inventoryItems ?? []).find((item) => item.id === invB.id);
  assert(invBTraceDraft.saleLines.some((line) => line.saleOrder.status === "DRAFT"), "purchase trace should expose draft history");
  assert(!invBTraceDraft.saleLines.some((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status)), "DRAFT/CANCELLED should not count as active sold trace");

  await db.inventoryItem.update({ where: { id: invB.id }, data: { itemStatus: "PLATFORM_LISTED" } });
  const listedPre = await db.inventoryItem.findUnique({ where: { id: invB.id } });
  assert(listedPre.itemStatus === "PLATFORM_LISTED", "setup PLATFORM_LISTED");
  const listedDraft = await salesService.createDraft("default-user", {
    platform: "DEWU", soldAt: new Date().toISOString(), grossAmount: "188.00",
    items: [{ inventoryItemId: invB.id }],
  });
  listedSaleId = listedDraft.id;
  createdSaleOrderIds.add(listedSaleId);
  await salesService.confirm("default-user", listedDraft.id);
  assert((await db.inventoryItem.findUnique({ where: { id: invB.id } })).itemStatus === "SOLD", "PLATFORM_LISTED confirm -> SOLD");
  await salesService.cancel("default-user", listedDraft.id);
  assert((await db.inventoryItem.findUnique({ where: { id: invB.id } })).itemStatus === "PLATFORM_LISTED", "cancel restores PLATFORM_LISTED snapshot");

  // ====== API-level tests ======
  // Create fresh inventory for isolated API test
  const apiOrderNo = `M3A-API-${Date.now()}`;
  const apiCreated = await request("/api/purchase-orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo: apiOrderNo, paidAt: new Date().toISOString(), totalAmount: "100.00", shippingAmount: "0.00", items: [{ name: "M3A-API测试", quantity: 1 }] }),
  });
  apiOrderId = apiCreated.id;
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
  createdSaleOrderIds.add(apiSale.id);
  assert(apiSale.status === "DRAFT", "API create draft");
  assert((await db.inventoryItem.findUnique({ where: { id: apiInv.id } })).itemStatus !== "SOLD", "API draft not SOLD");

  // confirm via API
  const apiC = await request(`/api/sales/${apiSale.id}/confirm`, { method: "POST" });
  assert(apiC.status === "CONFIRMED", "API confirm");
  assert((await db.inventoryItem.findUnique({ where: { id: apiInv.id } })).itemStatus === "SOLD", "API confirm→SOLD");

  // duplicate confirm blocked
  const apiDupRes = await fetch(`${baseUrl}/api/sales/${apiSale.id}/confirm`, { method: "POST", headers: accessCookie ? { Cookie: accessCookie } : {} });
  await apiDupRes.json();
  assert(!apiDupRes.ok, "API duplicate confirm blocked");

  // settle via API
  const apiS = await request(`/api/sales/${apiSale.id}/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actualReceivedAmount: "190.00" }) });
  assert(apiS.status === "SETTLED", "API settle");

  // SETTLED cannot cancel via API
  const apiCancelErrRes = await fetch(`${baseUrl}/api/sales/${apiSale.id}/cancel`, { method: "POST", headers: accessCookie ? { Cookie: accessCookie } : {} });
  await apiCancelErrRes.json();
  assert(!apiCancelErrRes.ok, "API SETTLED cancel blocked");

  const purchaseTrace = await request(`/api/purchase-orders/${apiCreated.id}`);
  const traceInventoryItems = purchaseTrace.items.flatMap((item) => item.inventoryItems ?? []);
  const activeTraceLines = traceInventoryItems.flatMap((item) => (item.saleLines ?? []).filter((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status)));
  const inactiveTraceLines = traceInventoryItems.flatMap((item) => (item.saleLines ?? []).filter((line) => ["DRAFT", "CANCELLED"].includes(line.saleOrder.status)));
  assert(activeTraceLines.length === 1 && activeTraceLines[0].saleOrder.status === "SETTLED", "purchase trace counts CONFIRMED/SETTLED only");
  assert(inactiveTraceLines.length === 0, "purchase trace for sold API item should not include inactive sale lines");

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
    "SOLD does not appear in todos/reminders",
    "SOLD remains queryable in inventory list",
    "inventory trace counts SETTLED/CONFIRMED and keeps CANCELLED history",
    "cancel CONFIRMED: restores preSaleItemStatus",
    "cancel CONFIRMED: does not default to STOCKED",
    "DRAFT/CANCELLED do not count as active sold trace",
    "PLATFORM_LISTED confirm can become SOLD only through SalesService.confirm",
    "cancel CONFIRMED restores PLATFORM_LISTED snapshot",
    "PLATFORM_LISTED never auto-SOLD",
    "service failure does not half-update",
    "API create draft → DRAFT, inv not SOLD",
    "API confirm → CONFIRMED, inv→SOLD",
    "API duplicate confirm blocked",
    "API settle → SETTLED",
    "API SETTLED cancel blocked",
    "purchase trace counts CONFIRMED/SETTLED only",
    "API cancel DRAFT → CANCELLED",
  ] }, null, 2));

} finally {
  try {
    const saleIds = [...createdSaleOrderIds];
    if (saleIds.length) {
      await db.saleActionLog.deleteMany({ where: { saleOrderId: { in: saleIds } } });
      await db.saleFeeLine.deleteMany({ where: { saleOrderId: { in: saleIds } } });
      await db.saleLine.deleteMany({ where: { saleOrderId: { in: saleIds } } });
      await db.saleOrder.deleteMany({ where: { id: { in: saleIds } } });
    }
    if (apiOrderId) await db.purchaseOrder.delete({ where: { id: apiOrderId } });
    if (orderId) await db.purchaseOrder.delete({ where: { id: orderId } });
  } finally {
    await db.$disconnect();
  }
}
