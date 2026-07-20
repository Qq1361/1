import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { launchAcceptanceBrowser } from "./lib/browser-acceptance.mjs";
import { db } from "../src/server/db.ts";

const ownerId = "default-user";
const runId = `M8-BULK-BROWSER-${Date.now()}`;
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
      // Continue polling until the temporary server is ready.
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
  const login = await fetch(`${baseUrl}/api/access`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.APP_PASSWORD }),
  });
  const setCookie = login.headers.get("set-cookie");
  if (!login.ok || !setCookie) throw new Error("Temporary browser server could not establish an access session.");
  accessCookie = setCookie.split(";")[0];
  assert(port !== 3000, "browser verification uses an independent temporary port");
  assert(Boolean(accessCookie), "browser verification establishes an access-password session");
}

async function stopServer() {
  if (!server) return;
  if (process.platform === "win32" && server.pid) {
    try {
      execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch { /* A process that exited itself is verified by the port check below. */ }
  } else if (server.exitCode === null) {
    server.kill();
  }
  server.stdout.destroy();
  server.stderr.destroy();
  server.unref();
  const port = Number(new URL(baseUrl).port);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let listenerIds = [];
    try {
      listenerIds = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`],
        { windowsHide: true },
      ).toString().trim().split(/\s+/).filter(Boolean);
    } catch {
      listenerIds = [];
    }
    if (!listenerIds.length) return;
    for (const listenerId of listenerIds) {
      // The port was allocated by this script, so a listener here is a child of this temporary verification server.
      try { execFileSync("taskkill", ["/pid", listenerId, "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* Re-check the exact listener on the next iteration. */ }
    }
    await sleep(150);
  }
  throw new Error(`Temporary browser verification port ${port} was not released.`);
}

async function jsonRequest(pathname, method, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { "content-type": "application/json", Cookie: accessCookie },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => null) };
}

async function createFixture(label, warehouseId, storageLocationId, itemStatus = "STOCKED") {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-${label}`,
      paidAt: new Date("2026-07-20T00:00:00Z"),
      totalAmount: "10.00",
      shippingAmount: "0.00",
      items: { create: { name: `${runId}-${label}`, quantity: 1 } },
    },
    include: { items: true },
  });
  created.orderIds.push(order.id);
  const inspection = await db.inspection.create({ data: { ownerId, purchaseOrderItemId: order.items[0].id, sequence: 1, status: "PENDING" } });
  created.inspectionIds.push(inspection.id);
  const inventory = await db.inventoryItem.create({
    data: {
      ownerId,
      purchaseOrderItemId: order.items[0].id,
      inspectionId: inspection.id,
      inventoryCode: `${runId}-${label}`,
      name: `${runId}-${label}`,
      unitCost: "10.00",
      itemStatus,
      ownershipStatus: "OWNED",
      stockedAt: new Date("2026-07-20T00:00:00Z"),
      warehouseId,
      storageLocationId,
      condition: "LIKE_NEW",
    },
  });
  created.inventoryIds.push(inventory.id);
  return inventory;
}

async function createBatchInspectionFixture(label, count = 1) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-${label}`,
      paidAt: new Date("2026-07-20T00:00:00Z"),
      totalAmount: `${count * 10}.00`,
      shippingAmount: "0.00",
      status: "PENDING_INSPECTION",
      allocationStatus: "CONFIRMED",
      allocationConfirmedAt: new Date(),
      items: {
        create: Array.from({ length: count }, (_, index) => ({
          name: `${runId}-${label}-${index + 1}`,
          quantity: 1,
          allocatedTotalCost: "10.00",
        })),
      },
    },
    include: { items: true },
  });
  created.orderIds.push(order.id);
  const inspections = await Promise.all(order.items.map((item) => db.inspection.create({
    data: { ownerId, purchaseOrderItemId: item.id, sequence: 1, status: "PENDING" },
  })));
  created.inspectionIds.push(...inspections.map((inspection) => inspection.id));
  return { order, inspections, itemNames: order.items.map((item) => item.name) };
}

async function waitForText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
}

async function waitForBodyText(page, text) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await page.locator("body").innerText()).includes(text)) return;
    await sleep(100);
  }
  throw new Error(`Expected page text was not rendered: ${text}`);
}

async function waitForInventories(inspectionIds) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const inventory = await db.inventoryItem.findMany({ where: { inspectionId: { in: inspectionIds } } });
    if (inventory.length === inspectionIds.length) return inventory;
    await sleep(100);
  }
  return db.inventoryItem.findMany({ where: { inspectionId: { in: inspectionIds } } });
}

async function selectAcrossPages(page) {
  await page.goto(`${baseUrl}/inventory?query=${encodeURIComponent(`${runId}-PAGE`)}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "全选当前页" }).click();
  await page.getByRole("button", { name: "下一页" }).click();
  await waitForText(page, "第 2 /");
  await page.getByRole("button", { name: "全选当前页" }).click();
  await waitForText(page, "已选择 21 件库存");
}

async function previewAndConfirm(page) {
  await page.getByRole("button", { name: "预览变更" }).click();
  await waitForText(page, "预览：将变更");
  await page.getByRole("button", { name: "确认并批量更新" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 15_000 });
  assert(!(await page.locator("body").innerText()).includes("已选择 21 件库存"), "successful batch confirmation closes the dialog and clears the selection");
}

async function completeManualBatchInspection(page, fixture, warehouse) {
  await page.goto(`${baseUrl}/inspections`, { waitUntil: "networkidle" });
  const search = page.getByPlaceholder("搜索采购订单号、商品、SKU 或卖家昵称");
  await search.fill(fixture.order.orderNo);
  await sleep(350);
  for (const name of fixture.itemNames) {
    await page.getByLabel(`选择 ${name}`).check();
  }
  await page.getByRole("button", { name: "批量验货通过" }).click();
  const dialog = page.getByRole("dialog", { name: "批量验货并入库" });
  await dialog.waitFor({ state: "visible", timeout: 15_000 });
  const common = dialog.locator("section").filter({ hasText: "应用于全部选中商品" }).first();
  const commonSelects = common.locator("select");
  assert(await commonSelects.nth(1).inputValue() === "MANUAL", "batch inspection defaults to manual storage locations");
  await commonSelects.nth(0).selectOption(warehouse.id);
  const manualInput = common.getByPlaceholder("例如 货架2-第3层");
  await manualInput.fill("货架2-第3层");
  await commonSelects.nth(2).selectOption("LIKE_NEW");
  await common.getByRole("button", { name: "应用到全部" }).click();
  const firstCard = dialog.locator("article").first();
  assert(await firstCard.locator("select").nth(0).inputValue() === warehouse.id && await firstCard.getByPlaceholder("例如 货架2-第3层").inputValue() === "货架2-第3层", "applying common manual data updates each inspection draft before submission");
  await dialog.getByRole("button", { name: "确认验货并入库" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "确认验货并入库？" });
  await confirmation.getByRole("button", { name: "确认验货并入库" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
  const inventory = await waitForInventories(fixture.inspections.map((inspection) => inspection.id));
  created.inventoryIds.push(...inventory.map((item) => item.id));
  assert(inventory.length === fixture.inspections.length && inventory.every((item) => item.warehouseId === warehouse.id && item.storageLocation === "货架2-第3层" && item.storageLocationId === null), "batch inspection UI creates one manual-location inventory record per selected inspection");
  await page.goto(`${baseUrl}/inventory?query=${encodeURIComponent(fixture.order.orderNo)}`, { waitUntil: "networkidle" });
  await waitForBodyText(page, `${warehouse.name} / 货架2-第3层`);
  assert((await page.locator("body").innerText()).includes(`${warehouse.name} / 货架2-第3层`), "inventory list displays the manual warehouse and location text after batch inspection");
}

async function verifyBrowserFlows(fixture) {
  const [cookieName, cookieValue] = accessCookie.split("=");
  const browser = await launchAcceptanceBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await context.addCookies([{ name: cookieName, value: cookieValue, url: baseUrl }]);
  try {
    await completeManualBatchInspection(page, fixture.desktopInspection, fixture.sourceWarehouse);
    await selectAcrossPages(page);
    const pageTwoText = await page.locator("body").innerText();
    assert(pageTwoText.includes("商品 21") && pageTwoText.includes("仓库 1") && pageTwoText.includes("状态 1"), "cross-page selection aggregates product, warehouse, and status statistics");
    await page.getByRole("button", { name: "上一页" }).click();
    await waitForText(page, "第 1 /");
    assert((await page.locator("body").innerText()).includes("已选择 21 件库存"), "cross-page selection remains after returning to the first page");
    await page.getByPlaceholder("搜索库存编号、商品名、SKU、库位、采购订单号、卖家昵称").fill(`${runId}-NO_MATCH`);
    await sleep(500);
    assert(!(await page.locator("body").innerText()).includes("已选择 21 件库存"), "search changes clear the accumulated selection");

    await selectAcrossPages(page);
    await page.getByRole("button", { name: "批量调整仓位" }).click();
    await page.locator("#bulk-target-warehouse").click();
    await page.getByRole("option", { name: fixture.targetWarehouse.name, exact: true }).click();
    await page.locator("#bulk-location-mode").click();
    await page.getByRole("option", { name: "标准库位", exact: true }).click();
    await page.locator("#bulk-target-location").click();
    await page.getByRole("option", { name: fixture.targetLocation.name, exact: true }).click();
    await previewAndConfirm(page);
    const moved = await db.inventoryItem.findMany({ where: { id: { in: fixture.inventoryIds } } });
    assert(moved.every((item) => item.warehouseId === fixture.targetWarehouse.id && item.storageLocationId === fixture.targetLocation.id), "location flow updates every selected fixture through preview and confirmation");
    const moveLogs = await db.inventoryItemActionLog.findMany({ where: { inventoryItemId: { in: fixture.inventoryIds }, actionType: "MOVE_LOCATION" } });
    assert(moveLogs.length === fixture.inventoryIds.length && moveLogs.every((log) => log.beforeData.warehouseName === fixture.sourceWarehouse.name && log.afterData.warehouseName === fixture.targetWarehouse.name && log.afterData.storageLocationName === fixture.targetLocation.name), "location audit snapshots retain warehouse and location names");

    await selectAcrossPages(page);
    await page.getByRole("button", { name: "批量调整仓位" }).click();
    await page.locator("#bulk-target-warehouse").click();
    await page.getByRole("option", { name: fixture.sourceWarehouse.name, exact: true }).click();
    await page.locator("#bulk-target-manual-location").fill("货架9-第2层");
    await previewAndConfirm(page);
    const manuallyMoved = await db.inventoryItem.findMany({ where: { id: { in: fixture.inventoryIds } } });
    assert(manuallyMoved.every((item) => item.warehouseId === fixture.sourceWarehouse.id && item.storageLocationId === null && item.storageLocation === "货架9-第2层"), "manual location flow clears standard locations without creating warehouse locations");
    const manualLogs = await db.inventoryItemActionLog.findMany({ where: { inventoryItemId: { in: fixture.inventoryIds }, actionType: "MOVE_LOCATION" } });
    assert(manualLogs.length === fixture.inventoryIds.length * 2 && manualLogs.some((log) => log.afterData.locationMode === "MANUAL" && log.afterData.storageLocation === "货架9-第2层"), "manual location preview and audit snapshots record the selected mode and text");

    await selectAcrossPages(page);
    await page.getByRole("button", { name: "批量设置成色" }).click();
    await page.locator("#bulk-target-condition").click();
    await page.getByRole("option", { name: "全新", exact: true }).click();
    await page.getByText("我确认跨商品或 SKU 应用相同规则", { exact: true }).click();
    await previewAndConfirm(page);
    assert((await db.inventoryItem.count({ where: { id: { in: fixture.inventoryIds }, condition: "NEW" } })) === fixture.inventoryIds.length, "condition flow completes through preview and confirmation");

    await selectAcrossPages(page);
    await page.getByRole("button", { name: "批量设置计划出售方式" }).click();
    await page.locator("#bulk-target-sale-mode").click();
    await page.getByRole("option", { name: "闲鱼", exact: true }).click();
    await previewAndConfirm(page);
    const afterSaleMode = await db.inventoryItem.findMany({ where: { id: { in: fixture.inventoryIds } } });
    assert(afterSaleMode.every((item) => item.saleMode === "XIANYU" && item.itemStatus === "STOCKED" && item.unitCost.toString() === "10"), "sale-mode flow preserves item status and cost");

    await selectAcrossPages(page);
    await page.getByRole("button", { name: "批量修正保质期" }).click();
    await page.locator("#bulk-production-date-mode").click();
    await page.getByRole("option", { name: "设置日期", exact: true }).click();
    await page.locator("#bulk-production-date").fill("2026-01-31");
    await page.locator("#bulk-shelf-life-mode").click();
    await page.getByRole("option", { name: "设置月数", exact: true }).click();
    await page.locator("#bulk-shelf-life-months").fill("1");
    await page.locator("#bulk-expiry-date-mode").click();
    await page.getByRole("option", { name: "自动计算", exact: true }).click();
    await page.locator("#bulk-shelf-reason").fill("浏览器验收：根据实物包装修正");
    await page.getByText("我确认跨商品或 SKU 应用相同规则", { exact: true }).click();
    await previewAndConfirm(page);
    assert((await db.inventoryItem.count({ where: { id: { in: fixture.inventoryIds }, expiryDate: new Date("2026-02-28T00:00:00Z") } })) === fixture.inventoryIds.length, "shelf-life flow applies the previewed calendar-month result");

    await selectAcrossPages(page);
    await page.getByRole("button", { name: "批量设置 SKU / 色号" }).click();
    await page.locator("#bulkSkuText").fill(" 2c0 ");
    await page.getByText("我确认允许跨商品批量设置", { exact: true }).click();
    await page.getByRole("button", { name: "预览变更" }).click();
    await waitForText(page, "旧 SKU：未填写；新 SKU：2C0");
    await page.getByRole("button", { name: "确认并批量更新" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 15_000 });
    const skuItems = await db.inventoryItem.findMany({ where: { id: { in: fixture.inventoryIds } } });
    assert(skuItems.every((item) => item.skuText === "2C0" && item.itemStatus === "STOCKED" && item.unitCost.toString() === "10"), "SKU flow previews normalized values and preserves status and cost");

    await page.goto(`${baseUrl}/inventory?query=${encodeURIComponent(`${runId}-LOCK`)}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "全选当前页" }).click();
    await page.getByRole("button", { name: "批量调整仓位" }).click();
    await page.locator("#bulk-target-warehouse").click();
    await page.getByRole("option", { name: fixture.sourceWarehouse.name, exact: true }).click();
    await page.locator("#bulk-location-mode").click();
    await page.getByRole("option", { name: "标准库位", exact: true }).click();
    await page.locator("#bulk-target-location").click();
    await page.getByRole("option", { name: fixture.sourceLocation.name, exact: true }).click();
    await page.getByRole("button", { name: "预览变更" }).click();
    await page.getByRole("dialog").getByText(fixture.locked.inventoryCode, { exact: false }).waitFor({ state: "visible", timeout: 15_000 });
    assert(await page.getByRole("button", { name: "确认并批量更新" }).isDisabled(), "a locked inventory item prevents any batch confirmation");
    const editableAfterLockedPreview = await db.inventoryItem.findUniqueOrThrow({ where: { id: fixture.editable.id } });
    assert(editableAfterLockedPreview.warehouseId === fixture.targetWarehouse.id, "locked batch preview performs zero writes to editable inventory");

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobile = await mobileContext.newPage();
    await mobileContext.addCookies([{ name: cookieName, value: cookieValue, url: baseUrl }]);
    try {
      await mobile.goto(`${baseUrl}/inspections`, { waitUntil: "networkidle" });
      const mobileSearch = mobile.getByPlaceholder("搜索采购订单号、商品、SKU 或卖家昵称");
      await mobileSearch.fill(fixture.mobileInspection.order.orderNo);
      await sleep(350);
      await mobile.getByLabel(`选择 ${fixture.mobileInspection.itemNames[0]}`).check();
      await mobile.getByRole("button", { name: "批量验货通过" }).click();
      const mobileInspectionDialog = mobile.getByRole("dialog", { name: "批量验货并入库" });
      await mobileInspectionDialog.waitFor({ state: "visible", timeout: 15_000 });
      const mobileCommon = mobileInspectionDialog.locator("section").filter({ hasText: "应用于全部选中商品" }).first();
      const mobileMode = mobileCommon.locator("select").nth(1);
      const mobileManualInput = mobileCommon.getByPlaceholder("例如 货架2-第3层");
      const [modeBox, inputBox] = await Promise.all([mobileMode.boundingBox(), mobileManualInput.boundingBox()]);
      assert(Boolean(modeBox && modeBox.height >= 40 && inputBox && inputBox.height >= 40), "390px batch-inspection location mode and manual input remain usable touch targets");
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390px batch-inspection dialog has no horizontal overflow");
      await mobileInspectionDialog.getByRole("button", { name: "取消" }).click();
      await mobile.goto(`${baseUrl}/inventory?query=${encodeURIComponent(`${runId}-PAGE`)}`, { waitUntil: "networkidle" });
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390px inventory list has no horizontal overflow");
      await mobile.getByRole("button", { name: "全选当前页" }).click();
      await mobile.getByRole("button", { name: "批量调整仓位" }).click();
      const manualLocationInput = mobile.locator("#bulk-target-manual-location");
      await manualLocationInput.waitFor({ state: "visible", timeout: 15_000 });
      const box = await manualLocationInput.boundingBox();
      assert(Boolean(box && box.height >= 40), "mobile manual-location input remains a usable touch target");
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390px manual-location dialog has no horizontal overflow");
    } finally {
      await mobileContext.close();
    }

  } finally {
    await context.close();
    await browser.close();
  }
}

async function cleanup() {
  if (created.inventoryIds.length) {
    await db.inventoryItemActionLog.deleteMany({ where: { inventoryItemId: { in: created.inventoryIds } } });
    await db.inventoryActionLog.deleteMany({ where: { inventoryItemId: { in: created.inventoryIds } } });
    await db.inventoryItem.deleteMany({ where: { id: { in: created.inventoryIds } } });
  }
  if (created.inspectionIds.length) await db.inspection.deleteMany({ where: { id: { in: created.inspectionIds } } });
  if (created.orderIds.length) await db.purchaseOrder.deleteMany({ where: { id: { in: created.orderIds } } });
  if (created.locationIds.length) await db.warehouseLocation.deleteMany({ where: { id: { in: created.locationIds } } });
  if (created.warehouseIds.length) await db.warehouse.deleteMany({ where: { id: { in: created.warehouseIds } } });
  const remaining = await db.inventoryItem.count({ where: { inventoryCode: { startsWith: runId } } });
  assert(remaining === 0, "browser fixture cleanup leaves zero inventory records");
}

try {
  assert(await db.user.findUnique({ where: { id: ownerId } }) !== null, "default owner exists for isolated browser fixtures");
  const sourceWarehouse = await db.warehouse.create({ data: { ownerId, name: `${runId}-SOURCE` } });
  const sourceLocation = await db.warehouseLocation.create({ data: { ownerId, warehouseId: sourceWarehouse.id, name: "A-01" } });
  const targetWarehouse = await db.warehouse.create({ data: { ownerId, name: `${runId}-TARGET` } });
  const targetLocation = await db.warehouseLocation.create({ data: { ownerId, warehouseId: targetWarehouse.id, name: "B-01" } });
  created.warehouseIds.push(sourceWarehouse.id, targetWarehouse.id);
  created.locationIds.push(sourceLocation.id, targetLocation.id);
  const inventory = [];
  for (let index = 1; index <= 21; index += 1) inventory.push(await createFixture(`PAGE-${String(index).padStart(2, "0")}`, sourceWarehouse.id, sourceLocation.id));
  const editable = await createFixture("LOCK-EDITABLE", targetWarehouse.id, targetLocation.id);
  const locked = await createFixture("LOCK-SOLD", targetWarehouse.id, targetLocation.id, "SOLD");
  const desktopInspection = await createBatchInspectionFixture("BATCH-DESKTOP", 2);
  const mobileInspection = await createBatchInspectionFixture("BATCH-MOBILE", 1);
  const fixture = { inventoryIds: inventory.map((item) => item.id), sourceWarehouse, sourceLocation, targetWarehouse, targetLocation, editable, locked, desktopInspection, mobileInspection };

  await startServer();
  const strictPreview = await jsonRequest("/api/inventory/bulk-sku", "POST", { inventoryItemIds: [inventory[0].id], skuText: "2C0", ownerId });
  assert(strictPreview.response.status >= 400 && strictPreview.response.status < 500, "SKU preview API rejects ownerId before processing a preview");
  const missingFingerprint = await jsonRequest("/api/inventory/bulk-sku", "PATCH", { inventoryItemIds: [inventory[0].id], skuText: "2C0" });
  assert(missingFingerprint.response.status === 422, "SKU confirmation API requires a preview fingerprint");
  await verifyBrowserFlows(fixture);
  const relatedCounts = await Promise.all([
    db.saleOrder.count({ where: { ownerId, saleNo: { startsWith: runId } } }),
    db.platformShipmentBatch.count({ where: { ownerId, batchNo: { startsWith: runId } } }),
  ]);
  assert(relatedCounts[0] === 0 && relatedCounts[1] === 0, "browser bulk workflows create no sales or platform-shipment records");
  console.log(`verify:m8-inventory-bulk-browser passed: ${checks} checks`);
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
