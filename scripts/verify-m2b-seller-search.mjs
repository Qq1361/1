import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db.ts";
import { inspectionService } from "../src/server/services/inspection-service.ts";

const runId = `M2B-SELLER-${Date.now()}-${randomUUID().slice(0, 8)}`;
const ownerId = `${runId}-owner`;
const otherOwnerId = `${runId}-other-owner`;
const orderIds = [];
const checks = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name) {
  checks.push(name);
}

async function createPendingOrder({ ownerId: orderOwnerId = ownerId, suffix, sellerNickname, name, skuText }) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId: orderOwnerId,
      orderNo: `${runId}-${suffix}`,
      paidAt: new Date(),
      totalAmount: "10.00",
      shippingAmount: "0.00",
      status: "PENDING_INSPECTION",
      sellerNickname,
      items: { create: { name, skuText, quantity: 1 } },
    },
    include: { items: true },
  });
  orderIds.push(order.id);
  await db.inspection.create({
    data: { ownerId: orderOwnerId, purchaseOrderItemId: order.items[0].id, sequence: 1 },
  });
  return order;
}

try {
  await db.user.create({ data: { id: ownerId, name: `${runId}-owner` } });
  await db.user.create({ data: { id: otherOwnerId, name: `${runId}-other-owner` } });

  const chineseA = await createPendingOrder({
    suffix: "CN-A",
    sellerNickname: "广州美妆小铺888",
    name: `${runId}-同款粉底液`,
    skuText: `${runId}-SKU-CN-A`,
  });
  const chineseB = await createPendingOrder({
    suffix: "CN-B",
    sellerNickname: "广州美妆小铺888",
    name: `${runId}-同款粉底液`,
    skuText: `${runId}-SKU-CN-B`,
  });
  const english = await createPendingOrder({
    suffix: "EN",
    sellerNickname: "Northwind Beauty",
    name: `${runId}-英文卖家商品`,
    skuText: `${runId}-SKU-EN`,
  });
  await createPendingOrder({
    suffix: "EMPTY",
    sellerNickname: null,
    name: `${runId}-空昵称商品`,
    skuText: `${runId}-SKU-EMPTY`,
  });
  await createPendingOrder({
    suffix: "OTHER-SELLER",
    sellerNickname: "另一家供应商",
    name: `${runId}-同款粉底液`,
    skuText: `${runId}-SKU-OTHER`,
  });
  await createPendingOrder({
    ownerId: otherOwnerId,
    suffix: "OTHER-OWNER",
    sellerNickname: "广州美妆小铺888",
    name: `${runId}-隔离商品`,
    skuText: `${runId}-SKU-ISOLATED`,
  });

  const before = {
    inspections: await db.inspection.count({ where: { ownerId } }),
    inventory: await db.inventoryItem.count({ where: { ownerId } }),
    sales: await db.saleOrder.count({ where: { ownerId } }),
  };

  const fullChinese = await inspectionService.list(ownerId, { query: "广州美妆小铺888" });
  assert(fullChinese.total === 2, "full Chinese seller nickname search did not return both orders");
  assert(
    fullChinese.data.some((inspection) => inspection.purchaseOrderItem.purchaseOrder.orderNo === chineseB.orderNo),
    "full Chinese seller nickname search did not include the second matching order",
  );
  pass("full Chinese seller nickname search");

  const partialChinese = await inspectionService.list(ownerId, { query: "美妆小铺" });
  assert(partialChinese.total === 2, "partial Chinese seller nickname search did not return both orders");
  pass("partial Chinese seller nickname search");

  const englishInsensitive = await inspectionService.list(ownerId, { query: "NORTHWIND BEAUTY" });
  assert(englishInsensitive.total === 1 && englishInsensitive.data[0]?.purchaseOrderItem.purchaseOrder.id === english.id, "English seller search is not case-insensitive");
  pass("case-insensitive English seller nickname search");

  const trimmed = await inspectionService.list(ownerId, { query: "  美妆小铺  " });
  assert(trimmed.total === 2, "seller keyword was not trimmed");
  pass("trimmed keyword search");

  const byOrderNo = await inspectionService.list(ownerId, { query: chineseA.orderNo });
  const byProduct = await inspectionService.list(ownerId, { query: `${runId}-同款粉底液` });
  const bySku = await inspectionService.list(ownerId, { query: `${runId}-SKU-CN-B` });
  assert(byOrderNo.total === 1 && byProduct.total === 3 && bySku.total === 1, "existing order, product, or SKU search regressed");
  pass("order number, product, and SKU search remain available");

  const all = await inspectionService.list(ownerId, { query: "   " });
  assert(all.total === 5, "empty keyword did not return all pending inspections for the owner");
  pass("empty keyword returns all pending inspections");

  const firstPage = await inspectionService.list(ownerId, { query: "美妆小铺", page: 1, pageSize: 1 });
  const secondPage = await inspectionService.list(ownerId, { query: "美妆小铺", page: 2, pageSize: 1 });
  assert(firstPage.total === 2 && firstPage.totalPages === 2 && firstPage.data.length === 1 && secondPage.data.length === 1 && firstPage.data[0].id !== secondPage.data[0].id, "seller search pagination or total is incorrect");
  pass("filtered pagination and total share the same query scope");

  const isolated = await inspectionService.list(otherOwnerId, { query: "美妆小铺" });
  assert(isolated.total === 1 && isolated.data[0]?.purchaseOrderItem.purchaseOrder.ownerId === otherOwnerId, "seller search leaked another owner data");
  pass("owner isolation is preserved");

  const after = {
    inspections: await db.inspection.count({ where: { ownerId } }),
    inventory: await db.inventoryItem.count({ where: { ownerId } }),
    sales: await db.saleOrder.count({ where: { ownerId } }),
  };
  assert(JSON.stringify(after) === JSON.stringify(before), "search changed inspection, inventory, or sales data");
  pass("search is read-only and does not create inventory or sales records");

  console.log(JSON.stringify({ ok: true, checks: checks.length, checkNames: checks }, null, 2));
} finally {
  await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  const residualOrders = await db.purchaseOrder.count({ where: { id: { in: orderIds } } });
  const residualInspections = await db.inspection.count({ where: { ownerId: { in: [ownerId, otherOwnerId] } } });
  if (residualOrders !== 0 || residualInspections !== 0) {
    throw new Error(`fixture cleanup failed: ${residualOrders} orders and ${residualInspections} inspections remain`);
  }
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } });
  await db.$disconnect();
}
