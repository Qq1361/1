import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { launchAcceptanceBrowser } from "./lib/browser-acceptance.mjs";
import { Prisma } from "../src/generated/prisma/client.ts";
import { PlatformReturnInspectionResult } from "../src/generated/prisma/enums.ts";
import { db } from "../src/server/db.ts";
import { platformReturnInspectionService } from "../src/server/platform-return-inspection/platform-return-inspection-service.ts";
import { applyShipmentLineAction } from "../src/server/shipments/applyShipmentLineAction.ts";
import { ShipmentService } from "../src/server/services/shipment-service.ts";
import { SalesService } from "../src/server/sales/sales-service.ts";
import { todoService } from "../src/server/services/todo-service.ts";

const ownerId = "default-user";
const runId = `M3D-PLATFORM-RETURN-${Date.now()}`;
let verificationBaseUrl = null;
let accessCookie = null;
let temporaryServer = null;
let temporaryServerOutput = "";
const created = {
  purchaseOrderId: null,
  extraPurchaseOrderIds: [],
  inspectionIds: [],
  inventoryIds: [],
  batchIds: [],
  lineIds: [],
  returnInspectionIds: [],
  actionLogIds: [],
  otherOwnerIds: [],
};
let checks = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

async function rejects(action, message) {
  try {
    await action();
  } catch {
    checks += 1;
    return;
  }
  throw new Error(`${message} should be rejected`);
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string" || address.port === 3000) throw new Error("Unable to allocate an independent verification port.");
  return address.port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (temporaryServer?.exitCode !== null) {
      throw new Error(`Temporary verification server exited before readiness: ${temporaryServerOutput}`);
    }
    try {
      const response = await fetch(`${url}/access`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Temporary verification server did not start: ${lastError instanceof Error ? lastError.message : temporaryServerOutput}`);
}

async function startTemporaryServer() {
  if (!process.env.APP_PASSWORD) throw new Error("APP_PASSWORD is required for platform-return HTTP verification.");
  const port = await findFreePort();
  verificationBaseUrl = `http://127.0.0.1:${port}`;
  const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  temporaryServer = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  temporaryServer.stdout.on("data", (chunk) => { temporaryServerOutput = `${temporaryServerOutput}${chunk}`.slice(-4000); });
  temporaryServer.stderr.on("data", (chunk) => { temporaryServerOutput = `${temporaryServerOutput}${chunk}`.slice(-4000); });
  await waitForServer(verificationBaseUrl);

  const login = await fetch(`${verificationBaseUrl}/api/access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }),
  });
  const setCookie = login.headers.get("set-cookie");
  if (!login.ok || !setCookie) throw new Error("Temporary verification server could not establish an access session.");
  accessCookie = setCookie.split(";")[0];
  assert(port !== 3000, "HTTP verification uses an independent temporary port");
  assert(Boolean(accessCookie), "HTTP verification establishes an access-password session");
}

async function stopTemporaryServer() {
  if (!temporaryServer || temporaryServer.exitCode !== null) return;
  try {
    if (process.platform === "win32" && temporaryServer.pid) {
      try {
        execFileSync("taskkill", ["/pid", String(temporaryServer.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } catch {
        // The server can already have exited after the final HTTP request.
      }
    } else {
      temporaryServer.kill();
    }
  } finally {
    temporaryServer.stdout.destroy();
    temporaryServer.stderr.destroy();
    temporaryServer.unref();
  }
}

async function http(pathname, options = {}) {
  const response = await fetch(`${verificationBaseUrl}${pathname}`, {
    ...options,
    headers: { ...(options.headers ?? {}), Cookie: accessCookie },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

function jsonHttp(pathname, body) {
  return http(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function decimal(value) {
  return new Prisma.Decimal(value);
}

async function createFixture() {
  const owner = await db.user.findUnique({ where: { id: ownerId } });
  assert(owner !== null, "default owner exists");

  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-PO`,
      paidAt: new Date(),
      totalAmount: decimal("400.00"),
      shippingAmount: decimal("0.00"),
      allocationStatus: "CONFIRMED",
      status: "STOCKED",
      items: {
        create: [1, 2, 3, 4].map((index) => ({
          name: `${runId}-商品-${index}`,
          skuText: `SKU-${index}`,
          quantity: 1,
          allocatedTotalCost: decimal("100.00"),
        })),
      },
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  created.purchaseOrderId = purchaseOrder.id;

  const inventory = [];
  for (const [index, item] of purchaseOrder.items.entries()) {
    const inspection = await db.inspection.create({
      data: {
        ownerId,
        purchaseOrderItemId: item.id,
        sequence: 1,
        status: "PASSED",
        result: "PASS",
        currentStep: 6,
        completedAt: new Date(),
      },
    });
    created.inspectionIds.push(inspection.id);
    const inventoryItem = await db.inventoryItem.create({
      data: {
        ownerId,
        purchaseOrderItemId: item.id,
        inspectionId: inspection.id,
        inventoryCode: `${runId}-INV-${index + 1}`,
        name: item.name,
        skuText: item.skuText,
        unitCost: decimal("100.00"),
        itemStatus: "RETURNED",
        stockedAt: new Date(),
      },
    });
    created.inventoryIds.push(inventoryItem.id);
    inventory.push(inventoryItem);
  }

  const batchA = await db.platformShipmentBatch.create({
    data: {
      ownerId,
      batchNo: `${runId}-BATCH-A`,
      platform: "DEWU",
      defaultPurpose: "DEWU_LIGHTNING_INBOUND",
      status: "COMPLETED",
    },
  });
  const batchB = await db.platformShipmentBatch.create({
    data: {
      ownerId,
      batchNo: `${runId}-BATCH-B`,
      platform: "NINETY_FIVE",
      defaultPurpose: "NINETY_FIVE_INBOUND",
      status: "COMPLETED",
    },
  });
  created.batchIds.push(batchA.id, batchB.id);

  const lines = [];
  for (const inventoryItem of inventory) {
    const line = await db.platformShipmentLine.create({
      data: {
        ownerId,
        batchId: batchA.id,
        inventoryItemId: inventoryItem.id,
        lineStatus: "RETURNED",
        inventoryCodeSnapshot: inventoryItem.inventoryCode,
        productNameSnapshot: inventoryItem.name,
        skuSnapshot: inventoryItem.skuText,
        unitCostSnapshot: inventoryItem.unitCost,
        sourcePurchaseOrderId: purchaseOrder.id,
      },
    });
    created.lineIds.push(line.id);
    lines.push(line);
  }
  const secondCycleLine = await db.platformShipmentLine.create({
    data: {
      ownerId,
      batchId: batchB.id,
      inventoryItemId: inventory[0].id,
      lineStatus: "RETURNED",
      inventoryCodeSnapshot: inventory[0].inventoryCode,
      productNameSnapshot: inventory[0].name,
      skuSnapshot: inventory[0].skuText,
      unitCostSnapshot: inventory[0].unitCost,
      sourcePurchaseOrderId: purchaseOrder.id,
    },
  });
  created.lineIds.push(secondCycleLine.id);
  return { inventory, lines, secondCycleLine };
}

async function createReturnInspection(data) {
  const inspection = await db.platformReturnInspection.create({ data });
  created.returnInspectionIds.push(inspection.id);
  return inspection;
}

function trackReturnResult(result) {
  if (!created.returnInspectionIds.includes(result.inspection.id)) created.returnInspectionIds.push(result.inspection.id);
  for (const log of result.actionLogs) {
    if (!created.actionLogIds.includes(log.id)) created.actionLogIds.push(log.id);
  }
  return result;
}

async function createServiceFixture() {
  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-SERVICE-PO`,
      paidAt: new Date(),
      totalAmount: decimal("1000.00"),
      shippingAmount: decimal("0.00"),
      allocationStatus: "CONFIRMED",
      status: "STOCKED",
      items: {
        create: Array.from({ length: 10 }, (_, index) => ({
          name: `${runId}-SERVICE-${index + 1}`,
          skuText: `SERVICE-SKU-${index + 1}`,
          quantity: 1,
          allocatedTotalCost: decimal("100.00"),
        })),
      },
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  created.extraPurchaseOrderIds.push(purchaseOrder.id);

  const batch = await db.platformShipmentBatch.create({
    data: {
      ownerId,
      batchNo: `${runId}-SERVICE-BATCH`,
      platform: "DEWU",
      defaultPurpose: "DEWU_LIGHTNING_INBOUND",
      status: "COMPLETED",
    },
  });
  created.batchIds.push(batch.id);

  const inventory = [];
  const lines = [];
  for (const [index, item] of purchaseOrder.items.entries()) {
    const inspection = await db.inspection.create({
      data: {
        ownerId,
        purchaseOrderItemId: item.id,
        sequence: 1,
        status: "PASSED",
        result: "PASS",
        currentStep: 6,
        completedAt: new Date(),
      },
    });
    created.inspectionIds.push(inspection.id);
    const inventoryItem = await db.inventoryItem.create({
      data: {
        ownerId,
        purchaseOrderItemId: item.id,
        inspectionId: inspection.id,
        inventoryCode: `${runId}-SERVICE-INV-${index + 1}`,
        name: item.name,
        skuText: item.skuText,
        unitCost: decimal("100.00"),
        itemStatus: "RETURNED",
        storageLocation: `RETURN-${index + 1}`,
        stockedAt: new Date(),
      },
    });
    created.inventoryIds.push(inventoryItem.id);
    const line = await db.platformShipmentLine.create({
      data: {
        ownerId,
        batchId: batch.id,
        inventoryItemId: inventoryItem.id,
        lineStatus: "RETURNED",
        inventoryCodeSnapshot: inventoryItem.inventoryCode,
        productNameSnapshot: inventoryItem.name,
        skuSnapshot: inventoryItem.skuText,
        unitCostSnapshot: inventoryItem.unitCost,
        sourcePurchaseOrderId: purchaseOrder.id,
      },
    });
    created.lineIds.push(line.id);
    inventory.push(inventoryItem);
    lines.push(line);
  }
  return { purchaseOrder, batch, inventory, lines };
}

async function createHttpFixture() {
  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-HTTP-PO`,
      paidAt: new Date(),
      totalAmount: decimal("800.00"),
      shippingAmount: decimal("0.00"),
      allocationStatus: "CONFIRMED",
      status: "STOCKED",
      items: { create: Array.from({ length: 10 }, (_, index) => ({ name: `${runId}-HTTP-${index + 1}`, skuText: `HTTP-SKU-${index + 1}`, quantity: 1, allocatedTotalCost: decimal("100.00") })) },
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  created.extraPurchaseOrderIds.push(purchaseOrder.id);
  const batch = await db.platformShipmentBatch.create({
    data: { ownerId, batchNo: `${runId}-HTTP-BATCH`, platform: "DEWU", defaultPurpose: "DEWU_LIGHTNING_INBOUND", status: "COMPLETED" },
  });
  created.batchIds.push(batch.id);
  const inventory = [];
  const lines = [];
  for (const [index, item] of purchaseOrder.items.entries()) {
    const inspection = await db.inspection.create({
      data: { ownerId, purchaseOrderItemId: item.id, sequence: 1, status: "PASSED", result: "PASS", currentStep: 6, completedAt: new Date() },
    });
    created.inspectionIds.push(inspection.id);
    const itemStatus = index === 3 ? "RETURNING" : index === 4 ? "STOCKED" : "RETURNED";
    const ownershipStatus = index === 5 ? "RETURNED_TO_UPSTREAM_SELLER" : "OWNED";
    const inventoryItem = await db.inventoryItem.create({
      data: {
        ownerId, purchaseOrderItemId: item.id, inspectionId: inspection.id,
        inventoryCode: `${runId}-HTTP-INV-${index + 1}`, name: item.name, skuText: item.skuText,
        unitCost: decimal("100.00"), itemStatus, ownershipStatus, stockedAt: new Date(),
      },
    });
    created.inventoryIds.push(inventoryItem.id);
    const line = await db.platformShipmentLine.create({
      data: {
        ownerId, batchId: batch.id, inventoryItemId: inventoryItem.id,
        lineStatus: index === 3 ? "RETURNING" : "RETURNED",
        inventoryCodeSnapshot: inventoryItem.inventoryCode, productNameSnapshot: inventoryItem.name,
        skuSnapshot: inventoryItem.skuText, unitCostSnapshot: inventoryItem.unitCost, sourcePurchaseOrderId: purchaseOrder.id,
        returnCarrierCode: "MOCK", returnTrackingNo: `${runId}-TRACK-${index + 1}`, returnedAt: new Date(),
      },
    });
    created.lineIds.push(line.id);
    inventory.push(inventoryItem);
    lines.push(line);
  }

  const otherOwnerId = `${runId}-OTHER-OWNER`;
  await db.user.create({ data: { id: otherOwnerId, name: "Platform return isolation fixture" } });
  created.otherOwnerIds.push(otherOwnerId);
  const otherOrder = await db.purchaseOrder.create({
    data: { ownerId: otherOwnerId, orderNo: `${runId}-OTHER-PO`, paidAt: new Date(), totalAmount: decimal("1.00"), shippingAmount: decimal("0"), items: { create: [{ name: "other", quantity: 1, allocatedTotalCost: decimal("1") }] } },
    include: { items: true },
  });
  created.extraPurchaseOrderIds.push(otherOrder.id);
  const otherInspection = await db.inspection.create({ data: { ownerId: otherOwnerId, purchaseOrderItemId: otherOrder.items[0].id, sequence: 1, status: "PASSED", result: "PASS", currentStep: 6, completedAt: new Date() } });
  const otherInventory = await db.inventoryItem.create({ data: { ownerId: otherOwnerId, purchaseOrderItemId: otherOrder.items[0].id, inspectionId: otherInspection.id, inventoryCode: `${runId}-OTHER-INV`, name: "other", unitCost: decimal("1"), itemStatus: "RETURNED", stockedAt: new Date() } });
  const otherBatch = await db.platformShipmentBatch.create({ data: { ownerId: otherOwnerId, batchNo: `${runId}-OTHER-BATCH`, platform: "OTHER", defaultPurpose: "OTHER", status: "COMPLETED" } });
  const otherLine = await db.platformShipmentLine.create({ data: { ownerId: otherOwnerId, batchId: otherBatch.id, inventoryItemId: otherInventory.id, lineStatus: "RETURNED", inventoryCodeSnapshot: otherInventory.inventoryCode, productNameSnapshot: otherInventory.name, unitCostSnapshot: otherInventory.unitCost, sourcePurchaseOrderId: otherOrder.id } });
  created.batchIds.push(otherBatch.id);
  return { batch, inventory, lines, otherOwnerId, otherLine };
}

async function createLifecycleFixture() {
  const shipmentService = new ShipmentService();
  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-LIFECYCLE-PO`,
      paidAt: new Date(),
      totalAmount: decimal("300.00"),
      shippingAmount: decimal("0.00"),
      allocationStatus: "CONFIRMED",
      status: "STOCKED",
      items: { create: [
        { name: `${runId}-LIFECYCLE-A`, skuText: "RETURN-A", quantity: 1, allocatedTotalCost: decimal("100.00") },
        { name: `${runId}-LIFECYCLE-B`, skuText: "RETURN-B", quantity: 1, allocatedTotalCost: decimal("200.00") },
      ] },
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  created.extraPurchaseOrderIds.push(purchaseOrder.id);

  const inventory = [];
  for (const [index, item] of purchaseOrder.items.entries()) {
    const inspection = await db.inspection.create({ data: { ownerId, purchaseOrderItemId: item.id, sequence: 1, status: "PASSED", result: "PASS", currentStep: 6, completedAt: new Date() } });
    created.inspectionIds.push(inspection.id);
    const inventoryItem = await db.inventoryItem.create({
      data: {
        ownerId, purchaseOrderItemId: item.id, inspectionId: inspection.id,
        inventoryCode: `${runId}-LIFECYCLE-INV-${index + 1}`, name: item.name, skuText: item.skuText,
        unitCost: decimal(index === 0 ? "100.00" : "200.00"), itemStatus: "STOCKED", stockedAt: new Date(),
      },
    });
    created.inventoryIds.push(inventoryItem.id);
    inventory.push(inventoryItem);
  }

  const firstDraft = await shipmentService.createDraft(ownerId, {
    platform: "DEWU", defaultPurpose: "DEWU_LIGHTNING_INBOUND", carrierCode: "MOCK", trackingNo: `${runId}-LIFECYCLE-1`, itemIds: inventory.map((item) => item.id),
  });
  created.batchIds.push(firstDraft.id);
  for (const line of firstDraft.lines) await shipmentService.updateLine(ownerId, line.id, { packedChecked: true });
  const firstBatch = await shipmentService.confirmShipped(ownerId, firstDraft.id);
  const firstLineA = firstBatch.lines.find((line) => line.inventoryItemId === inventory[0].id);
  const firstLineB = firstBatch.lines.find((line) => line.inventoryItemId === inventory[1].id);
  if (!firstLineA || !firstLineB) throw new Error("Lifecycle fixture lines were not created.");
  created.lineIds.push(firstLineA.id, firstLineB.id);

  const rejected = await applyShipmentLineAction(ownerId, firstLineA.id, "markRejected", { rejectedReason: "验收拒收" });
  assert(rejected.line.lineStatus === "REJECTED" && rejected.inventoryItem?.itemStatus === "PLATFORM_REJECTED", "lifecycle A reaches platform rejection through the normal shipment action");
  const returningA = await applyShipmentLineAction(ownerId, firstLineA.id, "markReturning", { returnCarrierCode: "MOCK", returnTrackingNo: `${runId}-RETURN-A` });
  assert(returningA.line.lineStatus === "RETURNING" && returningA.inventoryItem?.itemStatus === "RETURNING", "lifecycle A transitions rejection to platform return transit");
  const returnedA = await applyShipmentLineAction(ownerId, firstLineA.id, "markReturned", { returnedStorageLocation: "RETURN-A-01" });
  assert(returnedA.line.lineStatus === "RETURNED" && returnedA.inventoryItem?.itemStatus === "RETURNED", "lifecycle A transitions return transit to returned pending inspection");
  const restockedA = trackReturnResult(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: firstLineA.id, result: "RESTOCKED", storageLocation: "LOCAL-A-01" }));
  assert(restockedA.inventoryItem.itemStatus === "STOCKED" && restockedA.shipmentLine.lineStatus === "RETURNED", "lifecycle A restocks only after platform return inspection");

  const receivedB = await applyShipmentLineAction(ownerId, firstLineB.id, "markReceived");
  assert(receivedB.line.lineStatus === "RECEIVED" && receivedB.inventoryItem?.itemStatus === "PLATFORM_RECEIVED", "lifecycle B reaches platform receipt through the normal shipment action");
  const inWarehouseB = await applyShipmentLineAction(ownerId, firstLineB.id, "markInWarehouse");
  assert(inWarehouseB.line.lineStatus === "IN_WAREHOUSE" && inWarehouseB.inventoryItem?.itemStatus === "PLATFORM_IN_WAREHOUSE", "lifecycle B reaches platform warehouse before return");
  const returningB = await applyShipmentLineAction(ownerId, firstLineB.id, "markReturning", { returnCarrierCode: "MOCK", returnTrackingNo: `${runId}-RETURN-B` });
  assert(returningB.line.lineStatus === "RETURNING" && returningB.inventoryItem?.itemStatus === "RETURNING", "lifecycle B transitions platform warehouse to return transit");
  const returnedB = await applyShipmentLineAction(ownerId, firstLineB.id, "markReturned", { returnedStorageLocation: "RETURN-B-01" });
  assert(returnedB.line.lineStatus === "RETURNED" && returnedB.inventoryItem?.itemStatus === "RETURNED", "lifecycle B reaches returned pending inspection");
  const problemB = trackReturnResult(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: firstLineB.id, result: "PROBLEM", problemReason: "退回验货异常" }));
  assert(problemB.inventoryItem.itemStatus === "PROBLEM" && problemB.shipmentLine.lineStatus === "RETURNED", "lifecycle B final problem keeps the shipment return history");

  const secondDraft = await shipmentService.createDraft(ownerId, {
    platform: "NINETY_FIVE", defaultPurpose: "NINETY_FIVE_INBOUND", carrierCode: "MOCK", trackingNo: `${runId}-LIFECYCLE-2`, itemIds: [inventory[0].id],
  });
  created.batchIds.push(secondDraft.id);
  await shipmentService.updateLine(ownerId, secondDraft.lines[0].id, { packedChecked: true });
  const secondBatch = await shipmentService.confirmShipped(ownerId, secondDraft.id);
  const secondLineA = secondBatch.lines[0];
  created.lineIds.push(secondLineA.id);
  const receivedA2 = await applyShipmentLineAction(ownerId, secondLineA.id, "markReceived");
  assert(receivedA2.inventoryItem?.itemStatus === "PLATFORM_RECEIVED", "restocked inventory can start a second normal platform cycle");
  const listedA2 = await applyShipmentLineAction(ownerId, secondLineA.id, "markListed");
  assert(listedA2.line.lineStatus === "LISTED" && listedA2.inventoryItem?.itemStatus === "PLATFORM_LISTED", "second cycle reaches platform listed without becoming sold");
  const returningA2 = await applyShipmentLineAction(ownerId, secondLineA.id, "markReturning", { returnCarrierCode: "MOCK", returnTrackingNo: `${runId}-RETURN-A2` });
  assert(returningA2.inventoryItem?.itemStatus === "RETURNING", "second cycle listed inventory can enter return transit");
  const returnedA2 = await applyShipmentLineAction(ownerId, secondLineA.id, "markReturned", { returnedStorageLocation: "RETURN-A-02" });
  assert(returnedA2.inventoryItem?.itemStatus === "RETURNED", "second cycle returned inventory remains pending until inspection");
  const problemA2 = trackReturnResult(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: secondLineA.id, result: "PROBLEM", problemReason: "二次平台退回异常" }));
  assert(problemA2.inventoryItem.itemStatus === "PROBLEM" && problemA2.shipmentLine.lineStatus === "RETURNED", "second cycle can conclude as problem without erasing the first restock history");

  return { inventory, firstBatch, secondBatch, firstLineA, firstLineB, secondLineA };
}

async function verifyPlatformReturnUiFlows(httpFixture, lifecycleFixture) {
  const [cookieName, cookieValue] = accessCookie.split("=");
  const browser = await launchAcceptanceBrowser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: cookieName, value: cookieValue, url: verificationBaseUrl }]);
  const page = await context.newPage();
  try {
    await page.goto(`${verificationBaseUrl}/platform-returns?category=PENDING_INSPECTION`, { waitUntil: "networkidle" });
    assert(await page.getByRole("heading", { name: "平台退回" }).isVisible(), "platform return list page renders after authenticated navigation");
    assert(page.url().includes("category=PENDING_INSPECTION"), "platform return pending category remains in the URL");

    const restockLine = httpFixture.lines[8].id;
    await page.locator(`a[href="/platform-returns/${restockLine}"]`).first().click();
    await page.getByRole("button", { name: "退回验货" }).click();
    await page.locator("#platform-return-result").selectOption("PENDING_DECISION");
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api/platform-returns/${restockLine}/inspection`) && response.request().method() === "POST"),
      page.getByRole("button", { name: "保存验货结论" }).click(),
    ]);
    await page.getByText("待进一步判断", { exact: true }).first().waitFor({ state: "visible" });
    assert((await page.locator("body").innerText()).includes("待进一步判断"), "UI flow A shows pending decision after submission");
    await page.getByRole("button", { name: "修改验货" }).click();
    await page.locator("#platform-return-result").selectOption("RESTOCKED");
    await page.locator("#platform-return-location").fill("UI-RESTOCK-01");
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api/platform-returns/${restockLine}/inspection`) && response.request().method() === "POST"),
      page.getByRole("button", { name: "保存验货结论" }).click(),
    ]);
    await page.getByText("可重新入库", { exact: true }).first().waitFor({ state: "visible" });
    const restockedText = await page.locator("body").innerText();
    assert(restockedText.includes("可重新入库") && restockedText.includes("在库"), "UI flow A preserves returned history and shows restocked current inventory");

    const problemLine = httpFixture.lines[9].id;
    await page.goto(`${verificationBaseUrl}/platform-returns/${problemLine}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "退回验货" }).click();
    await page.locator("#platform-return-result").selectOption("PROBLEM");
    await page.locator("#platform-return-problem").fill("UI 验货发现异常");
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api/platform-returns/${problemLine}/inspection`) && response.request().method() === "POST"),
      page.getByRole("button", { name: "保存验货结论" }).click(),
    ]);
    await page.getByText("问题件", { exact: true }).first().waitFor({ state: "visible" });
    const problemText = await page.locator("body").innerText();
    assert(problemText.includes("问题件") && problemText.includes("已退回"), "UI flow B shows problem inventory while preserving returned shipment history");

    await page.goto(`${verificationBaseUrl}/platform-returns`, { waitUntil: "networkidle" });
    assert(await page.getByTestId("platform-return-summary").isVisible(), "platform-return workbench renders authoritative summary cards");
    assert((await page.locator("body").innerText()).includes("退回待处理资产"), "platform-return summary explains pending return asset scope");
    await page.reload({ waitUntil: "networkidle" });
    assert(await page.getByTestId("platform-return-summary").isVisible(), "platform-return summary remains available after refresh");

    await page.goto(`${verificationBaseUrl}/inventory/${lifecycleFixture.inventory[0].id}`, { waitUntil: "networkidle" });
    const inventoryText = await page.locator("body").innerText();
    assert(inventoryText.includes("平台寄送与退回历史") && inventoryText.includes("第 2 次平台寄送"), "inventory detail keeps both platform return cycles visible");
    assert(inventoryText.includes("问题件"), "inventory detail shows the latest platform-return conclusion without treating it as a sale");

    await page.goto(`${verificationBaseUrl}/shipments/${lifecycleFixture.secondBatch.id}`, { waitUntil: "networkidle" });
    assert(await page.getByText("查看退回详情").first().isVisible(), "shipment batch detail links returned lines to the platform-return workbench");

    await page.goto(`${verificationBaseUrl}/`, { waitUntil: "networkidle" });
    const dashboardText = await page.locator("body").innerText();
    assert(dashboardText.includes("平台退回途中") && dashboardText.includes("已退回待验货") && dashboardText.includes("待进一步判断"), "home dashboard exposes the three platform-return entry categories in Chinese");
  } finally {
    await browser.close();
  }
}

async function cleanup() {
  const failures = [];
  const remove = async (label, action) => {
    try { await action(); } catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const fixtureInspections = await db.platformReturnInspection.findMany({
    where: { shipmentLineId: { in: created.lineIds } },
    select: { id: true },
  });
  const inspectionIds = [...new Set([...created.returnInspectionIds, ...fixtureInspections.map((inspection) => inspection.id)])];
  await remove("return action logs", () => db.platformReturnActionLog.deleteMany({ where: { inspectionId: { in: inspectionIds } } }));
  await remove("return inspections", () => db.platformReturnInspection.deleteMany({ where: { id: { in: inspectionIds } } }));
  await remove("shipment batches", () => db.platformShipmentBatch.deleteMany({ where: { id: { in: created.batchIds } } }));
  await remove("purchase order", () => created.purchaseOrderId ? db.purchaseOrder.deleteMany({ where: { id: created.purchaseOrderId } }) : Promise.resolve());
  await remove("service purchase orders", () => db.purchaseOrder.deleteMany({ where: { id: { in: created.extraPurchaseOrderIds } } }));
  await remove("other owners", () => db.user.deleteMany({ where: { id: { in: created.otherOwnerIds } } }));
  if (failures.length) throw new Error(`Fixture cleanup failed: ${failures.join("; ")}`);
}

try {
  const migrationPath = path.join(process.cwd(), "prisma", "migrations", "20260715153411_add_m3d_platform_return_inspection", "migration.sql");
  const [schema, migration] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8"),
    fs.readFile(migrationPath, "utf8"),
  ]);

  assert(PlatformReturnInspectionResult.RESTOCKED === "RESTOCKED", "result enum includes RESTOCKED");
  assert(PlatformReturnInspectionResult.PROBLEM === "PROBLEM", "result enum includes PROBLEM");
  assert(PlatformReturnInspectionResult.PENDING_DECISION === "PENDING_DECISION", "result enum includes PENDING_DECISION");
  assert(schema.includes("enum PlatformReturnInspectionResult"), "uses an independent platform-return result enum");
  assert(schema.includes("model PlatformReturnInspection"), "PlatformReturnInspection model exists");
  assert(schema.includes("model PlatformReturnActionLog"), "PlatformReturnActionLog model exists");
  assert(schema.includes("ownerId         String"), "inspection has ownerId");
  assert(schema.includes("shipmentLineId  String"), "inspection has shipmentLineId");
  assert(schema.includes("inventoryItemId String"), "inspection has inventoryItemId");
  assert(schema.includes("inspectedAt     DateTime?"), "inspection has inspectedAt");
  assert(schema.includes("shipmentLineId  String                       @unique"), "shipmentLineId is globally unique");
  assert(!schema.includes("inventoryItemId String                       @unique"), "inventoryItemId is not globally unique");
  assert(schema.includes("returnInspection PlatformReturnInspection?"), "shipment line has a one-to-one inverse relation");
  assert(schema.includes("platformReturnInspections PlatformReturnInspection[]"), "inventory item has a one-to-many inverse relation");
  assert(migration.includes('platform_return_inspections_shipmentLineId_fkey') && migration.includes('REFERENCES "platform_shipment_lines"("id") ON DELETE RESTRICT'), "shipment line foreign key uses Restrict");
  assert(migration.includes('platform_return_inspections_inventoryItemId_fkey') && migration.includes('REFERENCES "inventory_items"("id") ON DELETE RESTRICT'), "inventory item foreign key uses Restrict");
  assert(migration.includes('platform_return_action_logs_inspectionId_fkey') && migration.includes('ON DELETE CASCADE ON UPDATE CASCADE'), "action logs cascade from inspections");
  assert(schema.includes("action     String"), "action log follows existing String action convention");
  assert(!schema.includes("model PlatformReturnCase"), "no PlatformReturnCase was added");
  assert(!migration.match(/\bDROP\s+(TABLE|COLUMN)\b/i), "migration contains no DROP TABLE or DROP COLUMN");
  assert(!migration.includes('ALTER TYPE "ItemStatus"'), "migration does not modify ItemStatus");
  assert(!migration.includes('InventoryOwnershipStatus'), "migration does not modify InventoryOwnershipStatus");
  assert(!migration.includes('sale_orders') && !migration.includes('refund'), "migration creates no sales or refund structures");
  assert(!migration.includes("SOLD"), "migration adds no SOLD write path");

  const { inventory, lines, secondCycleLine } = await createFixture();
  assert(lines.length === 4 && secondCycleLine.inventoryItemId === inventory[0].id, "fixture creates exact line-to-inventory cycles");
  const pending = await createReturnInspection({
    ownerId,
    shipmentLineId: lines[0].id,
    inventoryItemId: inventory[0].id,
    result: "PENDING_DECISION",
  });
  assert(pending.ownerId === ownerId && pending.shipmentLineId === lines[0].id && pending.inventoryItemId === inventory[0].id, "inspection retains the owner, line, and inventory chain");
  assert(pending.inspectedAt === null && pending.storageLocation === null && pending.problemReason === null, "PENDING_DECISION allows no final handling fields");
  await rejects(() => db.platformReturnInspection.create({ data: { ownerId, shipmentLineId: lines[0].id, inventoryItemId: inventory[0].id, result: "PENDING_DECISION" } }), "second inspection for one shipment line");

  const actionLog = await db.platformReturnActionLog.create({
    data: {
      ownerId,
      inspectionId: pending.id,
      action: "INSPECTION_RECORDED",
      fromResult: null,
      toResult: "PENDING_DECISION",
      note: "等待进一步判断",
    },
  });
  created.actionLogIds.push(actionLog.id);
  assert(actionLog.inspectionId === pending.id && actionLog.fromResult === null && actionLog.toResult === "PENDING_DECISION", "action log stores inspection result history");
  const revisedLog = await db.platformReturnActionLog.create({ data: { ownerId, inspectionId: pending.id, action: "INSPECTION_REVISED", fromResult: "PENDING_DECISION", toResult: "RESTOCKED", metadata: { runId } } });
  created.actionLogIds.push(revisedLog.id);
  assert((await db.platformReturnActionLog.count({ where: { inspectionId: pending.id } })) === 2, "one inspection can retain multiple action logs");
  await rejects(() => db.platformShipmentLine.delete({ where: { id: lines[0].id } }), "deleting a shipment line referenced by an inspection");
  await rejects(() => db.inventoryItem.delete({ where: { id: inventory[0].id } }), "deleting inventory referenced by an inspection");
  const revised = await db.platformReturnInspection.update({
    where: { id: pending.id },
    data: { result: "RESTOCKED", storageLocation: "A-01", inspectedAt: new Date() },
  });
  assert(revised.result === "RESTOCKED" && revised.storageLocation === "A-01", "PENDING_DECISION can be revised to a final result");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: inventory[0].id } })).itemStatus === "RETURNED", "inspection changes do not update inventory status");

  await rejects(() => db.platformReturnInspection.create({ data: { ownerId, shipmentLineId: lines[1].id, inventoryItemId: inventory[1].id, result: "RESTOCKED" } }), "RESTOCKED without storageLocation");
  await rejects(() => db.platformReturnInspection.create({ data: { ownerId, shipmentLineId: lines[1].id, inventoryItemId: inventory[1].id, result: "RESTOCKED", storageLocation: "   " } }), "RESTOCKED with blank storageLocation");
  const restocked = await createReturnInspection({ ownerId, shipmentLineId: lines[1].id, inventoryItemId: inventory[1].id, result: "RESTOCKED", storageLocation: "B-02" });
  assert(restocked.storageLocation === "B-02", "RESTOCKED with a storage location can be recorded");

  await rejects(() => db.platformReturnInspection.create({ data: { ownerId, shipmentLineId: lines[2].id, inventoryItemId: inventory[2].id, result: "PROBLEM" } }), "PROBLEM without reason or note");
  await rejects(() => db.platformReturnInspection.create({ data: { ownerId, shipmentLineId: lines[2].id, inventoryItemId: inventory[2].id, result: "PROBLEM", problemReason: " ", note: "  " } }), "PROBLEM with blank reason and note");
  const problemByReason = await createReturnInspection({ ownerId, shipmentLineId: lines[2].id, inventoryItemId: inventory[2].id, result: "PROBLEM", problemReason: "包装破损" });
  assert(problemByReason.problemReason === "包装破损", "PROBLEM with a reason can be recorded");
  const problemByNote = await createReturnInspection({ ownerId, shipmentLineId: lines[3].id, inventoryItemId: inventory[3].id, result: "PROBLEM", note: "待进一步处理" });
  assert(problemByNote.note === "待进一步处理", "PROBLEM with a note can be recorded");

  const secondCycle = await createReturnInspection({ ownerId, shipmentLineId: secondCycleLine.id, inventoryItemId: inventory[0].id, result: "PENDING_DECISION" });
  assert(secondCycle.inventoryItemId === pending.inventoryItemId && secondCycle.shipmentLineId !== pending.shipmentLineId, "one inventory item can retain return inspections across shipment cycles");

  const extraLog = await db.platformReturnActionLog.create({ data: { ownerId, inspectionId: restocked.id, action: "INSPECTION_RECORDED", toResult: "RESTOCKED" } });
  created.actionLogIds.push(extraLog.id);
  await db.platformReturnInspection.delete({ where: { id: restocked.id } });
  created.returnInspectionIds = created.returnInspectionIds.filter((id) => id !== restocked.id);
  assert((await db.platformReturnActionLog.count({ where: { id: extraLog.id } })) === 0, "deleting an inspection cascades its action logs");

  const [serviceSource, rulesSource, actionSource, shipmentSource, todoSource] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src/server/platform-return-inspection/platform-return-inspection-service.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/platform-return-inspection/platform-return-inspection-rules.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/shipments/applyShipmentLineAction.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/services/shipment-service.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/services/todo-service.ts"), "utf8"),
  ]);
  assert(serviceSource.includes("class PlatformReturnInspectionService"), "platform return inspection service exists");
  assert(rulesSource.includes("normalizePlatformReturnInspectionInput") && rulesSource.includes("isIdempotentInspectionRetry"), "pure platform return inspection rules exist");
  assert(todoSource.includes("PLATFORM_RETURNING") && todoSource.includes("PLATFORM_RETURNED_PENDING_INSPECTION"), "todo service has platform return todo definitions");
  assert(actionSource.includes("platformReturnInspectionService.inspectReturn"), "legacy action entry delegates to return inspection service");
  const actionRestockSection = actionSource.slice(actionSource.indexOf('actionKey === "confirmRestocked"'), actionSource.indexOf("const action = getAction"));
  assert(!actionRestockSection.includes("inventoryItem.update"), "legacy action entry no longer directly updates inventory");
  const shipmentRestockSection = shipmentSource.slice(shipmentSource.indexOf("async confirmRestocked"), shipmentSource.indexOf("async selectableItems"));
  assert(shipmentRestockSection.includes("platformReturnInspectionService.inspectReturn") && !shipmentRestockSection.includes("inventoryItem.update"), "legacy ShipmentService entry no longer directly updates inventory");

  const serviceFixture = await createServiceFixture();
  const { inventory: serviceInventory, lines: serviceLines } = serviceFixture;
  const register = (result) => trackReturnResult(result);

  const pendingFirst = register(await platformReturnInspectionService.inspectReturn({
    ownerId,
    shipmentLineId: serviceLines[0].id,
    result: "PENDING_DECISION",
  }));
  assert(pendingFirst.inspection.result === "PENDING_DECISION", "first pending decision creates inspection");
  assert(pendingFirst.inventoryItem.itemStatus === "RETURNED" && pendingFirst.shipmentLine.lineStatus === "RETURNED", "pending decision preserves returned inventory and shipment history");
  assert(pendingFirst.actionLogs.length === 1 && pendingFirst.actionLogs[0].action === "INSPECTION_RECORDED", "first pending decision writes action log");
  const pendingRetry = register(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[0].id, result: "PENDING_DECISION" }));
  assert(pendingRetry.actionLogs.length === 1, "same pending request is idempotent and does not duplicate logs");
  const pendingRevision = register(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[0].id, result: "PENDING_DECISION", note: "等待人工复核" }));
  assert(pendingRevision.actionLogs.length === 2 && pendingRevision.actionLogs.at(-1).action === "INSPECTION_REVISED", "changed pending decision writes revision log");
  const pendingRestocked = register(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[0].id, result: "RESTOCKED", storageLocation: "A-01", note: "复核通过" }));
  assert(pendingRestocked.inspection.result === "RESTOCKED" && pendingRestocked.inventoryItem.itemStatus === "STOCKED", "pending decision can atomically restock inventory");
  assert(pendingRestocked.inventoryItem.storageLocation === "A-01" && pendingRestocked.shipmentLine.lineStatus === "RETURNED", "restock updates inventory location while preserving returned shipment line");
  const finalLogCount = pendingRestocked.actionLogs.length;
  const finalRetry = register(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[0].id, result: "RESTOCKED", storageLocation: "A-01", note: "复核通过" }));
  assert(finalRetry.actionLogs.length === finalLogCount, "same final request is idempotent without a duplicate log");
  await rejects(() => platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[0].id, result: "PROBLEM", problemReason: "后续变化" }), "restocked final result changed to problem");

  const directRestocked = register(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[1].id, result: "RESTOCKED", storageLocation: "B-02" }));
  assert(directRestocked.inventoryItem.itemStatus === "STOCKED" && directRestocked.inventoryItem.storageLocation === "B-02", "first final RESTOCKED atomically restores STOCKED with location");
  const directProblem = register(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[2].id, result: "PROBLEM", problemReason: "包装破损" }));
  assert(directProblem.inventoryItem.itemStatus === "PROBLEM" && directProblem.shipmentLine.lineStatus === "RETURNED", "first final PROBLEM keeps line history and marks only inventory problem");
  const pendingProblem = register(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[3].id, result: "PENDING_DECISION" }));
  register(await platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[3].id, result: "PROBLEM", note: "缺少附件" }));
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: serviceInventory[3].id } })).itemStatus === "PROBLEM", "pending decision can atomically become problem");
  assert(pendingProblem.inspection.id !== directProblem.inspection.id, "each shipment line retains its own inspection history");

  const invalidLineId = serviceLines[4].id;
  const invalidBefore = await db.platformReturnInspection.count({ where: { shipmentLineId: invalidLineId } });
  await rejects(() => platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: invalidLineId, result: "RESTOCKED", storageLocation: "   " }), "restock without meaningful storage location");
  await rejects(() => platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: invalidLineId, result: "PROBLEM", problemReason: " ", note: " " }), "problem without reason or note");
  assert((await db.platformReturnInspection.count({ where: { shipmentLineId: invalidLineId } })) === invalidBefore, "validation failure leaves no inspection");
  assert((await db.platformReturnActionLog.count({ where: { ownerId, inspection: { shipmentLineId: invalidLineId } } })) === 0, "validation failure leaves no action log");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: serviceInventory[4].id } })).itemStatus === "RETURNED", "validation failure preserves inventory status");

  await db.inventoryItem.update({ where: { id: serviceInventory[5].id }, data: { itemStatus: "RETURNING" } });
  await db.platformShipmentLine.update({ where: { id: serviceLines[5].id }, data: { lineStatus: "RETURNING" } });
  await rejects(() => platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[5].id, result: "PENDING_DECISION" }), "non-returned shipment line");
  await rejects(() => platformReturnInspectionService.inspectReturn({ ownerId: "other-owner", shipmentLineId: serviceLines[6].id, result: "PENDING_DECISION" }), "cross-owner inspection");

  await db.inventoryItem.update({ where: { id: serviceInventory[7].id }, data: { ownershipStatus: "RETURNED_TO_UPSTREAM_SELLER" } });
  await rejects(() => platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[7].id, result: "PENDING_DECISION" }), "non-owned inventory");

  const staleBatch = await db.platformShipmentBatch.create({
    data: {
      ownerId,
      batchNo: `${runId}-STALE-CYCLE`,
      platform: "NINETY_FIVE",
      defaultPurpose: "NINETY_FIVE_INBOUND",
      status: "DRAFT",
    },
  });
  created.batchIds.push(staleBatch.id);
  const staleCycle = await db.platformShipmentLine.create({
    data: {
      ownerId,
      batchId: staleBatch.id,
      inventoryItemId: serviceInventory[8].id,
      lineStatus: "DRAFT",
      inventoryCodeSnapshot: serviceInventory[8].inventoryCode,
      productNameSnapshot: serviceInventory[8].name,
      skuSnapshot: serviceInventory[8].skuText,
      unitCostSnapshot: serviceInventory[8].unitCost,
      sourcePurchaseOrderId: serviceFixture.purchaseOrder.id,
    },
  });
  created.lineIds.push(staleCycle.id);
  await rejects(() => platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[8].id, result: "PENDING_DECISION" }), "stale return cycle");

  const concurrent = await Promise.allSettled([
    platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[9].id, result: "RESTOCKED", storageLocation: "C-03" }),
    platformReturnInspectionService.inspectReturn({ ownerId, shipmentLineId: serviceLines[9].id, result: "PROBLEM", problemReason: "并发问题" }),
  ]);
  assert(concurrent.filter((result) => result.status === "fulfilled").length === 1, "concurrent final decisions produce exactly one winner");
  const concurrentInspection = await db.platformReturnInspection.findUniqueOrThrow({ where: { shipmentLineId: serviceLines[9].id } });
  const concurrentInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: serviceInventory[9].id } });
  assert((concurrentInspection.result === "RESTOCKED" && concurrentInventory.itemStatus === "STOCKED") || (concurrentInspection.result === "PROBLEM" && concurrentInventory.itemStatus === "PROBLEM"), "concurrent final decisions cannot produce two inventory outcomes");
  created.returnInspectionIds.push(concurrentInspection.id);
  const concurrentLogs = await db.platformReturnActionLog.findMany({ where: { inspectionId: concurrentInspection.id } });
  created.actionLogIds.push(...concurrentLogs.map((log) => log.id));
  assert(concurrentLogs.length === 1, "concurrent final decisions write one authoritative action log");

  const legacyService = new ShipmentService();
  const legacyLine = await legacyService.confirmRestocked(ownerId, serviceLines[4].id, { storageLocation: "D-04", note: "旧入口兼容" });
  assert(legacyLine.inventoryItem.itemStatus === "STOCKED" && legacyLine.returnInspection?.result === "RESTOCKED", "legacy ShipmentService entry delegates through inspection");
  created.returnInspectionIds.push(legacyLine.returnInspection.id);
  created.actionLogIds.push(...legacyLine.returnInspection.actionLogs.map((log) => log.id));
  const todoResult = await todoService.list(ownerId);
  assert(todoResult.todos.some((todo) => todo.type === "PLATFORM_RETURNING" && todo.inventoryId === serviceInventory[5].id), "RETURNING inventory appears in platform return transit todos");
  assert(todoResult.todos.some((todo) => todo.type === "PLATFORM_RETURNED_PENDING_INSPECTION" && todo.inventoryId === serviceInventory[6].id), "RETURNED inventory without inspection appears in inspection todo");
  assert(!todoResult.todos.some((todo) => todo.type === "PLATFORM_RETURNED_PENDING_INSPECTION" && todo.inventoryId === serviceInventory[0].id), "RESTOCKED inventory no longer appears in return inspection todos");
  assert(!todoResult.todos.some((todo) => todo.type === "PLATFORM_RETURNED_PENDING_INSPECTION" && todo.inventoryId === serviceInventory[2].id), "PROBLEM inventory no longer appears in return inspection todos");
  assert(new Set(todoResult.todos.filter((todo) => todo.type.startsWith("PLATFORM_RETURN")).map((todo) => todo.inventoryId)).size === todoResult.todos.filter((todo) => todo.type.startsWith("PLATFORM_RETURN")).length, "platform return todos are deduplicated by inventory item");

  const salesService = new SalesService();
  await rejects(() => salesService.createDraft(ownerId, { platform: "XIANYU", soldAt: new Date().toISOString(), grossAmount: "100.00", shippingCost: "0", otherCost: "0", items: [{ inventoryItemId: serviceInventory[5].id }] }), "RETURNING inventory in sale candidates");
  await rejects(() => salesService.createDraft(ownerId, { platform: "XIANYU", soldAt: new Date().toISOString(), grossAmount: "100.00", shippingCost: "0", otherCost: "0", items: [{ inventoryItemId: serviceInventory[6].id }] }), "RETURNED inventory in sale candidates");
  const shipmentSelectable = await legacyService.selectableItems(ownerId, runId, 1, 100);
  assert(!shipmentSelectable.data.some((item) => item.id === serviceInventory[5].id || item.id === serviceInventory[6].id), "RETURNING and RETURNED inventory are excluded from shipment candidates");
  assert(shipmentSelectable.data.some((item) => item.id === serviceInventory[0].id), "RESTOCKED inventory is selectable for a new shipment cycle");
  assert(!shipmentSelectable.data.some((item) => item.id === serviceInventory[2].id), "PROBLEM inventory remains excluded from normal shipment candidates");

  const legacyAction = register(await applyShipmentLineAction(ownerId, serviceLines[6].id, "confirmRestocked", { storageLocation: "E-05", note: "动作入口兼容" }));
  assert(legacyAction.inventoryItem.itemStatus === "STOCKED" && legacyAction.inspection.result === "RESTOCKED", "legacy action entry creates inspection before restocking");

  assert(!serviceSource.includes("saleOrder.update") && !serviceSource.includes("purchaseAfterSaleCase") && !serviceSource.includes("saleAfterSaleCase"), "return inspection service does not touch sales or after-sales cases");
  assert(!serviceSource.includes('itemStatus: "SOLD"'), "return inspection service adds no SOLD write path");

  const [validationSource, querySource, listRouteSource, pendingRouteSource, summaryRouteSource, summaryServiceSource, todoSummarySource, inventoryAssetSummarySource, listPageSource, detailRouteSource, inspectionRouteSource, legacyRouteSource, detailPageSource, inspectionDialogSource, shipmentDetailSource, inventoryDetailSource, appShellSource, homePageSource] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src/server/platform-return-inspection/platform-return-inspection-validation.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/platform-return-inspection/platform-return-inspection-query.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/platform-returns/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/platform-returns/pending/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/platform-returns/summary/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/reports/platform-return-summary.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/services/todo-service.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/inventory/inventory-asset-summary.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/platform-returns/platform-return-list.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/platform-returns/[shipmentLineId]/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/platform-returns/[shipmentLineId]/inspection/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/shipments/lines/[lineId]/confirm-restocked/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/platform-returns/platform-return-detail.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/platform-returns/platform-return-inspection-dialog.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/shipments/shipment-detail.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/inventory/inventory-detail.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/layout/app-shell.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/page.tsx"), "utf8"),
  ]);
  assert(validationSource.includes("inspectPlatformReturnSchema") && validationSource.includes(".strict()"), "platform-return inspection input validation is strict");
  assert(querySource.includes("listPlatformReturns") || querySource.includes("async list("), "platform-return query DTO exists");
  assert(listRouteSource.includes("platformReturnInspectionQuery.list"), "platform-return history list API exists");
  assert(pendingRouteSource.includes("platformReturnInspectionQuery.listPending"), "platform-return pending API exists");
  assert(summaryRouteSource.includes("getPlatformReturnSummary") && !summaryRouteSource.includes("update"), "platform-return summary API delegates to a read-only aggregation service");
  assert(summaryServiceSource.includes("new Set") && summaryServiceSource.includes("totalReturnCycles") && summaryServiceSource.includes("returnLines.length"), "platform-return summary deduplicates current assets while retaining line-cycle history");
  assert(!summaryServiceSource.includes("inventoryItem.update") && !summaryServiceSource.includes('itemStatus: "SOLD"'), "platform-return summary has no inventory write or SOLD path");
  assert(summaryServiceSource.includes("unitCost") && !summaryServiceSource.includes("saleLine") && !summaryServiceSource.includes("SaleLine"), "platform-return asset cost uses inventory unit cost only");
  assert(summaryServiceSource.includes("platformReturnedPending") && summaryServiceSource.includes("platformPendingDecision"), "summary represents pending decision as a visible pending-return subset");
  assert(todoSummarySource.includes('todo.type.startsWith("PLATFORM_RETURN")') && todoSummarySource.includes("calculatePlatformReturnTodos"), "pending platform-return todos remain state-driven despite reminder history");
  assert(inventoryAssetSummarySource.includes("/api/platform-returns/summary") && inventoryAssetSummarySource.includes("未售资产合计"), "inventory dashboard consumes the shared return asset summary instead of client aggregation");
  assert(detailRouteSource.includes("platformReturnInspectionQuery.getDetail"), "platform-return detail API exists");
  assert(inspectionRouteSource.includes("platformReturnInspectionService.inspectReturn"), "platform-return write API delegates to the service");
  assert(!inspectionRouteSource.includes("inventoryItem.update") && !inspectionRouteSource.includes("platformReturnInspection.create") && !inspectionRouteSource.includes("platformShipmentLine.update"), "platform-return route contains no direct Prisma writes");
  assert(legacyRouteSource.includes("shipmentService.confirmRestocked") && legacyRouteSource.includes("Deprecation"), "legacy confirm-restocked endpoint delegates and reports deprecation");
  assert(listPageSource.includes("/api/platform-returns") && listPageSource.includes("/api/platform-returns/pending") && listPageSource.includes("/api/platform-returns/summary") && listPageSource.includes("URLSearchParams"), "platform-return list uses readonly APIs and URL-synced filters");
  assert(detailPageSource.includes("availableActions") && detailPageSource.includes("平台寄送历史事实") && detailPageSource.includes("库存当前事实") && detailPageSource.includes("操作日志"), "platform-return detail distinguishes shipment, inventory, inspection, and log facts");
  assert(inspectionDialogSource.includes("actualReceivedAmount") === false && inspectionDialogSource.includes("storageLocation") && inspectionDialogSource.includes("problemReason") && inspectionDialogSource.includes("inspectedAt"), "platform-return inspection dialog submits only inspection fields");
  assert(!inspectionDialogSource.includes("ownerId") && !inspectionDialogSource.includes("inventoryItemId") && !inspectionDialogSource.includes("itemStatus"), "platform-return inspection form does not submit authority or inventory state fields");
  assert(!shipmentDetailSource.includes('"confirm-restocked"') && shipmentDetailSource.includes("查看退回详情"), "shipment detail replaces legacy restock UI with platform-return detail links");
  assert(inventoryDetailSource.includes("平台寄送与退回历史") && inventoryDetailSource.includes("lines.map"), "inventory detail renders all platform shipment and return cycles");
  assert(appShellSource.includes('label: "平台退回"') && appShellSource.includes('href: "/platform-returns"'), "main navigation includes platform returns");
  assert(homePageSource.includes("/api/platform-returns/summary") && homePageSource.includes("待进一步判断"), "home dashboard reads the shared platform-return summary for its three entry cards");

  await startTemporaryServer();
  const summaryBeforeLifecycle = await http("/api/platform-returns/summary");
  assert(summaryBeforeLifecycle.response.status === 200, "platform-return summary API is reachable with the access session");
  assert(typeof summaryBeforeLifecycle.body.currentAssets.totalUnsold.assetCost === "string", "summary API serializes asset costs as JSON-safe strings");
  assert(summaryBeforeLifecycle.body.counts.pendingDecision <= summaryBeforeLifecycle.body.currentAssets.platformReturnedPending.count, "pending decision count is not added outside its returned-pending asset set");
  const lifecycleFixture = await createLifecycleFixture();
  const summaryAfterLifecycle = await http("/api/platform-returns/summary");
  assert(summaryAfterLifecycle.response.status === 200, "platform-return summary remains readable after lifecycle actions");
  assert(summaryAfterLifecycle.body.counts.totalReturnCycles === summaryBeforeLifecycle.body.counts.totalReturnCycles + 3, "three completed platform-return cycles increase history by shipment line, including a second cycle for one inventory item");
  assert(summaryAfterLifecycle.body.counts.restocked === summaryBeforeLifecycle.body.counts.restocked + 1, "restocked history counts the first return cycle only once");
  assert(summaryAfterLifecycle.body.counts.problem === summaryBeforeLifecycle.body.counts.problem + 2, "problem history counts both distinct final return cycles");
  assert(Number(summaryAfterLifecycle.body.assetCosts.problem) === Number(summaryBeforeLifecycle.body.assetCosts.problem) + 300, "current platform-return problem asset cost sums authoritative unit costs once per inventory item");
  assert(summaryAfterLifecycle.body.currentAssets.platformReturnProblem.count === summaryBeforeLifecycle.body.currentAssets.platformReturnProblem.count + 2, "two current problem assets are deduplicated by inventory item");
  assert(Number(summaryAfterLifecycle.body.currentAssets.totalUnsold.assetCost) === Number(summaryBeforeLifecycle.body.currentAssets.totalUnsold.assetCost) + 300, "total unsold asset cost includes the final owned problem assets without sales or refund formulas");
  assert(summaryAfterLifecycle.body.currentAssets.normalLocal.count === summaryBeforeLifecycle.body.currentAssets.normalLocal.count, "an item restocked then returned again is not left counted as normal local stock");
  const lifecycleCycles = await db.platformShipmentLine.findMany({ where: { inventoryItemId: lifecycleFixture.inventory[0].id, lineStatus: "RETURNED" }, include: { returnInspection: true } });
  assert(lifecycleCycles.length === 2, "one inventory item preserves two returned shipment-line cycles");
  assert(lifecycleCycles.some((line) => line.returnInspection?.result === "RESTOCKED") && lifecycleCycles.some((line) => line.returnInspection?.result === "PROBLEM"), "multi-cycle history preserves both restocked and problem conclusions");
  const httpFixture = await createHttpFixture();
  const [pendingBefore, listBefore] = await Promise.all([
    http(`/api/platform-returns/pending?batchId=${httpFixture.batch.id}&page=1&pageSize=20`),
    http(`/api/platform-returns?platform=DEWU&shipmentBatchId=${httpFixture.batch.id}&page=1&pageSize=20`),
  ]);
  assert(pendingBefore.response.status === 200 && pendingBefore.body.items.some((item) => item.category === "RETURNING"), "pending API includes platform returns in transit");
  assert(pendingBefore.body.items.some((item) => item.category === "PENDING_INSPECTION"), "pending API includes returned inventory without an inspection");
  assert(pendingBefore.body.total === pendingBefore.body.items.length && pendingBefore.body.page === 1, "pending API returns deduplicated paging metadata");
  assert(listBefore.response.status === 200 && listBefore.body.items.every((item) => item.platform === "DEWU"), "platform-return list filters by platform and batch");
  assert(listBefore.body.items.every((item) => typeof item.updatedAt === "string" || item.updatedAt === null), "platform-return list serializes dates as ISO strings or null");
  await verifyPlatformReturnUiFlows(httpFixture, lifecycleFixture);

  const initialDetail = await http(`/api/platform-returns/${httpFixture.lines[0].id}`);
  assert(initialDetail.response.status === 200 && initialDetail.body.inspection === null && initialDetail.body.availableActions.includes("inspectReturn"), "detail distinguishes an uninspected returned line and exposes inspect action");
  assert(initialDetail.body.shipmentLine.shipmentLineStatus === "RETURNED" && initialDetail.body.inventoryItem.currentItemStatus === "RETURNED", "detail keeps shipment history and current inventory status separate");
  const crossOwnerDetail = await http(`/api/platform-returns/${httpFixture.otherLine.id}`);
  assert(crossOwnerDetail.response.status === 404 && crossOwnerDetail.body.code === "PLATFORM_RETURN_NOT_FOUND", "cross-owner detail is a non-disclosing 404");
  const crossOwnerWrite = await jsonHttp(`/api/platform-returns/${httpFixture.otherLine.id}/inspection`, { result: "PENDING_DECISION" });
  assert(crossOwnerWrite.response.status === 404, "cross-owner inspection write is a non-disclosing 404");

  const invalidResult = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "INVALID" });
  const missingLocation = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "RESTOCKED" });
  const missingProblemReason = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "PROBLEM" });
  const invalidDate = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "PENDING_DECISION", inspectedAt: "not-a-date" });
  const forbiddenField = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "PENDING_DECISION", ownerId: "other-owner" });
  assert([invalidResult, missingLocation, missingProblemReason, invalidDate, forbiddenField].every((result) => result.response.status === 400 && result.body.code === "VALIDATION_ERROR"), "inspection API rejects invalid result, invalid fields, invalid date, missing final fields, and authority fields");
  const missingLine = await http(`/api/platform-returns/c_missing_platform_return_line`);
  assert(missingLine.response.status === 404, "unknown platform-return line is a 404");
  const returningWrite = await jsonHttp(`/api/platform-returns/${httpFixture.lines[3].id}/inspection`, { result: "PENDING_DECISION" });
  const nonReturnedInventoryWrite = await jsonHttp(`/api/platform-returns/${httpFixture.lines[4].id}/inspection`, { result: "PENDING_DECISION" });
  const nonOwnedWrite = await jsonHttp(`/api/platform-returns/${httpFixture.lines[5].id}/inspection`, { result: "PENDING_DECISION" });
  assert([returningWrite, nonReturnedInventoryWrite, nonOwnedWrite].every((result) => result.response.status === 409 && result.body.code === "PLATFORM_RETURN_STATE_CONFLICT"), "inspection API maps invalid return state and ownership to 409");

  const firstPending = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "PENDING_DECISION" });
  const samePending = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "PENDING_DECISION" });
  const changedPending = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "PENDING_DECISION", note: "等待人工复核" });
  assert(firstPending.response.status === 200 && firstPending.body.inspection.result === "PENDING_DECISION", "HTTP flow creates a pending decision");
  assert(samePending.response.status === 200 && changedPending.response.status === 200, "HTTP flow supports idempotent pending retry and pending revision");
  const pendingDetail = await http(`/api/platform-returns/${httpFixture.lines[0].id}`);
  assert(pendingDetail.body.availableActions.includes("reviseInspection") && pendingDetail.body.availableActions.includes("finalizeInspection") && pendingDetail.body.actionLogs.length === 2, "pending revision exposes revise/finalize actions without duplicate retry logs");
  const pendingCategory = await http(`/api/platform-returns/pending?category=PENDING_DECISION&batchId=${httpFixture.batch.id}`);
  assert(pendingCategory.response.status === 200 && pendingCategory.body.items.some((item) => item.shipmentLineId === httpFixture.lines[0].id), "pending API filters PENDING_DECISION entries");
  const httpRestocked = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "RESTOCKED", storageLocation: "HTTP-A-01", note: "复核通过" });
  assert(httpRestocked.response.status === 200 && httpRestocked.body.inventoryItem.currentItemStatus === "STOCKED", "HTTP pending-to-restocked restores only the inventory item");
  const restockedDetail = await http(`/api/platform-returns/${httpFixture.lines[0].id}`);
  const restockLogCount = restockedDetail.body.actionLogs.length;
  assert(restockedDetail.body.shipmentLine.shipmentLineStatus === "RETURNED" && restockedDetail.body.availableActions.length === 0, "restocked HTTP detail preserves returned shipment history and locks final result");
  const restockRetry = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "RESTOCKED", storageLocation: "HTTP-A-01", note: "复核通过" });
  const restockDifferent = await jsonHttp(`/api/platform-returns/${httpFixture.lines[0].id}/inspection`, { result: "PROBLEM", problemReason: "different" });
  const afterRestockRetry = await http(`/api/platform-returns/${httpFixture.lines[0].id}`);
  assert(restockRetry.response.status === 200 && afterRestockRetry.body.actionLogs.length === restockLogCount && restockDifferent.response.status === 409, "same final HTTP request is idempotent while different final result conflicts");

  const problem = await jsonHttp(`/api/platform-returns/${httpFixture.lines[1].id}/inspection`, { result: "PROBLEM", problemReason: "HTTP 问题件" });
  const problemDetail = await http(`/api/platform-returns/${httpFixture.lines[1].id}`);
  assert(problem.response.status === 200 && problemDetail.body.inventoryItem.currentItemStatus === "PROBLEM" && problemDetail.body.shipmentLine.shipmentLineStatus === "RETURNED", "HTTP direct problem flow preserves returned line and records problem result");
  const legacyMissingLocation = await jsonHttp(`/api/shipments/lines/${httpFixture.lines[2].id}/confirm-restocked`, {});
  const legacyRestock = await jsonHttp(`/api/shipments/lines/${httpFixture.lines[2].id}/confirm-restocked`, { storageLocation: "HTTP-LEGACY-01", note: "legacy compatible" });
  const legacyDetail = await http(`/api/platform-returns/${httpFixture.lines[2].id}`);
  assert(legacyMissingLocation.response.status === 400 && legacyRestock.response.status === 200 && legacyRestock.response.headers.get("deprecation") === "true", "legacy endpoint requires location and returns an explicit deprecation signal");
  assert(legacyDetail.body.inspection?.result === "RESTOCKED" && legacyDetail.body.actionLogs.length === 1 && legacyDetail.body.inventoryItem.currentItemStatus === "STOCKED", "legacy endpoint creates inspection and action log before restocking");

  const concurrentResults = await Promise.all([
    jsonHttp(`/api/platform-returns/${httpFixture.lines[6].id}/inspection`, { result: "RESTOCKED", storageLocation: "HTTP-CONCURRENT" }),
    jsonHttp(`/api/platform-returns/${httpFixture.lines[6].id}/inspection`, { result: "PROBLEM", problemReason: "HTTP concurrent" }),
  ]);
  assert(concurrentResults.filter((result) => result.response.status === 200).length === 1 && concurrentResults.filter((result) => result.response.status === 409).length === 1, "concurrent HTTP final decisions yield one success and one conflict");
  const pendingAfterFinals = await http(`/api/platform-returns/pending?batchId=${httpFixture.batch.id}`);
  assert(!pendingAfterFinals.body.items.some((item) => [httpFixture.lines[0].id, httpFixture.lines[1].id, httpFixture.lines[2].id].includes(item.shipmentLineId)), "pending API excludes restocked and problem inventory");
  const listStatusFilter = await http(`/api/platform-returns?shipmentBatchId=${httpFixture.batch.id}&inventoryStatus=STOCKED`);
  assert(listStatusFilter.response.status === 200 && listStatusFilter.body.items.every((item) => item.currentItemStatus === "STOCKED"), "platform-return list filters by current inventory status");
  const finalSummary = await http("/api/platform-returns/summary");
  assert(finalSummary.response.status === 200 && finalSummary.body.counts.returning >= 1, "summary includes current platform-return transit assets");
  assert(finalSummary.body.counts.pendingInspection >= 1, "summary includes returned assets awaiting a first inspection");
  assert(finalSummary.body.counts.pendingDecision >= 0 && finalSummary.body.counts.pendingDecision <= finalSummary.body.currentAssets.platformReturnedPending.count, "summary keeps pending-decision assets as a subset rather than a duplicate total");
  assert(finalSummary.body.counts.legacyDirectRestock >= 1, "summary recognizes legacy returned-plus-stocked records without creating a synthetic inspection");
  assert(Number(finalSummary.body.assetCosts.returning) >= 0 && Number(finalSummary.body.assetCosts.returnedPending) >= 0, "summary exposes decimal-safe current return asset costs");
  assert(finalSummary.body.currentAssets.platformReturning.count === finalSummary.body.counts.returning, "transit todo/category count and current return asset count share the same deduplicated inventory scope");
  assert(finalSummary.body.currentAssets.platformPendingInspection.count === finalSummary.body.counts.pendingInspection, "first-inspection todo/category count and asset count share the same scope");
  assert(finalSummary.body.currentAssets.platformPendingDecision.count === finalSummary.body.counts.pendingDecision, "pending-decision todo/category count and asset count share the same scope");
  const todosAfterFinals = await http("/api/todos");
  assert(todosAfterFinals.response.status === 200, "home todo API remains readable after platform-return inspection outcomes");
  assert(todosAfterFinals.body.counts.platformReturning === finalSummary.body.counts.returning, "home transit todo count matches the shared platform-return summary");
  assert(todosAfterFinals.body.counts.platformReturnedPendingInspection === finalSummary.body.counts.pendingInspection && todosAfterFinals.body.counts.platformReturnPendingDecision === finalSummary.body.counts.pendingDecision, `home returned-pending todo counts match the shared platform-return summary without duplicate logs (todos ${todosAfterFinals.body.counts.platformReturnedPendingInspection}/${todosAfterFinals.body.counts.platformReturnPendingDecision}, summary ${finalSummary.body.counts.pendingInspection}/${finalSummary.body.counts.pendingDecision})`);

  console.log(JSON.stringify({ ok: true, checks, runId }, null, 2));
} finally {
  let cleanupError = null;
  try { await stopTemporaryServer(); } catch (error) { cleanupError = error; }
  try { await cleanup(); } catch (error) { cleanupError = error; }
  await db.$disconnect();
  if (cleanupError) throw cleanupError;
}
