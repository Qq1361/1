import "dotenv/config";
import fs from "node:fs/promises";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { salesReportService } from "../src/server/reports/sales-report-service.ts";

const runId = Date.now();
const ownerId = `m3b-report-${runId}`;
const createdOrderIds = [];
const createdSaleOrderIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dec(value) {
  return new Prisma.Decimal(value);
}

async function createInventory({
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
      saleMode,
      storageLocation,
      stockedAt: new Date(),
    },
  });
}

async function createSale({
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
      ownerId,
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
          ownerId,
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

  const source = await fs.readFile("src/server/reports/sales-report-service.ts", "utf8");
  assert(!source.includes("inventoryItem.update"), "report service must not update InventoryItem");
  assert(!source.includes('itemStatus: "SOLD"'), "report service must not write SOLD");
  assert(!source.includes("salesService.confirm"), "report service must not call SalesService.confirm");
  assert(!source.includes("salesService.cancel"), "report service must not call SalesService.cancel");
  assert(!source.includes("applyShipmentLineAction"), "report service must not call M3-0 state machine");

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
    ],
  }, null, 2));
} finally {
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
