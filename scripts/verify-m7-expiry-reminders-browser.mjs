import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { launchAcceptanceBrowser } from "./lib/browser-acceptance.mjs";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";
import { db } from "../src/server/db.ts";
import { addBusinessDays, getShanghaiBusinessDate } from "../src/lib/inventory-expiry-risk.ts";

const ownerId = "default-user";
const runId = `M7-EXPIRY-BROWSER-${Date.now()}-${randomUUID().slice(0, 8)}`;
const created = { orderIds: [], inspectionIds: [], inventoryIds: [], warehouseIds: [], locationIds: [] };
let checks = 0;
let server = null;
let serverOutput = "";
let baseUrl = null;
let accessCookie = null;

function assert(value, message) {
  if (!value) throw new Error(message);
  checks += 1;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const address = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  if (!address || typeof address === "string" || address.port === 3000) throw new Error("Unable to allocate an independent browser verification port.");
  return address.port;
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) throw new Error(`Temporary browser server exited early: ${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/access`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Wait for the independently-started verification server.
    }
    await sleep(250);
  }
  throw new Error(`Temporary browser server did not become ready: ${serverOutput}`);
}

async function startServer() {
  if (!process.env.APP_PASSWORD) throw new Error("APP_PASSWORD is required for browser acceptance verification.");
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  server = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  server.stdout.on("data", (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-4000); });
  server.stderr.on("data", (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-4000); });
  await waitForServer();
  accessCookie = `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`;
  assert(port !== 3000, "browser verification uses an independent temporary port");
  assert(Boolean(accessCookie), "browser verification creates a temporary access session");
}

async function stopServer() {
  if (!server) return;
  if (process.platform === "win32" && server.pid) {
    try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* verified below */ }
  } else if (server.exitCode === null) {
    server.kill();
  }
  server.stdout.destroy();
  server.stderr.destroy();
  server.unref();
  const port = Number(new URL(baseUrl).port);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let listeners = [];
    try {
      listeners = execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`], { windowsHide: true })
        .toString().trim().split(/\s+/).filter(Boolean);
    } catch {
      listeners = [];
    }
    if (!listeners.length) return;
    await sleep(150);
  }
  throw new Error(`Temporary browser verification port ${port} was not released.`);
}

async function createFixture(label, expiryDate, warehouseId, storageLocationId) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-${label}`,
      paidAt: new Date(),
      totalAmount: "10.00",
      shippingAmount: "0.00",
      status: "PENDING_INSPECTION",
      allocationStatus: "CONFIRMED",
      allocationConfirmedAt: new Date(),
      items: { create: { name: `${runId}-${label}`, skuText: label, quantity: 1, allocatedTotalCost: "10.00" } },
    },
    include: { items: true },
  });
  created.orderIds.push(order.id);
  const inspection = await db.inspection.create({ data: { ownerId, purchaseOrderItemId: order.items[0].id, sequence: 1 } });
  created.inspectionIds.push(inspection.id);
  const inventory = await db.inventoryItem.create({
    data: {
      ownerId,
      purchaseOrderItemId: order.items[0].id,
      inspectionId: inspection.id,
      inventoryCode: `${runId}-${label}`,
      name: `${runId}-${label}`,
      skuText: label,
      unitCost: "10.00",
      itemStatus: "STOCKED",
      ownershipStatus: "OWNED",
      stockedAt: new Date(),
      expiryDate,
      warehouseId,
      storageLocationId,
      condition: "LIKE_NEW",
    },
  });
  created.inventoryIds.push(inventory.id);
  return inventory;
}

async function verifyDesktop(expired) {
  const browser = await launchAcceptanceBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  const [cookieName, cookieValue] = accessCookie.split("=");
  await context.addCookies([{ name: cookieName, value: cookieValue, url: baseUrl }]);
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByText("库存效期风险", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    const expiredLink = page.locator('a[href="/inventory?expiryRisk=EXPIRED"]');
    assert(await expiredLink.count() === 1, "1440px dashboard shows exactly one expired-inventory risk card");
    assert((await expiredLink.innerText()).includes("已过期") && (await expiredLink.innerText()).includes("1 件"), "dashboard expired card has the expected localized count");
    await expiredLink.click();
    await page.waitForURL(/\/inventory\?expiryRisk=EXPIRED/);
    await page.getByRole("cell", { name: expired.name, exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    const body = await page.locator("body").innerText();
    assert(body.includes("库存 · 已过期") && body.includes("已过期"), "dashboard link applies the server-side expiry filter and display state");
    await page.goto(`${baseUrl}/reports/daily`, { waitUntil: "networkidle" });
    await page.getByText("库存效期风险", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    assert((await page.locator("body").innerText()).includes(expired.name), "daily report displays the expiry sample from the shared aggregate");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "1440px expiry dashboard and report have no horizontal overflow");
    assert(browserErrors.length === 0, "1440px expiry flows add no browser console or page errors");
  } finally {
    await context.close();
    await browser.close();
  }
}

async function verifyMobile() {
  const browser = await launchAcceptanceBrowser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  const [cookieName, cookieValue] = accessCookie.split("=");
  await context.addCookies([{ name: cookieName, value: cookieValue, url: baseUrl }]);
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByText("库存效期风险", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    const expiredLink = page.locator('a[href="/inventory?expiryRisk=EXPIRED"]');
    const box = await expiredLink.boundingBox();
    assert(Boolean(box && box.height >= 44), "390px expiry risk card remains a 44px-or-larger touch target");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390px dashboard has no horizontal overflow");
    await expiredLink.click();
    await page.waitForURL(/\/inventory\?expiryRisk=EXPIRED/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390px filtered inventory page has no horizontal overflow");
    assert(browserErrors.length === 0, "390px expiry flows add no browser console or page errors");
  } finally {
    await context.close();
    await browser.close();
  }
}

async function cleanup() {
  if (created.inventoryIds.length) await db.inventoryItem.deleteMany({ where: { id: { in: created.inventoryIds } } });
  if (created.inspectionIds.length) await db.inspection.deleteMany({ where: { id: { in: created.inspectionIds } } });
  if (created.orderIds.length) await db.purchaseOrder.deleteMany({ where: { id: { in: created.orderIds } } });
  if (created.locationIds.length) await db.warehouseLocation.deleteMany({ where: { id: { in: created.locationIds } } });
  if (created.warehouseIds.length) await db.warehouse.deleteMany({ where: { id: { in: created.warehouseIds } } });
  const residual = await db.inventoryItem.count({ where: { inventoryCode: { startsWith: runId } } });
  if (residual !== 0) throw new Error(`browser fixture cleanup failed: ${residual} inventory records remain`);
}

try {
  assert(await db.user.findUnique({ where: { id: ownerId } }) !== null, "default owner exists for isolated browser fixtures");
  const warehouse = await db.warehouse.create({ data: { ownerId, name: `${runId}-WAREHOUSE` } });
  const location = await db.warehouseLocation.create({ data: { ownerId, warehouseId: warehouse.id, name: "A-01" } });
  created.warehouseIds.push(warehouse.id);
  created.locationIds.push(location.id);
  const today = getShanghaiBusinessDate(new Date());
  const expired = await createFixture("EXPIRED", addBusinessDays(today, -1), warehouse.id, location.id);
  await createFixture("WITHIN-30", addBusinessDays(today, 20), warehouse.id, location.id);
  await createFixture("WITHIN-90", addBusinessDays(today, 60), warehouse.id, location.id);
  await createFixture("WITHIN-180", addBusinessDays(today, 120), warehouse.id, location.id);
  await startServer();
  await verifyDesktop(expired);
  await verifyMobile();
  console.log(`verify:m7-expiry-reminders-browser passed: ${checks} checks`);
} finally {
  try {
    await stopServer();
  } finally {
    try {
      await cleanup();
    } finally {
      await db.$disconnect();
    }
  }
}
