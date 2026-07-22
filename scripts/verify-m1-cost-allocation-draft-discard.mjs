import "dotenv/config";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { launchAcceptanceBrowser } from "./lib/browser-acceptance.mjs";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";
import { db } from "../src/server/db.ts";
import { CostAllocationService } from "../src/server/services/cost-allocation-service.ts";

const ownerId = "default-user";
const runId = `M1-ALLOCATION-DISCARD-${Date.now()}`;
const service = new CostAllocationService();
const orderIds = [];
let otherOwnerId = null;
let baseUrl = null;
let server = null;
let temporaryPort = null;
let accessCookie = null;
let checks = 0;

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
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a verification port."));
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function canListen(port) {
  return new Promise((resolve) => {
    const listener = net.createServer();
    listener.once("error", () => resolve(false));
    listener.listen(port, "127.0.0.1", () => {
      listener.close(() => resolve(true));
    });
  });
}

async function startServer() {
  if (!process.env.APP_PASSWORD) throw new Error("APP_PASSWORD is required for HTTP verification.");
  temporaryPort = await findFreePort();
  baseUrl = `http://127.0.0.1:${temporaryPort}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(temporaryPort)], {
    cwd: process.cwd(), env: process.env, stdio: "ignore", windowsHide: true,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/access`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!(await fetch(`${baseUrl}/access`)).ok) throw new Error("Temporary verification server did not become ready.");
  accessCookie = `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`;
}

async function stopServer() {
  if (!server) return;
  const processToStop = server;
  server = null;
  processToStop.kill();
  await new Promise((resolve) => processToStop.once("exit", resolve));
  assert(temporaryPort !== null && await canListen(temporaryPort), "temporary HTTP verification port is released");
  temporaryPort = null;
}

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Cookie: accessCookie, ...(options.headers ?? {}) },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function json(pathname, method, body) {
  return api(pathname, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function createOrder(suffix, owner = ownerId) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId: owner,
      orderNo: `${runId}-${suffix}`,
      paidAt: new Date("2026-07-23T00:00:00.000Z"),
      totalAmount: "100.00",
      shippingAmount: "5.00",
      items: { create: [{ name: `${runId} 商品甲`, skuText: "2c0", quantity: 1 }, { name: `${runId} 商品乙`, skuText: "1w1", quantity: 1 }] },
    },
    include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  orderIds.push(order.id);
  return order;
}

async function createDraft(orderId) {
  const preview = await service.getEqualPreview(ownerId, orderId);
  return service.save(ownerId, orderId, preview.allocations, false, preview.allocationVersion);
}

async function verifyBrowser(orderId, mobileOrderId) {
  const [cookieName, cookieValue] = accessCookie.split("=");
  const browser = await launchAcceptanceBrowser();
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktop.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await desktop.addCookies([{ name: cookieName, value: cookieValue, url: baseUrl }]);
    await page.goto(`${baseUrl}/purchases/${orderId}`, { waitUntil: "networkidle" });
    await page.getByTestId("cost-allocation-draft-lock").waitFor();
    assert(await page.getByRole("button", { name: "添加商品", exact: true }).isDisabled(), "desktop draft page keeps add-item locked before discard");
    assert(await page.getByRole("button", { name: "批量添加商品", exact: true }).isDisabled(), "desktop draft page keeps batch add locked before discard");
    await page.getByTestId("discard-cost-allocation-draft").click();
    const discardDialog = page.getByTestId("discard-cost-allocation-draft-dialog");
    await discardDialog.waitFor();
    assert(await discardDialog.getByText("本操作不会删除采购商品、修改采购实付金额、修改已经保存的库存成本，或修改验货、库存、销售和售后记录。").isVisible(), "discard dialog states the protected business facts");
    await discardDialog.getByRole("button", { name: "取消" }).click();
    assert((await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).allocationStatus === "DRAFT", "browser cancel performs no write");
    await page.getByTestId("discard-cost-allocation-draft").click();
    await page.getByTestId("discard-cost-allocation-draft-dialog").getByRole("button", { name: "确认放弃" }).click();
    await page.getByText("成本分摊草稿已放弃，可以继续维护商品。").waitFor();
    await page.getByTestId("cost-allocation-draft-lock").waitFor({ state: "detached" });
    assert(await page.getByRole("button", { name: "添加商品", exact: true }).isEnabled(), "desktop discard refreshes the server-derived item editability");
    assert(errors.length === 0, "desktop discard flow adds no browser console or page errors");
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobile.newPage();
    const mobileErrors = [];
    mobilePage.on("pageerror", (error) => mobileErrors.push(error.message));
    mobilePage.on("console", (message) => { if (message.type() === "error") mobileErrors.push(message.text()); });
    await mobile.addCookies([{ name: cookieName, value: cookieValue, url: baseUrl }]);
    await mobilePage.goto(`${baseUrl}/purchases/${mobileOrderId}`, { waitUntil: "networkidle" });
    const lock = mobilePage.getByTestId("cost-allocation-draft-lock");
    await lock.waitFor();
    const discardButton = mobilePage.getByTestId("discard-cost-allocation-draft");
    const box = await discardButton.boundingBox();
    assert(Boolean(box) && box.height >= 44, "mobile discard action has a 44px touch target");
    assert(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile draft lock panel has no horizontal overflow");
    await discardButton.click();
    await mobilePage.getByTestId("discard-cost-allocation-draft-dialog").waitFor();
    assert(await mobilePage.getByTestId("discard-cost-allocation-draft-dialog").isVisible(), "mobile discard confirmation is fully reachable");
    assert(mobileErrors.length === 0, "mobile discard flow adds no browser console or page errors");
    await mobile.close();
  } finally {
    await browser.close();
  }
}

try {
  await startServer();
  assert(Boolean(accessCookie), "temporary HTTP verification has an authenticated session");

  const original = await createOrder("PRIMARY");
  const before = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: original.id }, include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  const draft = await createDraft(original.id);
  assert(draft.allocationStatus === "DRAFT" && draft.items.every((item) => item.allocatedTotalCost !== null), "equal allocation creates one active draft represented by order status and item values");
  const detailLocked = await api(`/api/purchase-orders/${original.id}`);
  assert(detailLocked.status === 200 && detailLocked.body.purchaseItemsEditability.editable === false, "detail DTO exposes the active draft lock");
  assert((await json(`/api/purchases/${original.id}/items`, "POST", { name: "blocked", quantity: 1 })).status === 409, "active draft continues to lock single item creation");
  assert((await json(`/api/purchases/${original.id}/items/batch`, "POST", { items: [{ name: "blocked", skuText: "x" }] })).status === 409, "active draft continues to lock batch item creation");
  assert((await json(`/api/purchases/${original.id}/items/${original.items[0].id}`, "PATCH", { name: "blocked", quantity: 1 })).status === 409, "active draft continues to lock item editing");
  assert((await api(`/api/purchases/${original.id}/items/${original.items[1].id}`, { method: "DELETE" })).status === 409, "active draft continues to lock item deletion");
  const invalid = await json(`/api/purchase-orders/${original.id}/allocation/discard`, "POST", { expectedAllocationVersion: draft.allocationVersion, unexpected: true });
  assert(invalid.status === 400 && invalid.body.code === "INVALID_ALLOCATION_DRAFT_DISCARD_REQUEST", "discard API rejects unknown fields with a stable 400 error");

  const discarded = await json(`/api/purchase-orders/${original.id}/allocation/discard`, "POST", { expectedAllocationVersion: draft.allocationVersion });
  assert(discarded.status === 200 && discarded.body.success === true && discarded.body.purchaseOrderId === original.id && discarded.body.discardedDraftId === original.id && discarded.body.canEditItems === true, "discard API returns the logical draft identity and editability result");
  const after = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: original.id }, include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, actionLogs: { orderBy: { createdAt: "desc" } } },
  });
  assert(after.allocationStatus === "UNALLOCATED" && after.allocationConfirmedAt === null && after.items.every((item) => item.allocatedTotalCost === null), "discard clears only the active draft state and temporary per-item allocation values");
  assert(after.totalAmount.equals(before.totalAmount) && after.shippingAmount.equals(before.shippingAmount) && after.items.map((item) => item.quantity).join(",") === before.items.map((item) => item.quantity).join(","), "discard preserves order money and purchase item facts");
  const log = after.actionLogs.find((entry) => entry.actionType === "COST_ALLOCATION_DRAFT_DISCARDED");
  assert(Boolean(log) && log.reasonCode === "USER_DISCARDED_COST_ALLOCATION_DRAFT" && log.note?.includes("原状态 DRAFT"), "discard writes an auditable purchase action log");
  assert((await json(`/api/purchases/${original.id}/items`, "POST", { name: `${runId} restored`, skuText: "2c0", quantity: 1, referenceAmount: "1.00", notes: "restored" })).status === 201, "discard restores single item creation through the existing service guard");
  assert((await json(`/api/purchases/${original.id}/items/batch`, "POST", { items: [{ name: `${runId} restored batch`, skuText: "1w1", referenceAmount: null, notes: null }] })).status === 201, "discard restores batch item creation through the existing service guard");
  const refreshed = await api(`/api/purchase-orders/${original.id}`);
  const editable = refreshed.body.items[0];
  assert((await json(`/api/purchases/${original.id}/items/${editable.id}`, "PATCH", { name: `${runId} updated`, skuText: "2c0", quantity: 1, referenceAmount: "2.00", notes: "updated" })).status === 200, "discard restores item editing through the existing service guard");
  assert((await api(`/api/purchases/${original.id}/items/${refreshed.body.items.at(-1).id}`, { method: "DELETE" })).status === 200, "discard restores item deletion when existing delete rules allow it");

  const lastItemOrder = await db.purchaseOrder.findUniqueOrThrow({ where: { id: original.id }, include: { items: true } });
  while (lastItemOrder.items.length > 1) {
    const current = await db.purchaseOrder.findUniqueOrThrow({ where: { id: original.id }, include: { items: true } });
    if (current.items.length <= 1) break;
    await api(`/api/purchases/${original.id}/items/${current.items.at(-1).id}`, { method: "DELETE" });
  }
  const sole = await db.purchaseOrder.findUniqueOrThrow({ where: { id: original.id }, include: { items: true } });
  const lastDelete = await api(`/api/purchases/${original.id}/items/${sole.items[0].id}`, { method: "DELETE" });
  assert(lastDelete.status === 409 && lastDelete.body.code === "PURCHASE_ORDER_REQUIRES_ITEM", "discard does not bypass the last-item deletion rule");

  const confirmedOrder = await createOrder("CONFIRMED");
  const confirmedPreview = await service.getEqualPreview(ownerId, confirmedOrder.id);
  await service.save(ownerId, confirmedOrder.id, confirmedPreview.allocations, true, confirmedPreview.allocationVersion);
  const confirmedDiscard = await json(`/api/purchase-orders/${confirmedOrder.id}/allocation/discard`, "POST", { expectedAllocationVersion: (await service.getSummary(ownerId, confirmedOrder.id)).allocationVersion });
  assert(confirmedDiscard.status === 409 && confirmedDiscard.body.code === "ALLOCATION_ALREADY_CONFIRMED", "confirmed allocation cannot be discarded through the draft command");

  const staleOrder = await createOrder("STALE");
  const staleDraft = await createDraft(staleOrder.id);
  const latestPreview = await service.getEqualPreview(ownerId, staleOrder.id);
  await service.save(ownerId, staleOrder.id, latestPreview.allocations, false, latestPreview.allocationVersion);
  const staleDiscard = await json(`/api/purchase-orders/${staleOrder.id}/allocation/discard`, "POST", { expectedAllocationVersion: staleDraft.allocationVersion });
  assert(staleDiscard.status === 409 && staleDiscard.body.code === "ALLOCATION_DRAFT_CONFLICT", "stale draft fingerprints cannot discard a newer draft state");
  assert((await service.getSummary(ownerId, staleOrder.id)).allocationStatus === "DRAFT", "a stale request does not delete the current draft");

  otherOwnerId = `${runId}-OTHER`;
  await db.user.create({ data: { id: otherOwnerId, name: "M1 discard cross owner" } });
  const otherOrder = await createOrder("OTHER", otherOwnerId);
  await db.purchaseOrder.update({ where: { id: otherOrder.id }, data: { allocationStatus: "DRAFT" } });
  await service.discardDraft(ownerId, otherOrder.id, "not-a-real-version")
    .then(() => { throw new Error("Cross-owner discard should not succeed."); })
    .catch((error) => assert(error.code === "ORDER_NOT_FOUND", "cross-owner discard keeps the existing hidden not-found boundary"));

  const inventoryBefore = await db.inventoryItem.count({ where: { purchaseOrderItem: { purchaseOrderId: { in: orderIds } } } });
  const salesBefore = await db.saleOrder.count({ where: { ownerId, saleNo: { startsWith: runId } } });
  assert(inventoryBefore === 0 && salesBefore === 0, "discard fixtures create no inventory, sales, state writes, or after-sales records");

  const browserOrder = await createOrder("BROWSER");
  await createDraft(browserOrder.id);
  const mobileOrder = await createOrder("BROWSER-MOBILE");
  await createDraft(mobileOrder.id);
  await verifyBrowser(browserOrder.id, mobileOrder.id);

  console.log(`verify:m1-cost-allocation-draft-discard passed: ${checks} checks`);
} finally {
  try {
    await stopServer();
  } finally {
    if (orderIds.length) {
      await db.purchaseOrderActionLog.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
      const cleanup = await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
      if (cleanup.count !== orderIds.length) throw new Error(`fixture cleanup mismatch: expected ${orderIds.length}, deleted ${cleanup.count}`);
    }
    if (otherOwnerId) await db.user.delete({ where: { id: otherOwnerId } });
  }
}
