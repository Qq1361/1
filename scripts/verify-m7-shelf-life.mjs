import "dotenv/config";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";
import { db } from "../src/server/db.ts";

const ownerId = "default-user";
const runId = `M7-SHELF-LIFE-${Date.now()}-${randomUUID().slice(0, 8)}`;
const orderIds = [];
let checks = 0;
let port = null;
let server = null;
let baseUrl = process.env.APP_BASE_URL ?? null;
let cookie = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") return reject(new Error("Cannot allocate a temporary port"));
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startServer() {
  if (baseUrl) return;
  if (!process.env.APP_PASSWORD) throw new Error("APP_PASSWORD is required for HTTP verification");
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), env: process.env, stdio: "ignore", windowsHide: true,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/access`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!(await fetch(`${baseUrl}/access`)).ok) throw new Error("Temporary M7 server did not become ready");
}

async function stopServer() {
  if (!server) return;
  const pid = server.pid;
  server.kill();
  if (pid && process.platform === "win32") {
    const { execFileSync } = await import("node:child_process");
    try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
  }
  server = null;
  baseUrl = process.env.APP_BASE_URL ?? null;
}

async function api(pathname, method = "GET", body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) };
}

function orderInput(suffix, items) {
  return {
    orderNo: `${runId}-${suffix}`,
    paidAt: "2026-07-18T00:00:00.000Z",
    totalAmount: "100.00",
    shippingAmount: "0.00",
    items,
  };
}

try {
  await startServer();
  cookie = `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`;
  assert(Boolean(cookie), "access session is created for isolated HTTP verification");

  const created = await api("/api/purchase-orders", "POST", orderInput("CREATE", [
    { name: `${runId} 月末`, skuText: "2c0", quantity: 2, productionDate: "2025-01-31", shelfLifeMonths: 1, expiryDate: null },
    { name: `${runId} 手工日期`, skuText: "2c0", quantity: 1, productionDate: "2026-01-01", shelfLifeMonths: 12, expiryDate: "2026-12-31" },
  ]));
  assert(created.status === 201, "purchase order with shelf-life data is created");
  orderIds.push(created.body.id);
  const [calculated, manual] = created.body.items;
  assert(calculated.productionDate === "2025-01-31" && calculated.shelfLifeMonths === 1, "production date and month count serialize as date-only data");
  assert(calculated.expiryDate === "2025-02-28", "month-end calculation clamps to February end");
  assert(manual.expiryDate === "2026-12-31", "manual expiry date is preserved over the computed value");
  assert(created.body.totalAmount === "100.00" && created.body.shippingAmount === "0.00", "shelf-life data does not change order money");

  const preserved = await api(`/api/purchases/${created.body.id}/items/${manual.id}`, "PATCH", {
    name: manual.name, skuText: manual.skuText, quantity: 1, referenceAmount: "",
    productionDate: "2026-02-01", shelfLifeMonths: 24, expiryDate: "2026-12-31", notes: "",
  });
  assert(preserved.status === 200 && preserved.body.items[1].expiryDate === "2026-12-31", "editing source fields does not silently overwrite a manual expiry date");
  const recalculated = await api(`/api/purchases/${created.body.id}/items/${manual.id}`, "PATCH", {
    name: manual.name, skuText: manual.skuText, quantity: 1, referenceAmount: "",
    productionDate: "2024-02-29", shelfLifeMonths: 12, expiryDate: null, notes: "",
  });
  assert(recalculated.status === 200 && recalculated.body.items[1].expiryDate === "2025-02-28", "clearing expiry explicitly recalculates from production date and months");

  const single = await api(`/api/purchases/${created.body.id}/items`, "POST", {
    name: `${runId} 单条`, skuText: "1w1", quantity: 1, referenceAmount: "",
    productionDate: null, shelfLifeMonths: null, expiryDate: "2027-05-01", notes: "",
  });
  assert(single.status === 201 && single.body.items.at(-1).expiryDate === "2027-05-01", "single item add accepts a direct expiry date");
  assert(single.body.totalAmount === "100.00", "single item add does not change paid amount");

  const batch = await api(`/api/purchases/${created.body.id}/items/batch`, "POST", {
    items: [
      { name: `${runId} 同 SKU A`, skuText: "2C0", referenceAmount: null, productionDate: "2026-01-01", shelfLifeMonths: 12, expiryDate: null, notes: null },
      { name: `${runId} 同 SKU B`, skuText: "2C0", referenceAmount: null, productionDate: "2026-02-01", shelfLifeMonths: 12, expiryDate: null, notes: null },
    ],
  });
  assert(batch.status === 201, "batch add accepts independent shelf-life rows");
  const batchRows = batch.body.items.filter((item) => item.name.includes("同 SKU"));
  assert(batchRows.length === 2 && new Set(batchRows.map((item) => item.expiryDate)).size === 2, "same SKU rows retain different expiry dates without merging");

  for (const [field, value] of [["productionDate", "2026-02-30"], ["expiryDate", "2026-01-01T00:00:00Z"], ["shelfLifeMonths", 1.5], ["shelfLifeMonths", 0]]) {
    const invalid = await api(`/api/purchases/${created.body.id}/items`, "POST", {
      name: `${runId} invalid`, skuText: "X", quantity: 1, referenceAmount: "",
      productionDate: null, shelfLifeMonths: null, expiryDate: null, notes: "", [field]: value,
    });
    assert(invalid.status === 400, `${field} invalid input is rejected`);
  }
  const invalidOrder = await api(`/api/purchases/${created.body.id}/items`, "POST", {
    name: `${runId} invalid order`, skuText: "X", quantity: 1, referenceAmount: "",
    productionDate: "2026-02-02", shelfLifeMonths: null, expiryDate: "2026-02-01", notes: "",
  });
  assert(invalidOrder.status === 400 && invalidOrder.body.code === "SHELF_LIFE_DATE_ORDER_INVALID", "expiry before production is rejected with a stable error");
  const unknown = await api(`/api/purchases/${created.body.id}/items`, "POST", {
    name: `${runId} unknown`, skuText: "X", quantity: 1, referenceAmount: "", inventoryExpiryDate: "2026-01-01",
  });
  assert(unknown.status === 400, "strict DTO rejects inventory snapshot fields from the browser");

  const snapshotOrder = await db.purchaseOrder.create({
    data: {
      ownerId, orderNo: `${runId}-SNAPSHOT`, paidAt: new Date(), totalAmount: "20.00", shippingAmount: "0.00",
      status: "PENDING_INSPECTION", allocationStatus: "CONFIRMED", allocationConfirmedAt: new Date(),
      items: { create: [
        { name: `${runId} 快照 A`, skuText: "2C0", quantity: 1, allocatedTotalCost: "10.00", productionDate: new Date("2026-01-31T00:00:00.000Z"), shelfLifeMonths: 12, expiryDate: new Date("2027-01-31T00:00:00.000Z") },
        { name: `${runId} 快照 B`, skuText: "2C0", quantity: 1, allocatedTotalCost: "10.00", productionDate: new Date("2026-02-01T00:00:00.000Z"), shelfLifeMonths: 12, expiryDate: new Date("2027-02-01T00:00:00.000Z") },
      ] },
    }, include: { items: true },
  });
  orderIds.push(snapshotOrder.id);
  const inspections = await Promise.all(snapshotOrder.items.map((item) => db.inspection.create({ data: { ownerId, purchaseOrderItemId: item.id, sequence: 1 } })));
  const completed = await api(`/api/inspections/${inspections[0].id}/complete`, "POST", { result: "PASS" });
  assert(completed.status === 200, "single inspection completion succeeds with shelf-life source data");
  assert(completed.body.inventory.productionDate === "2026-01-31" && completed.body.inventory.expiryDate === "2027-01-31", "single completion copies purchase shelf-life snapshot without recalculation");
  const batchPass = await api("/api/inspections/batch-pass", "POST", { inspectionIds: [inspections[1].id] });
  assert(batchPass.status === 200, "batch inspection completion succeeds with shelf-life source data");
  const inventory = await db.inventoryItem.findMany({ where: { purchaseOrderItemId: { in: snapshotOrder.items.map((item) => item.id) } }, orderBy: { purchaseOrderItemId: "asc" } });
  assert(inventory.length === 2 && new Set(inventory.map((item) => item.expiryDate?.toISOString().slice(0, 10))).size === 2, "single and batch inspections create independent inventory snapshots");
  assert(inventory.every((item) => item.itemStatus === "STOCKED"), "shelf-life snapshot does not alter inspection pass status");
  const lockedUpdate = await api(`/api/purchases/${snapshotOrder.id}/items/${snapshotOrder.items[0].id}`, "PATCH", {
    name: snapshotOrder.items[0].name, skuText: "2C0", quantity: 1, referenceAmount: "",
    productionDate: "2026-02-01", shelfLifeMonths: 24, expiryDate: null, notes: "",
  });
  assert(lockedUpdate.status === 409 && lockedUpdate.body.code === "PURCHASE_ITEM_EDIT_LOCKED", "downstream inspection and inventory facts lock shelf-life edits");
  const inventoryApi = await api(`/api/inventory/${inventory[0].id}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(inventoryApi.body.expiryDate) && !inventoryApi.body.expiryDate.includes("T"), "inventory API serializes shelf-life dates as YYYY-MM-DD");

  const staticFiles = await Promise.all([
    readFile("src/server/services/inspection-service.ts", "utf8"),
    readFile("src/server/services/purchase-order-service.ts", "utf8"),
    readFile("prisma/schema.prisma", "utf8"),
  ]);
  assert(staticFiles[0].includes("productionDate: inspection.purchaseOrderItem.productionDate") && staticFiles[0].includes("shelfLifeMonths: inspection.purchaseOrderItem.shelfLifeMonths"), "inspection core copies shelf-life snapshots from purchase items");
  assert(!staticFiles[0].includes('itemStatus: "SOLD"'), "shelf-life implementation does not add a SOLD write");
  assert(staticFiles[2].includes("productionDate     DateTime? @db.Date") && staticFiles[2].includes("shelfLifeMonths    Int?"), "schema uses nullable PostgreSQL DATE shelf-life fields");
  console.log(`verify:m7-shelf-life passed: ${checks} checks`);
} finally {
  if (orderIds.length) {
    const cleanup = await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
    const residual = await db.purchaseOrder.count({ where: { id: { in: orderIds } } });
    if (residual !== 0 || cleanup.count !== orderIds.length) throw new Error(`fixture cleanup failed: ${residual} orders remain`);
  }
  await stopServer();
  await db.$disconnect();
}
