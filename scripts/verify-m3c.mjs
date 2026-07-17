import "dotenv/config";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { salesService } from "../src/server/sales/sales-service.ts";
import { calculateSaleProfit } from "../src/server/sales/calculateSaleProfit.ts";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const ownerId = "default-user";
const runId = Date.now();
const createdOrderIds = [];
const createdSaleOrderIds = [];
let browser;
const accessCookie = process.env.APP_PASSWORD
  ? `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}`
  : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dec(value) {
  return new Prisma.Decimal(value);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (accessCookie) headers.set("Cookie", accessCookie);
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function authenticate(page, nextPath) {
  if (!process.env.APP_PASSWORD) {
    await page.goto(`${baseUrl}${nextPath}`, { waitUntil: "networkidle" });
    return;
  }
  await page.goto(`${baseUrl}/access?next=${encodeURIComponent(nextPath)}`, { waitUntil: "networkidle" });
  await page.locator("#password").fill(process.env.APP_PASSWORD);
  await page.locator("#password").press("Enter");
  await page.waitForURL(new RegExp(`${nextPath.replaceAll("/", "\\/")}(?:\\?|$)`), { timeout: 15_000 });
}

async function assertOk(path, options = {}) {
  const { res, body } = await request(path, options);
  assert(res.ok, `${options.method ?? "GET"} ${path} should be ok, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function assertStatus(path, status, options = {}) {
  const { res, body } = await request(path, options);
  assert(res.status === status, `${options.method ?? "GET"} ${path} should return ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function createInventory({ item, sequence, inventoryCode, name, skuText, unitCost, itemStatus = "PLATFORM_LISTED" }) {
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
      inventoryCode,
      name,
      skuText,
      unitCost: dec(unitCost),
      itemStatus,
      saleMode: "DEWU_STANDARD",
      storageLocation: "M3C-A1",
      stockedAt: new Date(),
    },
  });
}

async function createSale({ status, saleNo, platform = "DEWU", soldAt, confirmedAt = null, settledAt = null, actualReceivedAmount = null, expectedIncome = null, grossAmount = "100.00", shippingCost = "0.00", otherCost = "0.00", lines, feeLines = [] }) {
  const saleOrder = await db.saleOrder.create({
    data: {
      ownerId,
      saleNo,
      platform,
      soldAt,
      confirmedAt,
      settledAt,
      actualReceivedAmount: actualReceivedAmount == null ? null : dec(actualReceivedAmount),
      expectedIncome: expectedIncome == null ? null : dec(expectedIncome),
      grossAmount: dec(grossAmount),
      shippingCost: dec(shippingCost),
      otherCost: dec(otherCost),
      status,
      lines: {
        create: lines.map((line) => ({
          ownerId,
          inventoryItemId: line.inventoryItemId,
          inventoryCodeSnapshot: line.inventoryCodeSnapshot,
          productNameSnapshot: line.productNameSnapshot,
          skuSnapshot: line.skuSnapshot ?? null,
          unitCostSnapshot: dec(line.unitCostSnapshot),
          saleAmount: dec(line.saleAmount ?? "0.00"),
          costAmount: dec(line.costAmount ?? line.unitCostSnapshot),
          profitAmount: dec(line.profitAmount ?? "0.00"),
          sourcePurchaseOrderId: line.sourcePurchaseOrderId ?? null,
          sourcePurchaseOrderItemId: line.sourcePurchaseOrderItemId ?? null,
          preSaleItemStatus: line.preSaleItemStatus ?? "PLATFORM_LISTED",
          preSaleSaleMode: "DEWU_STANDARD",
          preSaleStorageLocation: "M3C-A1",
        })),
      },
      feeLines: {
        create: feeLines.map((fee) => ({
          ownerId,
          feeType: fee.feeType,
          amount: dec(fee.amount),
          note: fee.note ?? null,
        })),
      },
    },
  });
  createdSaleOrderIds.push(saleOrder.id);
  return saleOrder;
}

try {
  await db.user.upsert({
    where: { id: ownerId },
    update: {},
    create: { id: ownerId, name: "Default User" },
  });

  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `M3C-PO-${runId}`,
      paidAt: new Date(),
      totalAmount: dec("1000.00"),
      shippingAmount: dec("0.00"),
      sellerNickname: `M3C-Seller-${runId}`,
      items: {
        create: [{
          name: "M3C Test Product",
          skuText: "M3C-SKU",
          quantity: 8,
          allocatedTotalCost: dec("1000.00"),
        }],
      },
    },
    include: { items: true },
  });
  createdOrderIds.push(order.id);
  const item = order.items[0];

  const invA = await createInventory({ item, sequence: 1, inventoryCode: `M3C-A-${runId}`, name: "M3C Bundle", skuText: "A", unitCost: "40.00" });
  const invB = await createInventory({ item, sequence: 2, inventoryCode: `M3C-B-${runId}`, name: "M3C Bundle", skuText: "B", unitCost: "60.00" });
  const invSingle = await createInventory({ item, sequence: 3, inventoryCode: `M3C-SINGLE-${runId}`, name: "M3C Single", skuText: "S", unitCost: "30.00" });
  const invDraft = await createInventory({ item, sequence: 4, inventoryCode: `M3C-DRAFT-${runId}`, name: "M3C Draft", skuText: "D", unitCost: "10.00" });
  const invCancelled = await createInventory({ item, sequence: 5, inventoryCode: `M3C-CANCEL-${runId}`, name: "M3C Cancel", skuText: "C", unitCost: "10.00" });
  const invSettled = await createInventory({ item, sequence: 6, inventoryCode: `M3C-SETTLED-${runId}`, name: "M3C Settled", skuText: "P", unitCost: "20.00" });
  const invDetail = await createInventory({ item, sequence: 7, inventoryCode: `M3C-DETAIL-${runId}`, name: "M3C Detail", skuText: "DET", unitCost: "25.00" });

  const soldAt = new Date(Date.now() - 2 * 86_400_000);
  const confirmedAt = new Date(Date.now() - 86_400_000);

  const confirmedSale = await createSale({
    status: "CONFIRMED",
    saleNo: `M3C-CONFIRMED-${runId}`,
    platform: "DEWU",
    soldAt,
    confirmedAt,
    expectedIncome: "180.00",
    grossAmount: "200.00",
    shippingCost: "10.00",
    otherCost: "5.00",
    lines: [
      {
        inventoryItemId: invA.id,
        inventoryCodeSnapshot: invA.inventoryCode,
        productNameSnapshot: invA.name,
        skuSnapshot: invA.skuText,
        unitCostSnapshot: "40.00",
        costAmount: "40.00",
        saleAmount: "80.00",
        sourcePurchaseOrderId: order.id,
        sourcePurchaseOrderItemId: item.id,
      },
      {
        inventoryItemId: invB.id,
        inventoryCodeSnapshot: invB.inventoryCode,
        productNameSnapshot: invB.name,
        skuSnapshot: invB.skuText,
        unitCostSnapshot: "60.00",
        costAmount: "60.00",
        saleAmount: "120.00",
        sourcePurchaseOrderId: order.id,
        sourcePurchaseOrderItemId: item.id,
      },
    ],
    feeLines: [{ feeType: "PLATFORM_COMMISSION", amount: "99.00" }],
  });

  const singleSale = await createSale({
    status: "CONFIRMED",
    saleNo: `M3C-SINGLE-SALE-${runId}`,
    platform: "XIANYU",
    soldAt,
    confirmedAt,
    grossAmount: "100.00",
    lines: [{
      inventoryItemId: invSingle.id,
      inventoryCodeSnapshot: invSingle.inventoryCode,
      productNameSnapshot: invSingle.name,
      skuSnapshot: invSingle.skuText,
      unitCostSnapshot: "30.00",
      costAmount: "30.00",
      saleAmount: "100.00",
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderItemId: item.id,
    }],
  });

  const draftSale = await createSale({
    status: "DRAFT",
    saleNo: `M3C-DRAFT-${runId}`,
    soldAt,
    grossAmount: "50.00",
    lines: [{
      inventoryItemId: invDraft.id,
      inventoryCodeSnapshot: invDraft.inventoryCode,
      productNameSnapshot: invDraft.name,
      skuSnapshot: invDraft.skuText,
      unitCostSnapshot: "10.00",
      costAmount: "10.00",
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderItemId: item.id,
    }],
  });

  const cancelledSale = await createSale({
    status: "CANCELLED",
    saleNo: `M3C-CANCELLED-${runId}`,
    soldAt,
    grossAmount: "50.00",
    lines: [{
      inventoryItemId: invCancelled.id,
      inventoryCodeSnapshot: invCancelled.inventoryCode,
      productNameSnapshot: invCancelled.name,
      skuSnapshot: invCancelled.skuText,
      unitCostSnapshot: "10.00",
      costAmount: "10.00",
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderItemId: item.id,
    }],
  });

  const settledSale = await createSale({
    status: "SETTLED",
    saleNo: `M3C-SETTLED-${runId}`,
    platform: "NINETY_FIVE",
    soldAt,
    confirmedAt,
    settledAt: new Date("2099-03-01T00:00:00.000Z"),
    actualReceivedAmount: "70.00",
    grossAmount: "90.00",
    lines: [{
      inventoryItemId: invSettled.id,
      inventoryCodeSnapshot: invSettled.inventoryCode,
      productNameSnapshot: invSettled.name,
      skuSnapshot: invSettled.skuText,
      unitCostSnapshot: "20.00",
      costAmount: "20.00",
      saleAmount: "90.00",
      profitAmount: "50.00",
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderItemId: item.id,
    }],
  });

  const detailSale = await createSale({
    status: "CONFIRMED",
    saleNo: `M3C-DETAIL-SALE-${runId}`,
    platform: "DEWU",
    soldAt,
    confirmedAt,
    expectedIncome: "95.00",
    grossAmount: "100.00",
    lines: [{
      inventoryItemId: invDetail.id,
      inventoryCodeSnapshot: invDetail.inventoryCode,
      productNameSnapshot: invDetail.name,
      skuSnapshot: invDetail.skuText,
      unitCostSnapshot: "25.00",
      costAmount: "25.00",
      saleAmount: "100.00",
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderItemId: item.id,
    }],
  });

  const beforeStatusA = (await db.inventoryItem.findUniqueOrThrow({ where: { id: invA.id } })).itemStatus;
  const customSettledAt = "2099-02-01T12:00:00.000Z";
  const serviceSettled = await salesService.settle(ownerId, confirmedSale.id, {
    actualReceivedAmount: "170.00",
    settledAt: customSettledAt,
    note: "M3C service note",
  });
  assert(serviceSettled.status === "SETTLED", "CONFIRMED settle -> SETTLED");
  assert(serviceSettled.settledAt?.toISOString() === customSettledAt, "settledAt is accepted");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: invA.id } })).itemStatus === beforeStatusA, "settle does not change inventory status");

  const expectedProfit = calculateSaleProfit({
    grossAmount: dec("200.00"),
    expectedIncome: dec("180.00"),
    actualReceivedAmount: dec("170.00"),
    shippingCost: dec("10.00"),
    otherCost: dec("5.00"),
    inventoryCostTotal: dec("100.00"),
    feeLinesTotal: dec("99.00"),
  }).profit;
  const settledLines = await db.saleLine.findMany({ where: { saleOrderId: confirmedSale.id }, orderBy: { inventoryCodeSnapshot: "asc" } });
  const lineProfitTotal = settledLines.reduce((sum, line) => sum.plus(line.profitAmount), dec("0.00"));
  assert(lineProfitTotal.equals(expectedProfit), `line profits should sum to ${expectedProfit}, got ${lineProfitTotal}`);
  assert(settledLines.some((line) => line.profitAmount.equals(dec("22.00"))), "multi-line profit allocated by saleAmount weight");
  assert(settledLines.some((line) => line.profitAmount.equals(dec("33.00"))), "multi-line profit tail stays balanced");
  const noteLog = await db.saleActionLog.findFirst({ where: { saleOrderId: confirmedSale.id, note: "M3C service note" } });
  assert(noteLog, "settle note is written to SaleActionLog");

  const singleSettled = await salesService.settle(ownerId, singleSale.id, { actualReceivedAmount: "88.00" });
  const singleLine = await db.saleLine.findFirstOrThrow({ where: { saleOrderId: singleSale.id } });
  assert(singleSettled.status === "SETTLED", "single sale settled");
  assert(singleLine.profitAmount.equals(dec("58.00")), `single line receives full profit, got ${singleLine.profitAmount}`);

  try {
    await salesService.settle(ownerId, draftSale.id, { actualReceivedAmount: "10.00" });
    throw new Error("DRAFT settle should fail");
  } catch (error) {
    assert(error.status === 409 || error.message.includes("NOT_CONFIRMED"), "DRAFT settle returns 409");
  }
  try {
    await salesService.settle(ownerId, cancelledSale.id, { actualReceivedAmount: "10.00" });
    throw new Error("CANCELLED settle should fail");
  } catch (error) {
    assert(error.status === 409 || error.message.includes("NOT_CONFIRMED"), "CANCELLED settle returns 409");
  }
  try {
    await salesService.settle(ownerId, settledSale.id, { actualReceivedAmount: "-1.00" });
    throw new Error("negative settle should fail");
  } catch (error) {
    assert(error.status === 400 || error.message.includes("不能小于"), "negative amount returns 400");
  }

  const firstSettledAt = (await db.saleOrder.findUniqueOrThrow({ where: { id: settledSale.id } })).settledAt.toISOString();
  const beforeSettledStatus = (await db.inventoryItem.findUniqueOrThrow({ where: { id: invSettled.id } })).itemStatus;
  await salesService.settle(ownerId, settledSale.id, { actualReceivedAmount: "75.00", settledAt: "2099-04-01T00:00:00.000Z", note: "M3C resettle note" });
  const resettled = await db.saleOrder.findUniqueOrThrow({ where: { id: settledSale.id } });
  assert(resettled.actualReceivedAmount.equals(dec("75.00")), "resettle updates actualReceivedAmount");
  assert(resettled.settledAt.toISOString() === firstSettledAt, "resettle does not overwrite first settledAt");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: invSettled.id } })).itemStatus === beforeSettledStatus, "resettle does not change inventory status");

  const listAll = await salesService.listSettlements(ownerId, { keyword: `M3C-`, settlementStatus: "ALL", page: 1, pageSize: 20 });
  assert(listAll.data.every((row) => ["CONFIRMED", "SETTLED"].includes(row.status)), "listSettlements excludes DRAFT/CANCELLED");
  const listUnsettled = await salesService.listSettlements(ownerId, { settlementStatus: "UNSETTLED", keyword: `M3C-` });
  assert(!listUnsettled.data.some((row) => row.status === "SETTLED"), "UNSETTLED list excludes SETTLED");
  const listSettled = await salesService.listSettlements(ownerId, { settlementStatus: "SETTLED", keyword: `M3C-` });
  assert(listSettled.data.some((row) => row.id === confirmedSale.id), "SETTLED list includes newly settled sale");
  assert(!listSettled.data.some((row) => row.id === draftSale.id || row.id === cancelledSale.id), "SETTLED list excludes draft/cancelled");

  const apiList = await assertOk(`/api/sales/settlements?keyword=${encodeURIComponent(`M3C-`)}&settlementStatus=ALL&page=1&pageSize=20`);
  assert(apiList.data.some((row) => row.id === confirmedSale.id), "API settlements returns settled sale");
  assert(apiList.data.every((row) => typeof row.grossAmount === "string"), "API settlement money fields are JSON-safe strings");
  await assertOk(`/api/sales/settlements?keyword=${encodeURIComponent(`M3C-`)}&settlementStatus=SETTLED`);
  await assertOk(`/api/sales/settlements?keyword=${encodeURIComponent(`M3C-`)}&settlementStatus=UNSETTLED`);
  await assertStatus("/api/sales/settlements?page=0", 400);
  await assertStatus("/api/sales/settlements?pageSize=101", 400);
  await assertStatus("/api/sales/settlements?settlementStatus=BAD", 400);

  await assertStatus(`/api/sales/${draftSale.id}/settle`, 409, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actualReceivedAmount: "10.00" }),
  });
  await assertStatus(`/api/sales/${cancelledSale.id}/settle`, 409, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actualReceivedAmount: "10.00" }),
  });
  await assertStatus(`/api/sales/${settledSale.id}/settle`, 400, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actualReceivedAmount: "-1.00" }),
  });
  await assertStatus(`/api/sales/${settledSale.id}/settle`, 400, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actualReceivedAmount: "10.00", settledAt: "not-a-date" }),
  });

  const reportSource = await fs.readFile("src/server/reports/sales-report-service.ts", "utf8");
  assert(!reportSource.includes("inventoryItem.update"), "M3-B report service remains read-only");
  assert(!reportSource.includes('itemStatus: "SOLD"'), "M3-B report service has no SOLD write");
  assert(!reportSource.includes("salesService.settle"), "M3-B report service does not settle sales");

  const salesServiceSource = await fs.readFile("src/server/sales/sales-service.ts", "utf8");
  const settleSection = salesServiceSource.slice(salesServiceSource.indexOf("async settle"), salesServiceSource.indexOf("// ===================== CANCEL"));
  assert(!settleSection.includes("inventoryItem.update"), "settle does not update inventory");
  assert(!settleSection.includes('itemStatus: "SOLD"'), "settle has no SOLD write");
  assert(!settleSection.includes("confirm("), "settle does not call confirm");
  assert(!settleSection.includes("cancel("), "settle does not call cancel");
  assert(!settleSection.includes("applyShipmentLineAction"), "settle does not call M3-0 state machine");

  const settlementsRouteSource = await fs.readFile("src/app/api/sales/settlements/route.ts", "utf8");
  assert(!settlementsRouteSource.includes("export async function POST"), "settlements API is GET-only");
  assert(!settlementsRouteSource.includes("inventoryItem.update"), "settlements API does not update inventory");
  assert(!settlementsRouteSource.includes('itemStatus: "SOLD"'), "settlements API has no SOLD write");

  const pageResponse = await fetch(`${baseUrl}/sales/settlements`, { headers: accessCookie ? { Cookie: accessCookie } : {} });
  assert(pageResponse.ok, `/sales/settlements should return 200, got ${pageResponse.status}`);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await authenticate(page, "/sales/settlements");
  await page.getByText("到账管理").first().waitFor({ timeout: 10_000 });
  await page.getByText("实际到账").first().waitFor({ timeout: 10_000 });
  const pageText = await page.locator("body").innerText();
  assert(pageText.includes("到账管理"), "settlements page title");
  assert(pageText.includes("登记到账") || pageText.includes("修改到账金额"), "settlements page shows settle action");
  const pageSource = await fs.readFile("src/components/sales/sales-settlement-page.tsx", "utf8");
  assert(!pageSource.includes("itemStatus"), "settlements page does not touch inventory itemStatus");
  assert(!pageSource.includes('itemStatus: "SOLD"'), "settlements page has no SOLD write");
  assert(!pageSource.includes("salesService.confirm"), "settlements page does not call confirm");
  assert(!pageSource.includes("salesService.cancel"), "settlements page does not call cancel");
  assert(!pageSource.includes("applyShipmentLineAction"), "settlements page does not call M3-0 state machine");
  const detailBeforeStatus = (await db.inventoryItem.findUniqueOrThrow({ where: { id: invDetail.id } })).itemStatus;
  const detailPage = await context.newPage();
  await detailPage.goto(`${baseUrl}/sales/${detailSale.id}`, { waitUntil: "networkidle" });
  await detailPage.getByText(detailSale.saleNo).first().waitFor({ timeout: 10_000 });
  const confirmedDetailText = await detailPage.locator("body").innerText();
  assert(confirmedDetailText.includes("鐧昏鍒拌处") || confirmedDetailText.includes("登记到账"), "CONFIRMED detail shows settle action");
  assert(confirmedDetailText.includes("结算状态") && confirmedDetailText.includes("实际到账") && confirmedDetailText.includes("结算时间"), "detail page shows settlement status, actual received amount, and settlement time");
  await detailPage.locator("button").filter({ hasText: /鐧昏鍒拌处|登记到账/ }).first().click();
  assert(await detailPage.locator("#actualReceivedAmount").isVisible(), "detail settle dialog includes actualReceivedAmount");
  assert(await detailPage.locator("#settledAt").isVisible(), "detail settle dialog includes settledAt");
  assert(await detailPage.locator("#settleNote").isVisible(), "detail settle dialog includes note");
  await detailPage.locator("#actualReceivedAmount").fill("91.00");
  await detailPage.locator("#settledAt").fill("2099-05-01T10:30");
  await detailPage.locator("#settleNote").fill("M3C detail page note");
  await detailPage.locator("button").filter({ hasText: /淇濆瓨鍒拌处信息|保存到账信息|纭鍒拌处|确认到账/ }).first().click();
  await detailPage.getByText(/淇敼鍒拌处信息|修改到账信息/).first().waitFor({ timeout: 10_000 });
  const detailAfter = await assertOk(`/api/sales/${detailSale.id}`);
  assert(detailAfter.status === "SETTLED", "detail page settle updates sale to SETTLED");
  assert(dec(detailAfter.actualReceivedAmount).equals(dec("91.00")), "detail page settle sends actualReceivedAmount");
  assert(detailAfter.settledAt === new Date("2099-05-01T10:30").toISOString(), "detail page settle sends settledAt");
  assert(detailAfter.actionLogs.some((log) => log.note === "M3C detail page note"), "detail page settle note is visible in actionLogs");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: invDetail.id } })).itemStatus === detailBeforeStatus, "detail page settle does not change inventory status");
  const detailSettledText = await detailPage.locator("body").innerText();
  assert(detailSettledText.includes("已到账") && /(?:¥|￥)91(?:\.00)?/.test(detailSettledText) && detailSettledText.includes("M3C detail page note"), "detail page refreshes settlement status, amount, and action log after settle");

  const detailFirstSettledAt = detailAfter.settledAt;
  const reportSummaryBeforeDetailResettle = await assertOk("/api/reports/sales");
  await detailPage.locator("button").filter({ hasText: /淇敼鍒拌处信息|修改到账信息/ }).first().click();
  assert(dec(await detailPage.locator("#actualReceivedAmount").inputValue()).equals(dec("91.00")), "resettle dialog prefills actualReceivedAmount");
  assert((await detailPage.locator("#settledAt").inputValue()).startsWith("2099-05-01T"), "resettle dialog prefills first settledAt");
  await detailPage.locator("#actualReceivedAmount").fill("92.00");
  await detailPage.locator("#settledAt").fill("2099-06-01T10:30");
  await detailPage.locator("#settleNote").fill("M3C detail page resettle note");
  await detailPage.locator("button").filter({ hasText: /淇濆瓨鍒拌处信息|保存到账信息/ }).first().click();
  await detailPage.waitForFunction(
    async (saleId) => {
      const response = await fetch(`/api/sales/${saleId}`);
      const body = await response.json();
      return body.actualReceivedAmount === "92" || body.actualReceivedAmount === "92.00";
    },
    detailSale.id,
    { timeout: 10_000 },
  );
  const detailResettled = await assertOk(`/api/sales/${detailSale.id}`);
  assert(dec(detailResettled.actualReceivedAmount).equals(dec("92.00")), "detail page resettle updates amount");
  assert(detailResettled.settledAt === detailFirstSettledAt, "detail page resettle does not overwrite first settledAt");

  const salesListAfterResettle = await assertOk(`/api/sales?q=${encodeURIComponent(detailSale.saleNo)}`);
  const salesListRow = salesListAfterResettle.data.find((sale) => sale.id === detailSale.id);
  assert(dec(salesListRow?.actualReceivedAmount).equals(dec("92.00")), "sales list returns latest actualReceivedAmount");
  assert(salesListRow?.status === "SETTLED", "sales list returns latest settlement status");

  const reportAfterResettle = await assertOk(`/api/reports/sales/orders?keyword=${encodeURIComponent(detailSale.saleNo)}`);
  const reportRow = reportAfterResettle.items.find((sale) => sale.saleOrderId === detailSale.id);
  assert(dec(reportRow?.actualReceivedAmount).equals(dec("92.00")), "sales report detail returns latest actualReceivedAmount");
  assert(dec(reportRow?.profit).equals(dec("67.00")), "sales report detail returns persisted profit");
  const reportSummaryAfterDetailResettle = await assertOk("/api/reports/sales");
  assert(
    dec(reportSummaryAfterDetailResettle.summary.actualReceivedAmountTotal)
      .minus(dec(reportSummaryBeforeDetailResettle.summary.actualReceivedAmountTotal))
      .equals(dec("1.00")),
    "sales report summary actualReceivedAmount updates after resettle",
  );
  assert(
    dec(reportSummaryAfterDetailResettle.summary.profitTotal)
      .minus(dec(reportSummaryBeforeDetailResettle.summary.profitTotal))
      .equals(dec("1.00")),
    "sales report summary profit updates after resettle",
  );

  const inventoryTraceAfterResettle = await assertOk(`/api/inventory/${invDetail.id}`);
  const inventorySaleLine = inventoryTraceAfterResettle.saleLines.find((line) => line.saleOrder.id === detailSale.id);
  assert(dec(inventorySaleLine?.saleOrder.actualReceivedAmount).equals(dec("92.00")), "inventory trace returns latest actualReceivedAmount");
  assert(dec(inventorySaleLine?.profitAmount).equals(dec("67.00")), "inventory trace returns persisted profit");

  const purchaseTraceAfterResettle = await assertOk(`/api/purchase-orders/${order.id}`);
  const purchaseInventory = purchaseTraceAfterResettle.items
    .flatMap((purchaseItem) => purchaseItem.inventoryItems)
    .find((inventoryItem) => inventoryItem.id === invDetail.id);
  const purchaseSaleLine = purchaseInventory?.saleLines.find((line) => line.saleOrder.id === detailSale.id);
  assert(dec(purchaseSaleLine?.saleOrder.actualReceivedAmount).equals(dec("92.00")), "purchase trace returns latest actualReceivedAmount");
  assert(dec(purchaseSaleLine?.profitAmount).equals(dec("67.00")), "purchase trace returns persisted profit");

  const purchaseEffectiveLines = purchaseTraceAfterResettle.items
    .flatMap((purchaseItem) => purchaseItem.inventoryItems)
    .flatMap((inventoryItem) => inventoryItem.saleLines)
    .filter((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status));
  const uniquePurchaseSales = new Map(
    purchaseEffectiveLines.map((line) => [line.saleOrder.id, line.saleOrder]),
  );
  const dedupedPurchaseActual = [...uniquePurchaseSales.values()]
    .reduce((sum, sale) => sum.plus(dec(sale.actualReceivedAmount ?? "0")), dec("0"));
  const duplicatedPurchaseActual = purchaseEffectiveLines
    .reduce((sum, line) => sum.plus(dec(line.saleOrder.actualReceivedAmount ?? "0")), dec("0"));
  assert(duplicatedPurchaseActual.greaterThan(dedupedPurchaseActual), "combined sale fixture exercises order-level amount duplication risk");

  await assertStatus(`/api/sales/${detailSale.id}/cancel`, 409, { method: "POST" });

  const settledDetailPage = await context.newPage();
  await settledDetailPage.goto(`${baseUrl}/sales/${detailSale.id}`, { waitUntil: "networkidle" });
  const settledDetailText = await settledDetailPage.locator("body").innerText();
  assert(settledDetailText.includes("淇敼鍒拌处信息") || settledDetailText.includes("修改到账信息"), "SETTLED detail shows resettle action");
  assert(settledDetailText.includes("操作日志") || settledDetailText.includes("到账日志"), "detail page shows action logs");
  const detailSource = await fs.readFile("src/components/sales/sale-detail.tsx", "utf8");
  assert(detailSource.includes("l.profitAmount") && !detailSource.includes("inventoryItem.unitCost"), "detail page uses persisted line profit instead of current inventory cost");
  assert(!detailSource.includes('itemStatus: "SOLD"') && !detailSource.includes("inventoryItem.update"), "detail page has no inventory or SOLD write path");
  assert(!detailSource.includes("applyShipmentLineAction"), "detail page does not call M3-0 state machine");
  const purchaseDetailPage = await context.newPage();
  await purchaseDetailPage.goto(`${baseUrl}/purchases/${order.id}`, { waitUntil: "networkidle" });
  const salesSummaryCard = purchaseDetailPage.getByTestId("purchase-sales-summary");
  const salesSummaryText = await salesSummaryCard.innerText();
  const expectedPurchaseActual = dedupedPurchaseActual.toFixed(2);
  const duplicatedPurchaseActualText = duplicatedPurchaseActual.toFixed(2);
  assert(
    new RegExp(`(?:\\u00a5|\\uffe5)\\s*${expectedPurchaseActual}`).test(salesSummaryText),
    "purchase summary deduplicates combined-sale actualReceivedAmount",
  );
  assert(
    !new RegExp(`(?:\\u00a5|\\uffe5)\\s*${duplicatedPurchaseActualText}`).test(salesSummaryText),
    "purchase summary does not repeat combined-sale actualReceivedAmount",
  );
  await detailPage.close();
  await settledDetailPage.close();
  await purchaseDetailPage.close();
  await context.close();

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "CONFIRMED appears in settlement workflow",
      "SETTLED appears in settlement workflow",
      "DRAFT settlement blocked with 409",
      "CANCELLED settlement blocked with 409",
      "negative actualReceivedAmount returns 400",
      "invalid settledAt returns 400",
      "settledAt can be provided",
      "settledAt defaults or preserves first settlement on resettle",
      "note is written to SaleActionLog",
      "resettle updates actualReceivedAmount",
      "settle does not change inventory status",
      "single-line profit persisted to SaleLine.profitAmount",
      "multi-line profit allocated by saleAmount",
      "line profit total equals calculateSaleProfit result",
      "GET /api/sales/settlements returns pending/settled data",
      "settlements API validates page/pageSize/settlementStatus",
      "settlements API is read-only",
      "M3-B report service remains read-only and unchanged in write paths",
      "settle has no SOLD write path",
      "/sales/settlements page renders",
      "settlements page has no direct inventory write path",
      "sales detail page renders",
      "CONFIRMED detail page shows settle action",
      "SETTLED detail page shows resettle action",
      "detail settle dialog contains amount, time, and note fields",
      "detail page shows settlement status, actual amount, and settlement time",
      "detail page settle sends settledAt and note",
      "detail page actionLogs show settlement note",
      "detail page resettle preserves first settledAt",
      "resettle dialog prefills actual amount and first settlement time",
      "detail page settle does not change inventory status",
      "detail page uses persisted line profit and has no SOLD/state-machine write path",
      "sales list returns the latest actualReceivedAmount and settlement status",
      "sales report detail returns the latest actualReceivedAmount and persisted profit",
      "sales report summary updates actualReceivedAmount and profit after resettle",
      "inventory trace returns the latest actualReceivedAmount and persisted profit",
      "purchase trace returns the latest actualReceivedAmount and persisted profit",
      "purchase summary deduplicates order-level actualReceivedAmount for combined sales",
      "SETTLED sales remain non-cancellable",
    ],
  }, null, 2));
} finally {
  try {
    if (browser) await browser.close();
    if (createdSaleOrderIds.length) {
      await db.saleActionLog.deleteMany({ where: { saleOrderId: { in: createdSaleOrderIds } } });
      await db.saleFeeLine.deleteMany({ where: { saleOrderId: { in: createdSaleOrderIds } } });
      await db.saleLine.deleteMany({ where: { saleOrderId: { in: createdSaleOrderIds } } });
      await db.saleOrder.deleteMany({ where: { id: { in: createdSaleOrderIds } } });
    }
    if (createdOrderIds.length) {
      await db.purchaseOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    const remaining = await Promise.all([
      db.saleOrder.count({ where: { id: { in: createdSaleOrderIds } } }),
      db.purchaseOrder.count({ where: { id: { in: createdOrderIds } } }),
    ]);
    if (remaining.some(Boolean)) throw new Error(`M3C cleanup left records: sales=${remaining[0]}, orders=${remaining[1]}`);
  } catch (error) {
    console.error("M3C cleanup failed", { createdSaleOrderIds, createdOrderIds, error });
    throw error;
  } finally {
    await db.$disconnect();
  }
}
