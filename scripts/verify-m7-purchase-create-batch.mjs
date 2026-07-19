import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";
import { db } from "../src/server/db.ts";

const ownerId = "default-user";
const runId = `M7-BATCH-CREATE-${Date.now()}-${randomUUID().slice(0, 8)}`;
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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        return reject(new Error("Cannot allocate a temporary verification port"));
      }
      listener.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function startServer() {
  if (baseUrl) return;
  if (!process.env.APP_PASSWORD) {
    throw new Error("APP_PASSWORD is required for isolated HTTP verification");
  }
  port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/access`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Temporary M7 batch verification server did not become ready");
}

async function stopServer() {
  if (!server) return;
  const pid = server.pid;
  server.kill();
  if (pid && process.platform === "win32") {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {}
  }
  server = null;
  baseUrl = process.env.APP_BASE_URL ?? null;
}

async function api(pathname, method = "GET", body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json().catch(() => null),
  };
}

function baseOrder(suffix) {
  return {
    orderNo: `${runId}-${suffix}`,
    sellerNickname: "M7 批量录入验证卖家",
    paidAt: "2026-07-19T00:00:00.000Z",
    totalAmount: "1000.00",
    shippingAmount: "10.00",
    notes: "M7 batch purchase creation fixture",
  };
}

function batchRow(index, overrides = {}) {
  return {
    name: `${runId} 商品 ${index}`,
    skuText: index % 2 ? "2c0" : "1w1",
    referenceAmount: `${100 + index}.50`,
    productionDate: "2026-01-31",
    shelfLifeMonths: 12,
    expiryDate: null,
    notes: null,
    ...overrides,
  };
}

async function countFixtureOrders() {
  return db.purchaseOrder.count({ where: { ownerId, orderNo: { startsWith: runId } } });
}

try {
  await startServer();
  cookie = `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`;
  assert(Boolean(cookie), "an isolated access session is available");

  const dailyDeliveryBefore = await db.dailyBusinessReportDelivery.findMany({
    where: { ownerId },
    select: { id: true, status: true, attemptCount: true, sentAt: true, failedAt: true, updatedAt: true },
    orderBy: { id: "asc" },
  });
  const soldBefore = await db.inventoryItem.findMany({
    where: { ownerId, itemStatus: "SOLD" },
    select: { id: true, itemStatus: true, updatedAt: true },
    orderBy: { id: "asc" },
  });

  const single = await api("/api/purchase-orders", "POST", {
    ...baseOrder("SINGLE"),
    items: [
      {
        name: `${runId} 普通录入商品`,
        skuText: "2c0",
        quantity: 2,
        referenceAmount: "220.00",
        productionDate: "2026-01-01",
        shelfLifeMonths: 12,
        expiryDate: null,
        notes: "普通录入不受批量模式影响",
      },
    ],
  });
  assert(single.status === 201, "legacy single-entry creation remains available");
  orderIds.push(single.body.id);
  assert(single.body.items.length === 1 && single.body.items[0].quantity === 2, "single-entry quantity remains unchanged");
  assert(single.body.items[0].referenceAmount === "220.00", "single-entry reference amount remains item-level data");

  const batch = await api("/api/purchase-orders", "POST", {
    ...baseOrder("BATCH"),
    entryMode: "BATCH",
    batchItems: [
      batchRow(1, { name: `${runId} 同款`, skuText: "2c0", referenceAmount: "125.00", productionDate: "2026-01-31" }),
      batchRow(2, { name: `${runId} 同款`, skuText: "2c0", referenceAmount: "130.00", productionDate: "2026-02-01" }),
      batchRow(3, { name: `${runId} 独立商品`, skuText: "1w1", referenceAmount: null, productionDate: null, shelfLifeMonths: null }),
    ],
  });
  assert(batch.status === 201, "batch creation returns 201");
  orderIds.push(batch.body.id);
  assert(batch.body.items.length === 3, "each submitted batch row creates one purchase item");
  assert(batch.body.items.every((item) => item.quantity === 1), "batch items are persisted with fixed quantity one");
  const duplicateRows = batch.body.items.filter((item) => item.name === `${runId} 同款` && item.skuText === "2C0");
  assert(duplicateRows.length === 2 && new Set(duplicateRows.map((item) => item.id)).size === 2, "same product and SKU rows are not merged");
  assert(duplicateRows.map((item) => item.referenceAmount).sort().join(",") === "125.00,130.00", "reference amount remains independent per batch row");
  assert(duplicateRows.map((item) => item.expiryDate).sort().join(",") === "2027-01-31,2027-02-01", "shelf-life snapshots remain independent per batch row");
  assert(batch.body.totalAmount === "1000.00" && batch.body.shippingAmount === "10.00", "batch rows do not change order payment fields");

  const batchItemIds = batch.body.items.map((item) => item.id);
  const [batchInspectionCount, batchInventoryCount] = await Promise.all([
    db.inspection.count({ where: { purchaseOrderItemId: { in: batchItemIds } } }),
    db.inventoryItem.count({ where: { purchaseOrderItemId: { in: batchItemIds } } }),
  ]);
  assert(batchInspectionCount === 0 && batchInventoryCount === 0, "batch creation does not create inspection or inventory records");

  const maxRows = Array.from({ length: 50 }, (_, index) => batchRow(index + 10));
  const fiftyRows = await api("/api/purchase-orders", "POST", {
    ...baseOrder("MAX-50"), entryMode: "BATCH", batchItems: maxRows,
  });
  assert(fiftyRows.status === 201 && fiftyRows.body.items.length === 50, "batch creation accepts exactly fifty independent rows");
  orderIds.push(fiftyRows.body.id);
  assert(fiftyRows.body.items.every((item) => item.quantity === 1), "fifty-row batch keeps every quantity fixed at one");

  const beforeInvalidCount = await countFixtureOrders();
  const invalidMixedRow = await api("/api/purchase-orders", "POST", {
    ...baseOrder("INVALID-ROW"),
    entryMode: "BATCH",
    batchItems: [batchRow(100), batchRow(101, { referenceAmount: "10.001" })],
  });
  assert(invalidMixedRow.status === 422 && invalidMixedRow.body?.code === "VALIDATION_ERROR", "invalid batch row is rejected by the strict DTO");
  assert(await countFixtureOrders() === beforeInvalidCount, "invalid batch request does not create a partial order or items");

  const overLimit = await api("/api/purchase-orders", "POST", {
    ...baseOrder("OVER-50"), entryMode: "BATCH", batchItems: Array.from({ length: 51 }, (_, index) => batchRow(index + 200)),
  });
  assert(overLimit.status === 422, "batch creation rejects more than fifty rows");
  assert(await countFixtureOrders() === beforeInvalidCount, "over-limit batch request leaves no partial order");

  const illegalQuantity = await api("/api/purchase-orders", "POST", {
    ...baseOrder("ILLEGAL-QUANTITY"), entryMode: "BATCH", batchItems: [{ ...batchRow(300), quantity: 2 }],
  });
  assert(illegalQuantity.status === 422, "batch rows reject a client-supplied quantity");

  const mixedModes = await api("/api/purchase-orders", "POST", {
    ...baseOrder("MIXED-MODES"), entryMode: "BATCH", items: [{ name: "forbidden", quantity: 1 }], batchItems: [batchRow(301)],
  });
  assert(mixedModes.status === 422, "batch and single item payloads cannot be mixed");

  const ownerInjection = await api("/api/purchase-orders", "POST", {
    ...baseOrder("OWNER-INJECTION"), ownerId: "another-owner", entryMode: "BATCH", batchItems: [batchRow(302)],
  });
  assert(ownerInjection.status === 422, "strict DTO rejects client owner injection");

  const expiryBeforeProduction = await api("/api/purchase-orders", "POST", {
    ...baseOrder("INVALID-SHELF-LIFE"), entryMode: "BATCH", batchItems: [batchRow(303, {
      productionDate: "2026-02-02", shelfLifeMonths: null, expiryDate: "2026-02-01",
    })],
  });
  assert(expiryBeforeProduction.status === 400 && expiryBeforeProduction.body?.code === "SHELF_LIFE_DATE_ORDER_INVALID", "invalid shelf-life ordering rolls back the full batch transaction");
  assert(await countFixtureOrders() === beforeInvalidCount, "service validation failure leaves no batch order or items");

  const concurrent = await Promise.all(Array.from({ length: 4 }, (_, index) => api("/api/purchase-orders", "POST", {
    ...baseOrder(`CONCURRENT-${index}`), entryMode: "BATCH", batchItems: [batchRow(400 + index)],
  })));
  assert(concurrent.every((response) => response.status === 201), "concurrent independent batch creates all succeed");
  for (const response of concurrent) orderIds.push(response.body.id);
  const concurrentOrders = await db.purchaseOrder.findMany({
    where: { id: { in: concurrent.map((response) => response.body.id) } }, include: { items: true },
  });
  assert(concurrentOrders.length === 4 && concurrentOrders.every((order) => order.items.length === 1 && order.items[0].quantity === 1), "concurrent creates preserve independent atomic rows");

  const [deliveryAfter, soldAfter] = await Promise.all([
    db.dailyBusinessReportDelivery.findMany({
      where: { ownerId },
      select: { id: true, status: true, attemptCount: true, sentAt: true, failedAt: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    db.inventoryItem.findMany({
      where: { ownerId, itemStatus: "SOLD" },
      select: { id: true, itemStatus: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
  ]);
  assert(JSON.stringify(deliveryAfter) === JSON.stringify(dailyDeliveryBefore), "batch creation does not modify daily report delivery records");
  assert(JSON.stringify(soldAfter) === JSON.stringify(soldBefore), "batch creation does not add or modify SOLD inventory");

  console.log(`verify:m7-purchase-create-batch passed: ${checks} checks`);
} finally {
  let cleanupError = null;
  if (orderIds.length) {
    try {
      const cleanup = await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
      const residual = await db.purchaseOrder.count({ where: { id: { in: orderIds } } });
      if (cleanup.count !== orderIds.length || residual !== 0) {
        cleanupError = new Error(`fixture cleanup failed: deleted ${cleanup.count}, residual ${residual}`);
      }
    } catch (error) {
      cleanupError = error;
    }
  }
  await stopServer();
  await db.$disconnect();
  if (cleanupError) throw cleanupError;
}
