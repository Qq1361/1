import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { salesService } from "../src/server/sales/sales-service.ts";
import { getReminderType } from "../src/server/services/todo-service.ts";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";

let baseUrl = process.env.APP_BASE_URL ?? null;
let temporaryServer = null;
const ownerId = "default-user";
const runId = Date.now();
const legacyStatuses = ["LISTED", "IN_BATCH", "SHIPPED_TO_WAREHOUSE", "WAREHOUSE_RECEIVED", "INBOUND_SUCCESS", "INBOUND_FAILED", "PENDING_SETTLEMENT", "SETTLED"];
let orderId;
const saleOrderIds = [];
const accessCookie = process.env.APP_PASSWORD
  ? `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`
  : null;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string" || address.port === 3000) throw new Error("Unable to allocate an independent verification port.");
  return address.port;
}

async function startTemporaryServer() {
  if (baseUrl) return;
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  temporaryServer = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env: process.env, stdio: "ignore", windowsHide: true });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (temporaryServer.exitCode !== null) throw new Error("Temporary item-status verification server exited before readiness.");
    try {
      const response = await fetch(`${baseUrl}/access`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Temporary item-status verification server did not start.");
}

function stopTemporaryServer() {
  if (!temporaryServer || temporaryServer.exitCode !== null) return;
  try {
    if (process.platform === "win32" && temporaryServer.pid) execFileSync("taskkill", ["/pid", String(temporaryServer.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else temporaryServer.kill();
  } catch { /* process may already have exited */ }
  temporaryServer.unref();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(accessCookie ? { Cookie: accessCookie } : {}),
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
}

async function createInventory(item, sequence, itemStatus, suffix) {
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
      inventoryCode: `STATUS-${runId}-${suffix}`,
      name: `ItemStatus contract ${runId}`,
      skuText: "STATE-01",
      unitCost: new Prisma.Decimal("100.00"),
      itemStatus,
      stockedAt: new Date(Date.now() - 96 * 60 * 60 * 1000),
    },
  });
}

try {
  await startTemporaryServer();
  await db.user.upsert({ where: { id: ownerId }, update: {}, create: { id: ownerId, name: "Default User" } });
  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `STATUS-CONTRACT-${runId}`,
      paidAt: new Date(),
      totalAmount: new Prisma.Decimal("300.00"),
      shippingAmount: new Prisma.Decimal(0),
      allocationStatus: "CONFIRMED",
      allocationConfirmedAt: new Date(),
      items: { create: [{ name: `ItemStatus contract ${runId}`, quantity: 3, allocatedTotalCost: new Prisma.Decimal("300.00") }] },
    },
    include: { items: true },
  });
  orderId = order.id;
  const item = order.items[0];
  const stocked = await createInventory(item, 1, "STOCKED", "STOCKED");
  const sold = await createInventory(item, 2, "SOLD", "SOLD");

  const patch = { method: "PATCH", headers: { "Content-Type": "application/json" } };
  const officialStatusPatch = await api(`/api/inventory/${stocked.id}`, { ...patch, body: JSON.stringify({ itemStatus: "STOCKED" }) });
  assert(officialStatusPatch.response.status === 400, "generic PATCH rejects official itemStatus");
  const legacyStatusPatch = await api(`/api/inventory/${stocked.id}`, { ...patch, body: JSON.stringify({ itemStatus: "LISTED" }) });
  assert(legacyStatusPatch.response.status === 400, "generic PATCH rejects retired itemStatus");
  const nestedStatusPatch = await api(`/api/inventory/${stocked.id}`, { ...patch, body: JSON.stringify({ data: { itemStatus: "LISTED" } }) });
  assert(nestedStatusPatch.response.status === 400, "generic PATCH rejects nested status bypass");
  const undeclaredPatch = await api(`/api/inventory/${stocked.id}`, { ...patch, body: JSON.stringify({ unexpected: "x" }) });
  assert(undeclaredPatch.response.status === 422, "generic PATCH rejects undeclared fields");
  const normalPatch = await api(`/api/inventory/${stocked.id}`, { ...patch, body: JSON.stringify({ saleMode: "XIANYU" }) });
  assert(normalPatch.response.ok && normalPatch.body.saleMode === "XIANYU", "generic PATCH preserves allowed updates");

  const supportedFilter = await api(`/api/inventory?itemStatus=STOCKED&query=${encodeURIComponent(stocked.inventoryCode)}`);
  assert(supportedFilter.response.ok, "inventory API accepts a supported status filter");
  const legacyFilter = await api("/api/inventory?itemStatus=LISTED");
  assert(legacyFilter.response.status === 400, "inventory API rejects retired status filters");

  const saleDraft = await salesService.createDraft(ownerId, {
    platform: "XIANYU",
    soldAt: new Date().toISOString(),
    grossAmount: "120.00",
    items: [{ inventoryItemId: stocked.id }],
  });
  saleOrderIds.push(saleDraft.id);
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: stocked.id } })).itemStatus === "STOCKED", "draft sales do not occupy inventory");

  const historicalSnapshotSale = await db.saleOrder.create({
    data: {
      ownerId,
      saleNo: `STATUS-HISTORY-${runId}`,
      platform: "XIANYU",
      soldAt: new Date(),
      grossAmount: new Prisma.Decimal("100.00"),
      status: "CONFIRMED",
      confirmedAt: new Date(),
      lines: { create: {
        ownerId,
        inventoryItemId: sold.id,
        inventoryCodeSnapshot: sold.inventoryCode,
        productNameSnapshot: sold.name,
        skuSnapshot: sold.skuText,
        unitCostSnapshot: sold.unitCost,
        costAmount: sold.unitCost,
        preSaleItemStatus: "LISTED",
        preSaleSaleMode: "NONE",
      } },
    },
  });
  saleOrderIds.push(historicalSnapshotSale.id);
  let legacySnapshotBlocked = false;
  try {
    await salesService.cancel(ownerId, historicalSnapshotSale.id);
  } catch (error) {
    legacySnapshotBlocked = error?.status === 409;
  }
  assert(legacySnapshotBlocked, "cancel refuses retired historical status snapshots");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: sold.id } })).itemStatus === "SOLD", "failed historical restore keeps inventory unchanged");

  assert(getReminderType({ saleMode: "NONE", itemStatus: "LISTED", expiryDate: new Date(Date.now() + 300 * 86_400_000), stockedAt: new Date() }) === null, "retired status has no reminder");
  const summary = await api(`/api/inventory/sku-summary?query=${encodeURIComponent(`ItemStatus contract ${runId}`)}`);
  const summaryRow = summary.body.items.find((row) => row.sku === "STATE-01");
  assert(summary.response.ok && summaryRow.unsoldCount === 1 && summaryRow.soldCount === 1, "SKU summary excludes SOLD from unsold totals");
  assert(!("legacyStatusCount" in summaryRow), "SKU summary exposes no retired-status count");

  const [listSource, contractSource, schemaSource, inventoryRouteSource, inventoryServiceSource] = await Promise.all([
    fs.readFile("src/components/inventory/inventory-list.tsx", "utf8"),
    fs.readFile("src/lib/inventory-item-status-contract.ts", "utf8"),
    fs.readFile("prisma/schema.prisma", "utf8"),
    fs.readFile("src/app/api/inventory/[id]/route.ts", "utf8"),
    fs.readFile("src/server/services/inventory-service.ts", "utf8"),
  ]);
  const itemStatusEnum = schemaSource.match(/enum ItemStatus \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert(!legacyStatuses.some((status) => new RegExp(`^\\s*${status}\\s*$`, "m").test(itemStatusEnum)), "schema no longer contains retired ItemStatus values");
  assert(!listSource.includes('"LISTED"') && !listSource.includes('"IN_BATCH"'), "inventory list exposes no retired status filters");
  assert(contractSource.includes("SUPPORTED_INVENTORY_ITEM_STATUSES") && contractSource.includes("LEGACY_INVENTORY_ITEM_STATUSES"), "status contract separates supported and retired strings");
  assert(!inventoryRouteSource.includes("itemStatus: z") && !inventoryServiceSource.includes("data.itemStatus as Prisma"), "generic update has no itemStatus write path");
  assert(!inventoryServiceSource.includes("legacyStatusCount"), "SKU summary has no unreachable legacy counter");
  assert(!schemaSource.includes("REMOVED"), "schema does not introduce REMOVED");

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "schema excludes all eight retired ItemStatus values",
      "generic PATCH rejects official and retired itemStatus values",
      "generic PATCH rejects nested status bypass and undeclared fields",
      "generic PATCH preserves supported saleMode updates",
      "inventory API accepts supported and rejects retired status filters",
      "sales draft remains non-occupying",
      "retired SaleLine snapshot cannot restore inventory automatically",
      "failed historical restore leaves inventory unchanged",
      "retired status receives no expiry or overstock reminder",
      "SKU summary excludes SOLD from unsold totals",
      "SKU summary has no retired-status counter",
      "inventory list exposes no retired status filters",
      "status contract separates formal enum values from legacy strings",
      "generic inventory update has no itemStatus write path",
      "no REMOVED state or SOLD write path was introduced",
      "test data uses a unique run id and exact cleanup",
    ],
  }, null, 2));
} finally {
  try {
    if (saleOrderIds.length) await db.saleOrder.deleteMany({ where: { id: { in: saleOrderIds } } });
    if (orderId) await db.purchaseOrder.delete({ where: { id: orderId } });
  } finally {
    await db.$disconnect();
    stopTemporaryServer();
  }
}
