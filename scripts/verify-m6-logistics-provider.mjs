import "dotenv/config";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { ServiceError } from "../src/server/errors.ts";
import { DEFAULT_OWNER_ID } from "../src/server/constants.ts";
import { KDNIAO_ENDPOINTS, readKdniaoConfig } from "../src/server/logistics/kdniao-config.ts";
import { LogisticsProviderRegistry } from "../src/server/logistics/logistics-provider-registry.ts";
import { GenericLogisticsService } from "../src/server/logistics/logistics-service.ts";
import { KdniaoLogisticsProvider } from "../src/server/logistics/providers/kdniao-logistics-provider.ts";
import { LogisticsProviderError } from "../src/server/logistics/logistics-types.ts";

const runId = `M6A2-${Date.now()}-${process.pid}`;
const ownerId = `${runId}-OWNER-A`;
const otherOwnerId = `${runId}-OWNER-B`;
const created = { ownerIds: [ownerId, otherOwnerId], orderIds: [], shipmentIds: [], crossOwnerOrderId: null };
let checks = 0;
let server = null;
let browser = null;
let port = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

function decimal(value) {
  return new Prisma.Decimal(value);
}

async function rejectsCode(action, code, message) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ServiceError && error.code === code, `${message}: expected ${code}`);
    return;
  }
  throw new Error(`${message}: expected ${code}`);
}

function kdniaoConfig() {
  return readKdniaoConfig({
    LOGISTICS_KDNIAO_MODE: "sandbox",
    LOGISTICS_KDNIAO_EBUSINESS_ID: "local-test-business",
    LOGISTICS_KDNIAO_APP_KEY: "local-test-key",
    LOGISTICS_KDNIAO_TIMEOUT_MS: "5000",
  });
}

function providerResponse(state = "3") {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      Success: true,
      State: state,
      ShipperCode: "SF",
      LogisticCode: `${runId}01`,
      Traces: [
        { AcceptTime: "2026-07-18 09:00:00", AcceptStation: `揽收完成，联系电话 13812345678` },
        { AcceptTime: "2026-07-18 13:30:00", AcceptStation: `包裹已签收，座机 020-12345678` },
      ],
    }),
  };
}

async function createOrder(owner, suffix) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId: owner,
      orderNo: `${runId}-${suffix}`,
      paidAt: new Date("2026-07-18T01:00:00.000Z"),
      totalAmount: decimal("100.00"),
      shippingAmount: decimal("0.00"),
      status: "PAID",
      items: { create: { name: `${runId} 测试商品`, skuText: "M6-A2", quantity: 1 } },
    },
  });
  created.orderIds.push(order.id);
  return order;
}

async function serviceVerification() {
  await db.user.createMany({ data: [
    { id: ownerId, name: `${runId} Owner A` },
    { id: otherOwnerId, name: `${runId} Owner B` },
  ] });
  const order = await createOrder(ownerId, "SERVICE-PO");
  const otherOrder = await createOrder(otherOwnerId, "OTHER-PO");
  created.crossOwnerOrderId = otherOrder.id;
  const before = await db.purchaseOrder.findUnique({ where: { id: order.id }, select: { status: true, deliveredAt: true, updatedAt: true } });
  const inventoryBefore = await db.inventoryItem.count({ where: { ownerId } });
  const inspectionBefore = await db.inspection.count({ where: { ownerId } });

  const transportCalls = [];
  const provider = new KdniaoLogisticsProvider(async (request) => {
    transportCalls.push(request);
    return providerResponse("3");
  }, kdniaoConfig, () => new Date("2026-07-18T06:00:00.000Z"));
  const service = new GenericLogisticsService(new LogisticsProviderRegistry([provider]), () => new Date("2026-07-18T06:00:00.000Z"));
  const first = await service.registerShipment(ownerId, {
    businessType: "PURCHASE_INBOUND",
    businessId: order.id,
    provider: "KDNIAO",
    carrierCode: "SF",
    carrierName: "顺丰速运",
    trackingNumber: `${runId}01`,
  });
  created.shipmentIds.push(first.id);
  assert(first.wasCreated === true, "first registration creates a shipment");

  const repeated = await service.registerShipment(ownerId, {
    businessType: "PURCHASE_INBOUND",
    businessId: order.id,
    provider: "KDNIAO",
    carrierCode: "sf",
    carrierName: "顺丰",
    trackingNumber: `${runId}01`,
  });
  assert(repeated.id === first.id && repeated.wasCreated === false, "same binding registration is idempotent");
  assert(await db.logisticsShipment.count({ where: { businessId: order.id } }) === 1, "same binding does not create a duplicate row");

  await rejectsCode(
    () => service.registerShipment(ownerId, { businessType: "PURCHASE_INBOUND", businessId: order.id, provider: "KDNIAO", carrierCode: "SF", trackingNumber: `${runId}02` }),
    "LOGISTICS_SHIPMENT_BINDING_CONFLICT",
    "different tracking binding conflicts",
  );
  await rejectsCode(
    () => service.registerShipment(ownerId, { businessType: "PURCHASE_INBOUND", businessId: otherOrder.id, provider: "KDNIAO", carrierCode: "SF", trackingNumber: `${runId}03` }),
    "LOGISTICS_BUSINESS_OBJECT_NOT_FOUND",
    "cross-owner business object stays hidden",
  );

  const synced = await service.syncShipmentWithProvider(ownerId, first.id);
  assert(synced.shipment.currentStatus === "DELIVERED", "KDNIAO delivered state persists as DELIVERED");
  assert(synced.shipment.deliveredAt?.toISOString() === "2026-07-18T05:30:00.000Z", "first delivered event determines deliveredAt");
  assert(synced.insertedEventCount === 2, "first sync writes normalized events");
  assert(transportCalls.length === 1, "manual sync issues exactly one provider request");
  assert(transportCalls[0].endpoint === KDNIAO_ENDPOINTS.sandbox, "service transport uses the fixed sandbox endpoint");
  const requestForm = new URLSearchParams(transportCalls[0].body);
  assert(requestForm.get("RequestType") === "1002", "service transport sends RequestType 1002");
  assert(Boolean(requestForm.get("DataSign")), "service transport sends a signature");
  const events = await service.listTrackingEvents(ownerId, first.id);
  assert(events[0].description.includes("138****5678"), "mobile number is masked before persistence");
  assert(events[1].description.includes("020-****5678"), "landline number is masked before persistence");
  assert(!events.some((event) => event.description.includes("13812345678") || event.description.includes("020-12345678")), "raw telephone numbers are not persisted");
  const repeatedSync = await service.syncShipmentWithProvider(ownerId, first.id);
  assert(repeatedSync.insertedEventCount === 0, "repeated sync is event-idempotent");
  assert((await service.listTrackingEvents(ownerId, first.id)).length === 2, "repeated sync retains exactly two events");

  const oldStatus = repeatedSync.shipment.currentStatus;
  const oldEventCount = await db.logisticsTrackingEvent.count({ where: { logisticsShipmentId: first.id } });
  const failingProvider = new KdniaoLogisticsProvider(async () => {
    throw new LogisticsProviderError("LOGISTICS_PROVIDER_TIMEOUT", "local timeout", true);
  }, kdniaoConfig);
  const failingService = new GenericLogisticsService(new LogisticsProviderRegistry([failingProvider]));
  await rejectsCode(() => failingService.syncShipmentWithProvider(ownerId, first.id), "LOGISTICS_PROVIDER_TIMEOUT", "injected provider timeout is safely mapped");
  const failed = await service.getShipment(ownerId, first.id);
  assert(failed.currentStatus === oldStatus, "provider failure preserves current status");
  assert(await db.logisticsTrackingEvent.count({ where: { logisticsShipmentId: first.id } }) === oldEventCount, "provider failure preserves old events");
  assert(failed.failureCount === 1, "provider failure increments failure count");

  const after = await db.purchaseOrder.findUnique({ where: { id: order.id }, select: { status: true, deliveredAt: true, updatedAt: true } });
  assert(JSON.stringify(after) === JSON.stringify(before), "real logistics sync does not update purchase order facts");
  assert(await db.inventoryItem.count({ where: { ownerId } }) === inventoryBefore, "real logistics sync creates no inventory");
  assert(await db.inspection.count({ where: { ownerId } }) === inspectionBefore, "real logistics sync creates no inspection");
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const selected = typeof address === "object" && address ? address.port : null;
      probe.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/access`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("temporary Next server did not become ready");
}

async function isPortOpen(selectedPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: selectedPort });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}

function listenerPids(selectedPort) {
  if (process.platform !== "win32") return [];
  const result = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  const pids = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (match && Number(match[1]) === selectedPort) pids.add(Number(match[2]));
  }
  return [...pids];
}

async function stopServer() {
  if (!server) return;
  const pid = server.pid;
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (port) {
    if (await isPortOpen(port)) {
      for (const listenerPid of listenerPids(port)) {
        spawnSync("taskkill", ["/PID", String(listenerPid), "/T", "/F"], { stdio: "ignore" });
      }
    }
    for (let attempt = 0; attempt < 60 && await isPortOpen(port); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const stillOpen = await isPortOpen(port);
    if (stillOpen) {
      throw new Error(`temporary verification port ${port} remains open; listeners=${listenerPids(port).join(",") || "unknown"}; parent=${pid ?? "unknown"}`);
    }
    checks += 1;
  }
  server = null;
}

async function httpAndBrowserVerification() {
  const owner = await db.user.findUnique({ where: { id: DEFAULT_OWNER_ID }, select: { id: true } });
  assert(Boolean(owner), "default owner exists for authenticated HTTP verification");
  const order = await createOrder(DEFAULT_OWNER_ID, "HTTP-PO");
  const shipment = await db.logisticsShipment.create({
    data: {
      ownerId: DEFAULT_OWNER_ID,
      businessType: "PURCHASE_INBOUND",
      businessId: order.id,
      provider: "KDNIAO",
      carrierCode: "SF",
      carrierName: "顺丰速运",
      trackingNumber: `${runId}HTTP01`,
      normalizedTrackingNumber: `${runId}HTTP01`,
      currentStatus: "DELIVERED",
      rawStatusCode: "3",
      lastEventAt: new Date("2026-07-18T05:30:00.000Z"),
      lastSyncedAt: new Date("2026-07-18T06:00:00.000Z"),
      syncStatus: "SYNCED",
      deliveredAt: new Date("2026-07-18T05:30:00.000Z"),
      events: {
        create: {
          ownerId: DEFAULT_OWNER_ID,
          dedupeKey: `${runId}-HTTP-EVENT`,
          eventTime: new Date("2026-07-18T05:30:00.000Z"),
          status: "DELIVERED",
          description: `${runId} 长轨迹内容用于验证移动端自动换行，联系电话 138****5678，包裹已由前台代收。`.repeat(3),
          rawStatusCode: "3",
        },
      },
    },
  });
  created.shipmentIds.push(shipment.id);
  const unboundOrder = await createOrder(DEFAULT_OWNER_ID, "HTTP-UNBOUND");

  port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  server = spawn(process.execPath, [nextBin, "start", "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOGISTICS_KDNIAO_MODE: "disabled",
      LOGISTICS_KDNIAO_EBUSINESS_ID: "",
      LOGISTICS_KDNIAO_APP_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => output.push(String(chunk)));
  server.stderr.on("data", (chunk) => output.push(String(chunk)));
  await waitForServer(baseUrl);

  const unauthenticated = await fetch(`${baseUrl}/api/logistics/provider-status`, { redirect: "manual" });
  assert([307, 308].includes(unauthenticated.status), "unauthenticated logistics API is protected");
  const password = process.env.APP_PASSWORD;
  if (!password) throw new Error("APP_PASSWORD is required for authenticated HTTP verification");
  const access = await fetch(`${baseUrl}/api/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert(access.status === 200, "temporary server accepts the configured access password");
  const cookie = access.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("access cookie was not returned");
  const headers = { Cookie: cookie };

  const statusResponse = await fetch(`${baseUrl}/api/logistics/provider-status`, { headers });
  const status = await statusResponse.json();
  assert(statusResponse.status === 200, "provider status API returns 200");
  assert(JSON.stringify(status) === JSON.stringify({ provider: "KDNIAO", configured: false, mode: "disabled" }), "provider status returns only safe configuration facts");
  assert(!JSON.stringify(status).includes("APP_KEY") && !JSON.stringify(status).includes("EBusiness"), "provider status does not expose credentials");

  const query = new URLSearchParams({ businessType: "PURCHASE_INBOUND", businessId: order.id });
  const shipmentResponse = await fetch(`${baseUrl}/api/logistics/shipments?${query}`, { headers });
  const shipmentPayload = await shipmentResponse.json();
  assert(shipmentResponse.status === 200, "shipment query API returns 200");
  assert(shipmentPayload.shipment.id === shipment.id && shipmentPayload.events.length === 1, "shipment query returns saved timeline data");
  assert(!("ownerId" in shipmentPayload.shipment), "shipment API does not expose ownerId");

  const crossOwnerQuery = new URLSearchParams({ businessType: "PURCHASE_INBOUND", businessId: created.crossOwnerOrderId });
  const crossOwnerResponse = await fetch(`${baseUrl}/api/logistics/shipments?${crossOwnerQuery}`, { headers });
  const crossOwnerPayload = await crossOwnerResponse.json();
  assert(crossOwnerResponse.status === 404, "cross-owner shipment query returns 404");
  assert(crossOwnerPayload.error.code === "LOGISTICS_BUSINESS_OBJECT_NOT_FOUND", "cross-owner query uses the same not-found contract");

  const disabledSync = await fetch(`${baseUrl}/api/logistics/shipments/${shipment.id}/sync`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  });
  const disabledSyncPayload = await disabledSync.json();
  assert(disabledSync.status === 503, "unconfigured provider sync returns 503");
  assert(disabledSyncPayload.error.code === "LOGISTICS_PROVIDER_NOT_CONFIGURED", "unconfigured sync returns the stable provider error");

  const disabledRegistration = await fetch(`${baseUrl}/api/logistics/shipments`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ businessType: "PURCHASE_INBOUND", businessId: unboundOrder.id, provider: "KDNIAO", carrierCode: "SF", carrierName: "顺丰速运", trackingNumber: `${runId}NEW` }),
  });
  const disabledPayload = await disabledRegistration.json();
  assert(disabledRegistration.status === 503, "unconfigured provider registration returns 503");
  assert(disabledPayload.error.code === "LOGISTICS_PROVIDER_NOT_CONFIGURED", "unconfigured provider returns a stable error code");

  const unknownField = await fetch(`${baseUrl}/api/logistics/shipments`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ businessType: "PURCHASE_INBOUND", businessId: unboundOrder.id, provider: "KDNIAO", carrierCode: "SF", trackingNumber: `${runId}NEW`, appKey: "must-reject" }),
  });
  assert(unknownField.status === 400 && (await unknownField.json()).error.code === "UNKNOWN_FIELD", "strict API rejects credential-shaped unknown fields");

  const disabledBusiness = await fetch(`${baseUrl}/api/logistics/shipments?businessType=PLATFORM_RETURN&businessId=${order.id}`, { headers });
  assert(disabledBusiness.status === 400 && (await disabledBusiness.json()).error.code === "LOGISTICS_BUSINESS_TYPE_NOT_ENABLED", "HTTP API rejects business types outside PURCHASE_INBOUND");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const [cookieName, cookieValue] = cookie.split("=");
  await context.addCookies([{ name: cookieName, value: cookieValue, url: baseUrl }]);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`${baseUrl}/purchases/${order.id}`, { waitUntil: "networkidle" });
  await page.getByTestId("real-logistics-card").waitFor();
  assert(await page.getByText("真实物流查询", { exact: true }).isVisible(), "purchase detail renders the real logistics section");
  assert(await page.getByTestId("kdniao-not-configured").isVisible(), "unconfigured provider message is visible");
  assert(await page.getByText("已签收", { exact: true }).first().isVisible(), "saved delivered status is displayed in Chinese");
  assert(await page.getByTestId("logistics-delivered-warning").isVisible(), "delivered state shows the manual inspection warning");
  assert((await page.getByTestId("real-logistics-event").innerText()).includes("138****5678"), "browser timeline shows masked contact data");
  assert(await page.getByRole("button", { name: "查询物流" }).isDisabled(), "query button is disabled while KDNIAO is unconfigured");
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert(noOverflow, "390px purchase detail has no horizontal overflow");
  assert(consoleErrors.length === 0, `browser console has no new errors: ${consoleErrors.join(" | ")}`);
  await context.close();
  await browser.close();
  browser = null;
  assert(!output.join("").includes("api.kdniao.com") && !output.join("").includes("sandboxapi.kdniao.com"), "HTTP and browser verification never call the public KDNIAO endpoints");
}

async function cleanup() {
  const failures = [];
  const clean = async (label, action) => {
    try { await action(); } catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  if (created.shipmentIds.length) await clean("shipments", () => db.logisticsShipment.deleteMany({ where: { id: { in: created.shipmentIds } } }));
  if (created.orderIds.length) await clean("purchase orders", () => db.purchaseOrder.deleteMany({ where: { id: { in: created.orderIds } } }));
  await clean("owners", () => db.user.deleteMany({ where: { id: { in: created.ownerIds } } }));
  const leftovers = await Promise.all([
    db.logisticsShipment.count({ where: { id: { in: created.shipmentIds } } }),
    db.purchaseOrder.count({ where: { id: { in: created.orderIds } } }),
    db.user.count({ where: { id: { in: created.ownerIds } } }),
  ]);
  if (leftovers.some(Boolean)) failures.push(`leftovers remain: ${leftovers.join(",")}`);
  if (failures.length) throw new Error(`M6-A2 cleanup failed: ${failures.join(" | ")}`);
}

try {
  const requiredFiles = [
    "src/server/logistics/kdniao-config.ts",
    "src/server/logistics/kdniao-signature.ts",
    "src/server/logistics/kdniao-response-schema.ts",
    "src/server/logistics/providers/kdniao-logistics-provider.ts",
    "src/app/api/logistics/provider-status/route.ts",
    "src/app/api/logistics/shipments/route.ts",
    "src/app/api/logistics/shipments/[id]/sync/route.ts",
    "src/components/purchases/real-logistics-card.tsx",
  ];
  for (const file of requiredFiles) assert(await fs.stat(path.join(process.cwd(), file)).then(() => true), `${file} exists`);
  const schemaSource = await fs.readFile(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  assert(!schemaSource.includes("KdniaoCredential"), "M6-A2 adds no credential model");
  const adapterSource = await fs.readFile(path.join(process.cwd(), "src/server/logistics/providers/kdniao-logistics-provider.ts"), "utf8");
  assert(!adapterSource.includes("process.env.LOGISTICS_KDNIAO_API_URL"), "provider endpoint cannot be overridden through an arbitrary URL environment variable");
  assert(!adapterSource.includes("purchaseOrder.update") && !adapterSource.includes("inventoryItem"), "provider adapter has no business-model write path");
  assert(!adapterSource.includes('itemStatus: "SOLD"'), "provider adapter introduces no SOLD write");
  const routeSources = await Promise.all(requiredFiles.filter((file) => file.includes("src/app/api")).map((file) => fs.readFile(path.join(process.cwd(), file), "utf8")));
  assert(routeSources.every((source) => !source.includes("EBusinessID") && !source.includes("APP_KEY") && !source.includes("apiUrl")), "API routes accept no provider credentials or URL");
  await serviceVerification();
  await httpAndBrowserVerification();
  await stopServer();
  await cleanup();
  console.log(`M6-A2 KDNIAO provider verification passed (${checks} checks).`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  await cleanup();
  await db.$disconnect();
}
