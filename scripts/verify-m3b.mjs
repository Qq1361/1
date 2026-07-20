import "dotenv/config";
import { launchAcceptanceBrowser } from "./lib/browser-acceptance.mjs";
import fs from "node:fs/promises";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { salesReportService } from "../src/server/reports/sales-report-service.ts";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const runId = Date.now();
const ownerId = `m3b-report-${runId}`;
const apiOwnerId = "default-user";
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

async function createInventory({
  itemOwnerId = ownerId,
  item,
  sequence,
  inventoryCode,
  name,
  skuText,
  unitCost,
  itemStatus = "STOCKED",
  saleMode = "NONE",
  storageLocation = "M3B-A1",
}) {
  const inspection = await db.inspection.create({
    data: {
      ownerId: itemOwnerId,
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
      ownerId: itemOwnerId,
      purchaseOrderItemId: item.id,
      inspectionId: inspection.id,
      inventoryCode,
      name,
      skuText,
      unitCost: dec(unitCost),
      itemStatus,
      saleMode,
      storageLocation,
      stockedAt: new Date(),
    },
  });
}

async function createSale({
  saleOwnerId = ownerId,
  status,
  platform,
  saleNo,
  soldAt,
  confirmedAt = null,
  settledAt = null,
  cancelledAt = null,
  grossAmount,
  expectedIncome = null,
  actualReceivedAmount = null,
  shippingCost = "0.00",
  otherCost = "0.00",
  lines,
  feeLines = [],
}) {
  const saleOrder = await db.saleOrder.create({
    data: {
      ownerId: saleOwnerId,
      saleNo,
      platform,
      soldAt,
      confirmedAt,
      settledAt,
      cancelledAt,
      grossAmount: dec(grossAmount),
      expectedIncome: expectedIncome == null ? null : dec(expectedIncome),
      actualReceivedAmount: actualReceivedAmount == null ? null : dec(actualReceivedAmount),
      shippingCost: dec(shippingCost),
      otherCost: dec(otherCost),
      status,
      lines: {
        create: lines.map((line) => ({
          ownerId: saleOwnerId,
          inventoryItemId: line.inventoryItemId,
          inventoryCodeSnapshot: line.inventoryCodeSnapshot,
          productNameSnapshot: line.productNameSnapshot,
          skuSnapshot: line.skuSnapshot ?? null,
          unitCostSnapshot: dec(line.unitCostSnapshot),
          saleAmount: dec(line.saleAmount ?? "0.00"),
          costAmount: dec(line.costAmount ?? line.unitCostSnapshot),
          profitAmount: dec(line.profitAmount),
          sourcePurchaseOrderId: line.sourcePurchaseOrderId ?? null,
          sourcePurchaseOrderItemId: line.sourcePurchaseOrderItemId ?? null,
          preSaleItemStatus: line.preSaleItemStatus ?? "STOCKED",
          preSaleSaleMode: line.preSaleSaleMode ?? "NONE",
          preSaleStorageLocation: line.preSaleStorageLocation ?? null,
        })),
      },
      feeLines: {
        create: feeLines.map((fee) => ({
          ownerId: saleOwnerId,
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

async function request(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: accessCookie ? { Cookie: accessCookie } : {} });
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

async function assertOkJson(path) {
  const { res, body } = await request(path);
  assert(res.ok, `GET ${path} should return 200, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function assertBadRequest(path) {
  const { res, body } = await request(path);
  assert(res.status === 400, `GET ${path} should return 400, got ${res.status}: ${JSON.stringify(body)}`);
  assert(typeof body?.message === "string" && body.message.length > 0, `GET ${path} should return message`);
}

try {
  await db.user.upsert({
    where: { id: ownerId },
    update: {},
    create: { id: ownerId, name: "Default User" },
  });
  await db.user.upsert({
    where: { id: apiOwnerId },
    update: {},
    create: { id: apiOwnerId, name: "Default User" },
  });

  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `M3B-PO-${runId}`,
      paidAt: new Date(),
      totalAmount: dec("1000.00"),
      shippingAmount: dec("0.00"),
      sellerNickname: `M3B卖家-${runId}`,
      items: {
        create: [{
          name: "M3B测试商品",
          skuText: "SKU-M3B",
          quantity: 8,
          allocatedTotalCost: dec("1000.00"),
        }],
      },
    },
    include: { items: true },
  });
  createdOrderIds.push(order.id);
  const item = order.items[0];

  const invDraft = await createInventory({ item, sequence: 1, inventoryCode: `M3B-DRAFT-${runId}`, name: "草稿商品", skuText: "DRAFT", unitCost: "10.00" });
  const invCancelled = await createInventory({ item, sequence: 2, inventoryCode: `M3B-CANCEL-${runId}`, name: "取消商品", skuText: "CANCEL", unitCost: "20.00" });
  const invUnsettled = await createInventory({ item, sequence: 3, inventoryCode: `M3B-UNSET-${runId}`, name: "香水A", skuText: "50ML", unitCost: "100.00" });
  const invSettled = await createInventory({ item, sequence: 4, inventoryCode: `M3B-SETTLED-${runId}`, name: "香水B", skuText: "100ML", unitCost: "80.00" });
  const invBundleA = await createInventory({ item, sequence: 5, inventoryCode: `M3B-BUNDLE-A-${runId}`, name: "套装", skuText: "B1", unitCost: "60.00" });
  const invBundleB = await createInventory({ item, sequence: 6, inventoryCode: `M3B-BUNDLE-B-${runId}`, name: "套装", skuText: "B1", unitCost: "70.00" });
  await createInventory({ item, sequence: 7, inventoryCode: `M3B-LISTED-${runId}`, name: "平台上架未售", skuText: "LISTED", unitCost: "90.00", itemStatus: "PLATFORM_LISTED" });
  const invSkuNormalizeA = await createInventory({ item, sequence: 8, inventoryCode: `M3B-SKU-A-${runId}`, name: "标准化色号", skuText: " 2c0 ", unitCost: "30.00" });
  const invSkuNormalizeB = await createInventory({ item, sequence: 9, inventoryCode: `M3B-SKU-B-${runId}`, name: "标准化色号", skuText: "2C0", unitCost: "40.00" });
  const invUnreliableLineAmount = await createInventory({ item, sequence: 10, inventoryCode: `M3B-SKU-NO-AMOUNT-${runId}`, name: "未填写行级成交价", skuText: null, unitCost: "25.00" });

  const oldDate = new Date(Date.now() - 9 * 86_400_000);
  const recentDate = new Date(Date.now() - 2 * 86_400_000);

  await createSale({
    status: "DRAFT",
    platform: "DEWU",
    saleNo: `M3B-DRAFT-${runId}`,
    soldAt: recentDate,
    grossAmount: "999.00",
    expectedIncome: "900.00",
    lines: [{
      inventoryItemId: invDraft.id,
      inventoryCodeSnapshot: invDraft.inventoryCode,
      productNameSnapshot: invDraft.name,
      skuSnapshot: invDraft.skuText,
      unitCostSnapshot: "10.00",
      costAmount: "10.00",
      saleAmount: "999.00",
      profitAmount: "890.00",
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderItemId: item.id,
    }],
  });

  await createSale({
    status: "CANCELLED",
    platform: "XIANYU",
    saleNo: `M3B-CANCELLED-${runId}`,
    soldAt: recentDate,
    cancelledAt: recentDate,
    grossAmount: "888.00",
    expectedIncome: "800.00",
    lines: [{
      inventoryItemId: invCancelled.id,
      inventoryCodeSnapshot: invCancelled.inventoryCode,
      productNameSnapshot: invCancelled.name,
      skuSnapshot: invCancelled.skuText,
      unitCostSnapshot: "20.00",
      costAmount: "20.00",
      saleAmount: "888.00",
      profitAmount: "780.00",
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderItemId: item.id,
    }],
  });

  await createSale({
    status: "CONFIRMED",
    platform: "DEWU",
    saleNo: `M3B-CONFIRMED-${runId}`,
    soldAt: oldDate,
    confirmedAt: oldDate,
    grossAmount: "200.00",
    expectedIncome: "160.00",
    actualReceivedAmount: null,
    shippingCost: "10.00",
    otherCost: "5.00",
    lines: [{
      inventoryItemId: invUnsettled.id,
      inventoryCodeSnapshot: invUnsettled.inventoryCode,
      productNameSnapshot: invUnsettled.name,
      skuSnapshot: invUnsettled.skuText,
      unitCostSnapshot: "100.00",
      costAmount: "100.00",
      saleAmount: "200.00",
      profitAmount: "45.00",
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderItemId: item.id,
    }],
    feeLines: [{ feeType: "PLATFORM_COMMISSION", amount: "20.00" }],
  });

  await createSale({
    status: "SETTLED",
    platform: "NINETY_FIVE",
    saleNo: `M3B-SETTLED-${runId}`,
    soldAt: recentDate,
    confirmedAt: recentDate,
    settledAt: recentDate,
    grossAmount: "300.00",
    expectedIncome: "260.00",
    actualReceivedAmount: "250.00",
    shippingCost: "15.00",
    otherCost: "5.00",
    lines: [{
      inventoryItemId: invSettled.id,
      inventoryCodeSnapshot: invSettled.inventoryCode,
      productNameSnapshot: invSettled.name,
      skuSnapshot: invSettled.skuText,
      unitCostSnapshot: "80.00",
      costAmount: "80.00",
      saleAmount: "300.00",
      profitAmount: "150.00",
      sourcePurchaseOrderId: order.id,
      sourcePurchaseOrderItemId: item.id,
    }],
    feeLines: [{ feeType: "AUTHENTICATION", amount: "30.00" }],
  });

  await createSale({
    status: "CONFIRMED",
    platform: "XIANYU",
    saleNo: `M3B-BUNDLE-${runId}`,
    soldAt: recentDate,
    confirmedAt: recentDate,
    grossAmount: "400.00",
    expectedIncome: null,
    actualReceivedAmount: null,
    lines: [
      {
        inventoryItemId: invBundleA.id,
        inventoryCodeSnapshot: invBundleA.inventoryCode,
        productNameSnapshot: invBundleA.name,
        skuSnapshot: invBundleA.skuText,
        unitCostSnapshot: "60.00",
        costAmount: "60.00",
        saleAmount: "190.00",
        profitAmount: "110.00",
        sourcePurchaseOrderId: order.id,
        sourcePurchaseOrderItemId: item.id,
      },
      {
        inventoryItemId: invBundleB.id,
        inventoryCodeSnapshot: invBundleB.inventoryCode,
        productNameSnapshot: invBundleB.name,
        skuSnapshot: invBundleB.skuText,
        unitCostSnapshot: "70.00",
        costAmount: "70.00",
        saleAmount: "210.00",
        profitAmount: "120.00",
        sourcePurchaseOrderId: order.id,
        sourcePurchaseOrderItemId: item.id,
      },
    ],
    feeLines: [{ feeType: "OTHER", amount: "40.00" }],
  });

  const report = await salesReportService.getSalesReportSummary({ ownerId });
  const summary = report.summary;

  assert(summary.totalOrderCount === 3, `DRAFT/CANCELLED excluded, got ${summary.totalOrderCount}`);
  assert(summary.totalSoldItemCount === 4, `sold items 4, got ${summary.totalSoldItemCount}`);
  assert(summary.grossAmountTotal === "900.00", `gross 900, got ${summary.grossAmountTotal}`);
  assert(summary.expectedIncomeTotal === "420.00", `expected 420, got ${summary.expectedIncomeTotal}`);
  assert(summary.actualReceivedAmountTotal === "250.00", `actual 250, got ${summary.actualReceivedAmountTotal}`);
  assert(summary.unsettledExpectedAmountTotal === "160.00", `unsettled expected 160, got ${summary.unsettledExpectedAmountTotal}`);
  assert(summary.inventoryCostTotal === "310.00", `cost 310, got ${summary.inventoryCostTotal}`);
  assert(summary.feeTotal === "90.00", `fees 90, got ${summary.feeTotal}`);
  assert(summary.shippingCostTotal === "25.00", `shipping 25, got ${summary.shippingCostTotal}`);
  assert(summary.otherCostTotal === "10.00", `other 10, got ${summary.otherCostTotal}`);
  assert(summary.profitTotal === "425.00", `profit 425 without duplicate fee deduction, got ${summary.profitTotal}`);
  assert(summary.unsettledOrderCount === 2, `unsettled orders 2, got ${summary.unsettledOrderCount}`);
  assert(summary.overdueUnsettledOrderCount === 1, `overdue unsettled 1, got ${summary.overdueUnsettledOrderCount}`);
  assert(summary.grossMarginRate === 1.7, `gross margin 1.7, got ${summary.grossMarginRate}`);
  assert(summary.averageProfitPerItem === 106.25, `avg profit 106.25, got ${summary.averageProfitPerItem}`);

  const dewu = report.platformBreakdown.find((row) => row.platform === "DEWU");
  const ninetyFive = report.platformBreakdown.find((row) => row.platform === "NINETY_FIVE");
  const xianyu = report.platformBreakdown.find((row) => row.platform === "XIANYU");
  assert(dewu?.orderCount === 1 && dewu.grossAmountTotal === "200.00", "DEWU platform breakdown");
  assert(ninetyFive?.orderCount === 1 && ninetyFive.actualReceivedAmountTotal === "250.00", "NINETY_FIVE platform breakdown");
  assert(xianyu?.orderCount === 1 && xianyu.soldItemCount === 2, "XIANYU platform breakdown");
  assert(!report.platformBreakdown.some((row) => row.orderCount > 0 && row.platform === "DRAFT_ONLY"), "DRAFT not in platform breakdown");

  const bundle = report.productBreakdown.find((row) => row.productName === "套装" && row.sku === "B1");
  assert(bundle?.soldItemCount === 2, `bundle count 2, got ${bundle?.soldItemCount}`);
  assert(bundle.costTotal === "130.00", `bundle cost 130, got ${bundle.costTotal}`);
  assert(bundle.profitTotal === "230.00", `bundle profit 230, got ${bundle.profitTotal}`);
  assert(bundle.averageProfitPerItem === 115, `bundle avg profit 115, got ${bundle.averageProfitPerItem}`);

  assert(report.unsettledOrders.length === 2, `unsettled list 2, got ${report.unsettledOrders.length}`);
  const overdue = report.unsettledOrders.find((row) => row.saleNo === `M3B-CONFIRMED-${runId}`);
  assert(overdue?.isOverdue === true, "old CONFIRMED unsettled is overdue");
  assert(overdue.expectedIncome === "160.00", "unsettled uses expected income, not actual received");

  const settledOnly = await salesReportService.getSalesReportSummary({ ownerId, settlementStatus: "SETTLED" });
  assert(settledOnly.summary.totalOrderCount === 1, "settlementStatus SETTLED");
  assert(settledOnly.summary.actualReceivedAmountTotal === "250.00", "SETTLED actual received");

  const unsettledOnly = await salesReportService.getSalesReportSummary({ ownerId, settlementStatus: "UNSETTLED" });
  assert(unsettledOnly.summary.totalOrderCount === 2, "settlementStatus UNSETTLED");
  assert(unsettledOnly.summary.actualReceivedAmountTotal === "0.00", "UNSETTLED actual received is zero");

  const platformOnly = await salesReportService.getSalesReportSummary({ ownerId, platform: "DEWU" });
  assert(platformOnly.summary.totalOrderCount === 1 && platformOnly.summary.grossAmountTotal === "200.00", "platform filter");

  const recentOnly = await salesReportService.getSalesReportSummary({ ownerId, dateFrom: new Date(Date.now() - 3 * 86_400_000) });
  assert(recentOnly.summary.totalOrderCount === 2, `date filter excludes old sale, got ${recentOnly.summary.totalOrderCount}`);

  const listedInventory = await db.inventoryItem.findFirst({ where: { ownerId, inventoryCode: `M3B-LISTED-${runId}` } });
  assert(listedInventory?.itemStatus === "PLATFORM_LISTED", "PLATFORM_LISTED inventory remains not SOLD and is not reported");

  await createSale({
    status: "CONFIRMED",
    platform: "DEWU",
    saleNo: `M3B-SKU-NORMALIZED-${runId}`,
    soldAt: recentDate,
    confirmedAt: recentDate,
    grossAmount: "150.00",
    lines: [
      { inventoryItemId: invSkuNormalizeA.id, inventoryCodeSnapshot: invSkuNormalizeA.inventoryCode, productNameSnapshot: invSkuNormalizeA.name, skuSnapshot: " 2c0 ", unitCostSnapshot: "30.00", costAmount: "30.00", saleAmount: "70.00", profitAmount: "40.00", sourcePurchaseOrderId: order.id, sourcePurchaseOrderItemId: item.id },
      { inventoryItemId: invSkuNormalizeB.id, inventoryCodeSnapshot: invSkuNormalizeB.inventoryCode, productNameSnapshot: invSkuNormalizeB.name, skuSnapshot: "2C0", unitCostSnapshot: "40.00", costAmount: "40.00", saleAmount: "80.00", profitAmount: "40.00", sourcePurchaseOrderId: order.id, sourcePurchaseOrderItemId: item.id },
    ],
  });
  await createSale({
    status: "CONFIRMED",
    platform: "DEWU",
    saleNo: `M3B-SKU-UNRELIABLE-${runId}`,
    soldAt: recentDate,
    confirmedAt: recentDate,
    grossAmount: "60.00",
    lines: [{ inventoryItemId: invUnreliableLineAmount.id, inventoryCodeSnapshot: invUnreliableLineAmount.inventoryCode, productNameSnapshot: invUnreliableLineAmount.name, skuSnapshot: null, unitCostSnapshot: "25.00", costAmount: "25.00", profitAmount: "35.00", sourcePurchaseOrderId: order.id, sourcePurchaseOrderItemId: item.id }],
  });

  const products = await salesReportService.getSalesReportProducts({ ownerId });
  const normalizedSku = products.items.find((row) => row.productName === "标准化色号" && row.skuText === "2C0");
  assert(normalizedSku?.orderCount === 1 && normalizedSku.soldItemCount === 2, "product report groups normalized SKU snapshots within one order");
  assert(normalizedSku?.lineSaleAmountTotal === "150.00" && normalizedSku.profitTotal === "80.00", "product report uses saved line sale/profit amounts");
  assert(normalizedSku != null && !("actualReceivedAmountTotal" in normalizedSku), "product report does not allocate order-level actual received to SKU");
  const unreliableSku = products.items.find((row) => row.productName === "未填写行级成交价" && row.skuText === null);
  assert(unreliableSku?.lineSaleAmountTotal === null && unreliableSku.profitMarginRate === null, "missing line sale amount is not presented as reliable SKU revenue");

  const source = await fs.readFile("src/server/reports/sales-report-service.ts", "utf8");
  assert(!source.includes("inventoryItem.update"), "report service must not update InventoryItem");
  assert(!source.includes('itemStatus: "SOLD"'), "report service must not write SOLD");
  assert(!source.includes("salesService.confirm"), "report service must not call SalesService.confirm");
  assert(!source.includes("salesService.cancel"), "report service must not call SalesService.cancel");
  assert(!source.includes("applyShipmentLineAction"), "report service must not call M3-0 state machine");

  // ====== API-level read-only report tests ======
  const apiOrder = await db.purchaseOrder.create({
    data: {
      ownerId: apiOwnerId,
      orderNo: `M3B-API-PO-${runId}`,
      paidAt: new Date("2099-01-01T00:00:00.000Z"),
      totalAmount: dec("500.00"),
      shippingAmount: dec("0.00"),
      sellerNickname: `M3B-API-${runId}`,
      items: {
        create: [{
          name: "M3B API 商品",
          skuText: "API-SKU",
          quantity: 5,
          allocatedTotalCost: dec("500.00"),
        }],
      },
    },
    include: { items: true },
  });
  createdOrderIds.push(apiOrder.id);
  const apiItem = apiOrder.items[0];
  const apiDraftInv = await createInventory({ itemOwnerId: apiOwnerId, item: apiItem, sequence: 1, inventoryCode: `M3B-API-DRAFT-${runId}`, name: "API草稿", skuText: "DRAFT", unitCost: "10.00" });
  const apiCancelInv = await createInventory({ itemOwnerId: apiOwnerId, item: apiItem, sequence: 2, inventoryCode: `M3B-API-CANCEL-${runId}`, name: "API取消", skuText: "CANCEL", unitCost: "20.00" });
  const apiConfirmedInv = await createInventory({ itemOwnerId: apiOwnerId, item: apiItem, sequence: 3, inventoryCode: `M3B-API-CONFIRM-${runId}`, name: "API未到账", skuText: "C1", unitCost: "40.00" });
  const apiSettledInv = await createInventory({ itemOwnerId: apiOwnerId, item: apiItem, sequence: 4, inventoryCode: `M3B-API-SETTLED-${runId}`, name: "API已到账", skuText: "S1", unitCost: "60.00" });
  await createInventory({ itemOwnerId: apiOwnerId, item: apiItem, sequence: 5, inventoryCode: `M3B-API-LISTED-${runId}`, name: "API平台上架", skuText: "L1", unitCost: "70.00", itemStatus: "PLATFORM_LISTED" });

  await createSale({
    saleOwnerId: apiOwnerId,
    status: "DRAFT",
    platform: "OTHER",
    saleNo: `M3B-API-CAOGAO-${runId}`,
    soldAt: new Date("2099-01-10T00:00:00.000Z"),
    grossAmount: "999.00",
    expectedIncome: "900.00",
    lines: [{
      inventoryItemId: apiDraftInv.id,
      inventoryCodeSnapshot: apiDraftInv.inventoryCode,
      productNameSnapshot: apiDraftInv.name,
      skuSnapshot: apiDraftInv.skuText,
      unitCostSnapshot: "10.00",
      costAmount: "10.00",
      saleAmount: "999.00",
      profitAmount: "890.00",
      sourcePurchaseOrderId: apiOrder.id,
      sourcePurchaseOrderItemId: apiItem.id,
    }],
  });
  await createSale({
    saleOwnerId: apiOwnerId,
    status: "CANCELLED",
    platform: "OTHER",
    saleNo: `M3B-API-CLOSED-${runId}`,
    soldAt: new Date("2099-01-10T00:00:00.000Z"),
    cancelledAt: new Date("2099-01-10T00:00:00.000Z"),
    grossAmount: "888.00",
    expectedIncome: "800.00",
    lines: [{
      inventoryItemId: apiCancelInv.id,
      inventoryCodeSnapshot: apiCancelInv.inventoryCode,
      productNameSnapshot: apiCancelInv.name,
      skuSnapshot: apiCancelInv.skuText,
      unitCostSnapshot: "20.00",
      costAmount: "20.00",
      saleAmount: "888.00",
      profitAmount: "780.00",
      sourcePurchaseOrderId: apiOrder.id,
      sourcePurchaseOrderItemId: apiItem.id,
    }],
  });
  await createSale({
    saleOwnerId: apiOwnerId,
    status: "CONFIRMED",
    platform: "OTHER",
    saleNo: `M3B-API-UNPAID-${runId}`,
    soldAt: new Date("2099-01-10T00:00:00.000Z"),
    confirmedAt: new Date("2099-01-10T00:00:00.000Z"),
    grossAmount: "120.00",
    expectedIncome: "100.00",
    actualReceivedAmount: null,
    lines: [{
      inventoryItemId: apiConfirmedInv.id,
      inventoryCodeSnapshot: apiConfirmedInv.inventoryCode,
      productNameSnapshot: apiConfirmedInv.name,
      skuSnapshot: apiConfirmedInv.skuText,
      unitCostSnapshot: "40.00",
      costAmount: "40.00",
      saleAmount: "120.00",
      profitAmount: "60.00",
      sourcePurchaseOrderId: apiOrder.id,
      sourcePurchaseOrderItemId: apiItem.id,
    }],
  });
  await createSale({
    saleOwnerId: apiOwnerId,
    status: "SETTLED",
    platform: "DEWU",
    saleNo: `M3B-API-PAID-${runId}`,
    soldAt: new Date("2099-01-20T00:00:00.000Z"),
    confirmedAt: new Date("2099-01-20T00:00:00.000Z"),
    settledAt: new Date("2099-01-21T00:00:00.000Z"),
    grossAmount: "220.00",
    expectedIncome: "200.00",
    actualReceivedAmount: "190.00",
    lines: [{
      inventoryItemId: apiSettledInv.id,
      inventoryCodeSnapshot: apiSettledInv.inventoryCode,
      productNameSnapshot: apiSettledInv.name,
      skuSnapshot: apiSettledInv.skuText,
      unitCostSnapshot: "60.00",
      costAmount: "60.00",
      saleAmount: "220.00",
      profitAmount: "130.00",
      sourcePurchaseOrderId: apiOrder.id,
      sourcePurchaseOrderItemId: apiItem.id,
    }],
  });

  const apiRange = `dateFrom=2099-01-01T00%3A00%3A00.000Z&dateTo=2099-01-31T23%3A59%3A59.999Z`;
  const apiReport = await assertOkJson(`/api/reports/sales?${apiRange}`);
  assert(apiReport.summary && Array.isArray(apiReport.platformBreakdown) && Array.isArray(apiReport.productBreakdown) && Array.isArray(apiReport.unsettledOrders), "API returns report shape");
  assert(apiReport.summary.totalOrderCount === 2, `API excludes DRAFT/CANCELLED, got ${apiReport.summary.totalOrderCount}`);
  assert(apiReport.summary.grossAmountTotal === "340.00", `API gross 340, got ${apiReport.summary.grossAmountTotal}`);
  assert(apiReport.summary.actualReceivedAmountTotal === "190.00", `API actual 190, got ${apiReport.summary.actualReceivedAmountTotal}`);
  assert(apiReport.summary.unsettledOrderCount === 1, "API unsettled count");
  assert(typeof apiReport.summary.grossAmountTotal === "string", "API money fields are JSON-safe strings");
  assert(apiReport.unsettledOrders.every((order) => typeof order.soldAt === "string" && (order.confirmedAt === null || typeof order.confirmedAt === "string")), "API dates are ISO strings/null");
  assert(Array.isArray(apiReport.trend) && Array.isArray(apiReport.afterSaleStatusBreakdown) && Array.isArray(apiReport.returnInspectionBreakdown), "API returns chart-ready after-sales breakdowns");
  assert(apiReport.trend.every((row) => ["originalActualReceivedAmount", "refundedAmount", "netReceivedAmount", "afterSaleNetProfit"].every((key) => typeof row[key] === "string")), "trend money fields are JSON-safe strings");
  const apiWeekly = await assertOkJson(`/api/reports/sales?${apiRange}&granularity=week`);
  assert(Array.isArray(apiWeekly.trend), "API supports chart granularity");

  const apiConfirmed = await assertOkJson(`/api/reports/sales?${apiRange}&status=CONFIRMED`);
  assert(apiConfirmed.summary.totalOrderCount === 1 && apiConfirmed.summary.actualReceivedAmountTotal === "0.00", "API status=CONFIRMED");
  const apiSettled = await assertOkJson(`/api/reports/sales?${apiRange}&status=SETTLED`);
  assert(apiSettled.summary.totalOrderCount === 1 && apiSettled.summary.actualReceivedAmountTotal === "190.00", "API status=SETTLED");
  const apiUnsettled = await assertOkJson(`/api/reports/sales?${apiRange}&settlementStatus=UNSETTLED`);
  assert(apiUnsettled.summary.totalOrderCount === 1 && apiUnsettled.summary.unsettledOrderCount === 1, "API settlementStatus=UNSETTLED");
  const apiSettledOnly = await assertOkJson(`/api/reports/sales?${apiRange}&settlementStatus=SETTLED`);
  assert(apiSettledOnly.summary.totalOrderCount === 1 && apiSettledOnly.summary.unsettledOrderCount === 0, "API settlementStatus=SETTLED");
  const apiPlatform = await assertOkJson(`/api/reports/sales?${apiRange}&platform=OTHER`);
  assert(apiPlatform.summary.totalOrderCount === 1 && apiPlatform.platformBreakdown[0]?.platform === "OTHER", "API platform filter");
  const apiDate = await assertOkJson("/api/reports/sales?dateFrom=2099-01-15T00%3A00%3A00.000Z&dateTo=2099-01-31T23%3A59%3A59.999Z");
  assert(apiDate.summary.totalOrderCount === 1 && apiDate.summary.grossAmountTotal === "220.00", "API dateFrom/dateTo filter");

  const apiOrders = await assertOkJson(`/api/reports/sales/orders?${apiRange}`);
  assert(Array.isArray(apiOrders.items) && apiOrders.pagination, "detail API returns items and pagination");
  assert(apiOrders.items.length === 2, `detail API returns 2 effective sales, got ${apiOrders.items.length}`);
  assert(apiOrders.items.every((order) => ["CONFIRMED", "SETTLED"].includes(order.status)), "detail API only returns effective sales");
  assert(!apiOrders.items.some((order) => order.saleNo.includes("CAOGAO")), "detail API excludes DRAFT");
  assert(!apiOrders.items.some((order) => order.saleNo.includes("CLOSED")), "detail API excludes CANCELLED");
  assert(apiOrders.items.every((order) => typeof order.grossAmount === "string" && typeof order.profit === "string"), "detail API money fields are JSON-safe strings");
  assert(apiOrders.items.every((order) => typeof order.soldAt === "string" && (order.settledAt === null || typeof order.settledAt === "string")), "detail API dates are ISO strings/null");

  const apiOrdersConfirmed = await assertOkJson(`/api/reports/sales/orders?${apiRange}&status=CONFIRMED`);
  assert(apiOrdersConfirmed.items.length === 1 && apiOrdersConfirmed.items[0].saleNo === `M3B-API-UNPAID-${runId}`, "detail API status=CONFIRMED");
  const apiOrdersSettled = await assertOkJson(`/api/reports/sales/orders?${apiRange}&status=SETTLED`);
  assert(apiOrdersSettled.items.length === 1 && apiOrdersSettled.items[0].saleNo === `M3B-API-PAID-${runId}`, "detail API status=SETTLED");
  const apiOrdersUnsettled = await assertOkJson(`/api/reports/sales/orders?${apiRange}&settlementStatus=UNSETTLED`);
  assert(apiOrdersUnsettled.items.length === 1 && apiOrdersUnsettled.items[0].isUnsettled === true, "detail API settlementStatus=UNSETTLED");
  const apiOrdersSettledOnly = await assertOkJson(`/api/reports/sales/orders?${apiRange}&settlementStatus=SETTLED`);
  assert(apiOrdersSettledOnly.items.length === 1 && apiOrdersSettledOnly.items[0].isSettled === true, "detail API settlementStatus=SETTLED");
  const apiOrdersPlatform = await assertOkJson(`/api/reports/sales/orders?${apiRange}&platform=DEWU`);
  assert(apiOrdersPlatform.items.length === 1 && apiOrdersPlatform.items[0].platform === "DEWU", "detail API platform filter");
  const apiOrdersKeywordSaleNo = await assertOkJson(`/api/reports/sales/orders?${apiRange}&keyword=${encodeURIComponent(`M3B-API-UNPAID-${runId}`)}`);
  assert(apiOrdersKeywordSaleNo.items.length === 1 && apiOrdersKeywordSaleNo.items[0].saleNo === `M3B-API-UNPAID-${runId}`, "detail API keyword searches saleNo");
  const apiOrdersKeywordSku = await assertOkJson(`/api/reports/sales/orders?${apiRange}&keyword=C1`);
  assert(apiOrdersKeywordSku.items.length === 1 && apiOrdersKeywordSku.items[0].itemsSummary.includes("C1"), "detail API keyword searches SKU");
  const apiOrdersPaged = await assertOkJson(`/api/reports/sales/orders?${apiRange}&page=2&pageSize=1`);
  assert(apiOrdersPaged.items.length === 1 && apiOrdersPaged.pagination.total === 2 && apiOrdersPaged.pagination.totalPages === 2, "detail API pagination");
  const apiOrdersExact = await assertOkJson(`/api/reports/sales/orders?${apiRange}&productNameExact=${encodeURIComponent("API已到账")}&skuExact=s1`);
  assert(apiOrdersExact.items.length === 1 && apiOrdersExact.items[0].saleNo === `M3B-API-PAID-${runId}`, "detail API exact product/SKU filters use sales snapshots");

  const apiProducts = await assertOkJson(`/api/reports/sales/products?${apiRange}`);
  assert(Array.isArray(apiProducts.items) && apiProducts.pagination, "product report API returns items and pagination");
  assert(apiProducts.items.length === 2 && apiProducts.items.every((row) => typeof row.inventoryCostTotal === "string" && typeof row.profitTotal === "string"), "product report API excludes DRAFT/CANCELLED and returns JSON-safe amounts");
  assert(apiProducts.items.every((row) => !("actualReceivedAmountTotal" in row)), "product report API does not expose unreliable SKU actual received allocations");
  const apiProductsSettled = await assertOkJson(`/api/reports/sales/products?${apiRange}&status=SETTLED`);
  assert(apiProductsSettled.items.length === 1 && apiProductsSettled.items[0].productName === "API已到账", "product report API status filter");
  const apiProductsKeyword = await assertOkJson(`/api/reports/sales/products?${apiRange}&keyword=S1`);
  assert(apiProductsKeyword.items.length === 1 && apiProductsKeyword.items[0].skuText === "S1", "product report API searches SKU snapshots");

  await assertBadRequest("/api/reports/sales?status=DRAFT");
  await assertBadRequest("/api/reports/sales?settlementStatus=BAD");
  await assertBadRequest("/api/reports/sales?dateFrom=not-a-date");
  await assertBadRequest("/api/reports/sales?dateFrom=2099-02-01T00%3A00%3A00.000Z&dateTo=2099-01-01T00%3A00%3A00.000Z");
  await assertBadRequest("/api/reports/sales/orders?status=DRAFT");
  await assertBadRequest("/api/reports/sales/orders?settlementStatus=BAD");
  await assertBadRequest("/api/reports/sales/orders?dateFrom=not-a-date");
  await assertBadRequest("/api/reports/sales/orders?dateFrom=2099-02-01T00%3A00%3A00.000Z&dateTo=2099-01-01T00%3A00%3A00.000Z");
  await assertBadRequest("/api/reports/sales/orders?page=0");
  await assertBadRequest("/api/reports/sales/orders?pageSize=101");
  await assertBadRequest("/api/reports/sales/products?status=DRAFT");
  await assertBadRequest("/api/reports/sales/products?sortBy=BAD");
  await assertBadRequest("/api/reports/sales/products?dateFrom=not-a-date");
  await assertBadRequest("/api/reports/sales/products?pageSize=101");

  const routeSource = await fs.readFile("src/app/api/reports/sales/route.ts", "utf8");
  assert(!routeSource.includes("inventoryItem.update"), "report API must not update InventoryItem");
  assert(!routeSource.includes('itemStatus: "SOLD"'), "report API must not write SOLD");
  assert(!routeSource.includes("salesService.confirm"), "report API must not call SalesService.confirm");
  assert(!routeSource.includes("salesService.cancel"), "report API must not call SalesService.cancel");
  assert(!routeSource.includes("salesService.settle"), "report API must not call SalesService.settle");
  assert(!routeSource.includes("applyShipmentLineAction"), "report API must not call M3-0 state machine");
  assert(!routeSource.includes("export async function POST"), "report API must not expose POST");
  assert(!routeSource.includes("export async function PATCH"), "report API must not expose PATCH");
  assert(!routeSource.includes("export async function DELETE"), "report API must not expose DELETE");

  const detailRouteSource = await fs.readFile("src/app/api/reports/sales/orders/route.ts", "utf8");
  assert(!detailRouteSource.includes("inventoryItem.update"), "detail report API must not update InventoryItem");
  assert(!detailRouteSource.includes('itemStatus: "SOLD"'), "detail report API must not write SOLD");
  assert(!detailRouteSource.includes("salesService.confirm"), "detail report API must not call SalesService.confirm");
  assert(!detailRouteSource.includes("salesService.cancel"), "detail report API must not call SalesService.cancel");
  assert(!detailRouteSource.includes("salesService.settle"), "detail report API must not call SalesService.settle");
  assert(!detailRouteSource.includes("applyShipmentLineAction"), "detail report API must not call M3-0 state machine");
  assert(!detailRouteSource.includes("export async function POST"), "detail report API must not expose POST");
  assert(!detailRouteSource.includes("export async function PATCH"), "detail report API must not expose PATCH");
  assert(!detailRouteSource.includes("export async function DELETE"), "detail report API must not expose DELETE");

  const productRouteSource = await fs.readFile("src/app/api/reports/sales/products/route.ts", "utf8");
  assert(!productRouteSource.includes("inventoryItem.update"), "product report API must not update InventoryItem");
  assert(!productRouteSource.includes('itemStatus: "SOLD"'), "product report API must not write SOLD");
  assert(!productRouteSource.includes("salesService.confirm") && !productRouteSource.includes("salesService.cancel") && !productRouteSource.includes("salesService.settle"), "product report API must not call sales mutations");
  assert(!productRouteSource.includes("export async function POST") && !productRouteSource.includes("export async function PATCH") && !productRouteSource.includes("export async function DELETE"), "product report API exposes GET only");

  const pageResponse = await fetch(`${baseUrl}/reports/sales`, { headers: accessCookie ? { Cookie: accessCookie } : {} });
  assert(pageResponse.ok, `/reports/sales should return 200, got ${pageResponse.status}`);
  const detailPageResponse = await fetch(`${baseUrl}/reports/sales/orders`, { headers: accessCookie ? { Cookie: accessCookie } : {} });
  assert(detailPageResponse.ok, `/reports/sales/orders should return 200, got ${detailPageResponse.status}`);
  const productPageResponse = await fetch(`${baseUrl}/reports/sales/products`, { headers: accessCookie ? { Cookie: accessCookie } : {} });
  assert(productPageResponse.ok, `/reports/sales/products should return 200, got ${productPageResponse.status}`);

  browser = await launchAcceptanceBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await authenticate(page, "/reports/sales");
  await page.getByText("销售报表").first().waitFor({ timeout: 10_000 });
  await page.getByText("成交价合计").first().waitFor({ timeout: 10_000 });
  const pageText = await page.locator("body").innerText();
  assert(pageText.includes("销售报表"), "reports page should show title");
  assert(pageText.includes("成交价"), "reports page should show gross amount label");
  assert(pageText.includes("预计收入"), "reports page should show expected income label");
  assert(pageText.includes("实际到账"), "reports page should show actual received label");
  assert(pageText.includes("未到账订单"), "reports page should show unsettled orders section");
  await page.getByTestId("sales-after-sales-charts").waitFor({ timeout: 10_000 });
  assert(pageText.includes("销售与售后趋势") && pageText.includes("各平台销售与售后表现") && pageText.includes("商品 / SKU 售后净利润 Top 10"), "reports page renders Chinese after-sales charts");
  const legendButton = page.getByRole("button", { name: "累计退款" });
  await legendButton.click();
  assert(await legendButton.getAttribute("aria-pressed") === "false", "trend legend can hide a series without changing data");
  await page.goto(`${baseUrl}/reports/sales?platform=OTHER&granularity=week&range=all`, { waitUntil: "networkidle" });
  await page.getByTestId("sales-after-sales-charts").waitFor({ timeout: 10_000 });
  assert(new URL(page.url()).searchParams.get("platform") === "OTHER" && new URL(page.url()).searchParams.get("granularity") === "week", "report filter state is retained in the URL after reload");
  assert(!pageText.includes("CONFIRMED"), "reports page should not display CONFIRMED");
  assert(!pageText.includes("SETTLED"), "reports page should not display SETTLED");
  assert(!pageText.includes("SOLD"), "reports page should not display SOLD");
  assert(!pageText.includes("PLATFORM_LISTED"), "reports page should not display PLATFORM_LISTED");

  const detailPage = await context.newPage();
  await detailPage.goto(`${baseUrl}/reports/sales/orders`, { waitUntil: "networkidle" });
  await detailPage.getByText("销售明细").first().waitFor({ timeout: 10_000 });
  await detailPage.getByText("成交价").first().waitFor({ timeout: 10_000 });
  const detailPageText = await detailPage.locator("body").innerText();
  assert(detailPageText.includes("销售明细"), "detail page should show title");
  assert(detailPageText.includes("成交价"), "detail page should show gross amount label");
  assert(detailPageText.includes("预计收入"), "detail page should show expected income label");
  assert(detailPageText.includes("实际到账"), "detail page should show actual received label");
  assert(detailPageText.includes("利润"), "detail page should show profit label");
  assert(!detailPageText.includes("CONFIRMED"), "detail page should not display CONFIRMED");
  assert(!detailPageText.includes("SETTLED"), "detail page should not display SETTLED");
  assert(!detailPageText.includes("SOLD"), "detail page should not display SOLD");
  assert(!detailPageText.includes("PLATFORM_LISTED"), "detail page should not display PLATFORM_LISTED");
  const productPage = await context.newPage();
  await productPage.goto(`${baseUrl}/reports/sales/products`, { waitUntil: "networkidle" });
  await productPage.getByText("商品 / SKU 利润分析").first().waitFor({ timeout: 10_000 });
  const productPageText = await productPage.locator("body").innerText();
  assert(productPageText.includes("商品 / SKU 利润分析") && productPageText.includes("实际到账目前记录在销售订单级"), "product page explains order-level actual received boundary");
  assert(productPageText.includes("售后净利润") && productPageText.includes("退款分配"), "product page shows server-derived after-sales product measures");
  assert(!productPageText.includes("CONFIRMED") && !productPageText.includes("SETTLED") && !productPageText.includes("SOLD") && !productPageText.includes("PLATFORM_LISTED"), "product page does not expose raw statuses");
  await context.close();

  const pageSource = await fs.readFile("src/app/reports/sales/page.tsx", "utf8");
  const componentSource = await fs.readFile("src/components/reports/sales-report-overview.tsx", "utf8");
  const detailPageSource = await fs.readFile("src/app/reports/sales/orders/page.tsx", "utf8");
  const detailComponentSource = await fs.readFile("src/components/reports/sales-orders-report.tsx", "utf8");
  const productPageSource = await fs.readFile("src/app/reports/sales/products/page.tsx", "utf8");
  const productComponentSource = await fs.readFile("src/components/reports/sales-products-report.tsx", "utf8");
  const chartsSource = await fs.readFile("src/components/reports/sales-after-sales-charts.tsx", "utf8");
  const combinedPageSource = `${pageSource}\n${componentSource}\n${detailPageSource}\n${detailComponentSource}\n${productPageSource}\n${productComponentSource}\n${chartsSource}`;
  assert(!combinedPageSource.includes("itemStatus"), "report page must not touch itemStatus");
  assert(!combinedPageSource.includes('itemStatus: "SOLD"'), "report page must not write SOLD");
  assert(!combinedPageSource.includes("salesService.confirm"), "report page must not call SalesService.confirm");
  assert(!combinedPageSource.includes("salesService.cancel"), "report page must not call SalesService.cancel");
  assert(!combinedPageSource.includes("salesService.settle"), "report page must not call SalesService.settle");
  assert(!combinedPageSource.includes("applyShipmentLineAction"), "report page must not call M3-0 state machine");
  assert(!combinedPageSource.includes("method: \"POST\""), "report page must not use POST");
  assert(!combinedPageSource.includes("method: \"PATCH\""), "report page must not use PATCH");
  assert(!combinedPageSource.includes("method: \"DELETE\""), "report page must not use DELETE");
  assert(chartsSource.includes("SalesAfterSalesCharts") && chartsSource.includes("LineChart") && chartsSource.includes("BarChart"), "report overview provides read-only trend and ranking charts");
  assert(chartsSource.includes("totalSalesRefundedAmount") && chartsSource.includes("afterSaleNetProfit"), "charts reuse report after-sales financial fields");
  assert(componentSource.includes("router.replace") && componentSource.includes("granularity"), "overview filters synchronize chart/report state with the URL");

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "DRAFT excluded from report",
      "CANCELLED excluded from report",
      "CONFIRMED counted in gross sales",
      "CONFIRMED without actualReceivedAmount counted as unsettled",
      "SETTLED counted in gross and actual received",
      "PLATFORM_LISTED inventory not counted as sale",
      "expectedIncome is not actualReceivedAmount",
      "empty actualReceivedAmount is not settled income",
      "multi-platform breakdown",
      "profit total does not deduct fees twice",
      "multi-item sale cost total",
      "overdue unsettled rule",
      "report service has no SOLD write path",
      "DRAFT/CANCELLED absent from platformBreakdown",
      "productBreakdown groups by product + SKU",
      "settlementStatus filters",
      "platform filter",
      "date filter uses report date",
      "API GET /api/reports/sales returns 200",
      "API returns summary/platformBreakdown/productBreakdown/unsettledOrders",
      "API status=CONFIRMED filters confirmed sales",
      "API status=SETTLED filters settled sales",
      "API settlementStatus=UNSETTLED filters unsettled sales",
      "API settlementStatus=SETTLED filters settled sales",
      "API platform filter",
      "API dateFrom/dateTo filter",
      "detail API GET /api/reports/sales/orders returns 200",
      "detail API returns only CONFIRMED/SETTLED",
      "detail API excludes DRAFT",
      "detail API excludes CANCELLED",
      "detail API settlementStatus=UNSETTLED filters unsettled sales",
      "detail API settlementStatus=SETTLED filters settled sales",
      "detail API platform filter",
      "detail API keyword searches saleNo",
      "detail API keyword searches product SKU",
      "detail API page/pageSize pagination",
      "detail API money fields are JSON-safe strings",
      "detail API dates are ISO strings/null",
      "detail API invalid params return 400",
      "detail API has no SOLD write path or mutation method",
      "API excludes DRAFT/CANCELLED",
      "API does not count PLATFORM_LISTED as sale",
      "API invalid status returns 400",
      "API invalid settlementStatus returns 400",
      "API invalid date returns 400",
      "API dateFrom > dateTo returns 400",
      "API money fields are JSON-safe strings",
      "API dates are ISO strings/null",
      "API has no SOLD write path or mutation method",
      "page /reports/sales returns 200",
      "page shows sales report title",
      "page shows gross amount label",
      "page shows expected income label",
      "page shows actual received label",
      "page shows unsettled orders section",
      "page does not display raw English sale/inventory statuses",
      "page does not show PLATFORM_LISTED as sold",
      "detail page /reports/sales/orders returns 200",
      "detail page shows sales detail title",
      "detail page shows gross amount/expected income/actual received/profit labels",
      "detail page does not display raw English sale/inventory statuses",
      "detail page has no POST/PATCH/DELETE write path",
      "detail page has no SOLD write logic",
      "product report groups normalized product + SKU snapshots",
      "product report counts a combined sale once per SKU group order",
      "product report uses saved line profit without recomputing fees",
      "product report hides unreliable line sale amounts and margins",
      "product report does not allocate order-level actual received to SKU",
      "product report API filters status and keyword",
      "product report API invalid params return 400",
      "sales detail exact product/SKU link filters snapshots",
      "product page /reports/sales/products returns 200",
      "product page explains actual received is order-level only",
      "product page has no POST/PATCH/DELETE write path or SOLD logic",
      "page has no POST/PATCH/DELETE write path",
      "page has no SOLD write logic",
      "report API returns chart-ready trend and after-sales breakdowns",
      "chart trend money fields are JSON-safe strings",
      "report API supports day/week/month chart granularity",
      "overview renders Chinese read-only charts and interactive trend legend",
      "overview filter state is retained in the URL after reload",
      "charts reuse shared after-sales financial fields without a write path",
    ],
  }, null, 2));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (createdSaleOrderIds.length) {
    await db.saleActionLog.deleteMany({ where: { saleOrderId: { in: createdSaleOrderIds } } }).catch(() => {});
    await db.saleFeeLine.deleteMany({ where: { saleOrderId: { in: createdSaleOrderIds } } }).catch(() => {});
    await db.saleLine.deleteMany({ where: { saleOrderId: { in: createdSaleOrderIds } } }).catch(() => {});
    await db.saleOrder.deleteMany({ where: { id: { in: createdSaleOrderIds } } }).catch(() => {});
  }
  if (createdOrderIds.length) {
    await db.purchaseOrder.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
  await db.user.deleteMany({ where: { id: ownerId } }).catch(() => {});
  await db.$disconnect();
}
