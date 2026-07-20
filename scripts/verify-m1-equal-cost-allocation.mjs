import "dotenv/config";
import { db } from "../src/server/db.ts";
import {
  CostAllocationService,
  calculateAllocationSummary,
} from "../src/server/services/cost-allocation-service.ts";

const ownerId = "default-user";
const runId = `M1-EQUAL-${Date.now()}`;
const orderIds = [];
let otherOwnerId = null;
let checks = 0;
const service = new CostAllocationService();

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

async function createOrder(suffix, items, totalAmount = "100.00", shippingAmount = "0.00") {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-${suffix}`,
      paidAt: new Date("2026-07-20T00:00:00.000Z"),
      totalAmount,
      shippingAmount,
      items: { create: items },
    },
    include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  orderIds.push(order.id);
  return order;
}

try {
  const equalOrder = await createOrder("QUANTITY", [
    { name: "equal item A", quantity: 2, skuText: "A" },
    { name: "equal item B", quantity: 1, skuText: "B" },
  ]);
  const beforePreview = await service.getSummary(ownerId, equalOrder.id);
  const preview = await service.getEqualPreview(ownerId, equalOrder.id);
  const afterPreview = await service.getSummary(ownerId, equalOrder.id);
  assert(preview.totalAmount === "100.00" && preview.totalQuantity === 3 && preview.perUnitAverage === "33.33", "preview uses payment total and actual item quantity");
  assert(JSON.stringify(preview.allocations) === JSON.stringify([
    { itemId: equalOrder.items[0].id, quantity: 2, allocatedTotalCost: "66.67" },
    { itemId: equalOrder.items[1].id, quantity: 1, allocatedTotalCost: "33.33" },
  ]), "quantity 2 plus quantity 1 receives 66.67 and 33.33");
  assert(beforePreview.allocationStatus === "UNALLOCATED" && JSON.stringify(beforePreview.items) === JSON.stringify(afterPreview.items), "preview does not save or confirm a draft");
  assert(calculateAllocationSummary("100.00", "0.00", preview.allocations).isBalanced, "preview allocations add up exactly");

  const saved = await service.save(ownerId, equalOrder.id, preview.allocations, false, preview.allocationVersion);
  assert(saved.allocationStatus === "DRAFT" && saved.difference === "0.00", "equal preview can be saved as a balanced draft");

  const fractionalOrder = await createOrder("FRACTION", [
    { name: "fraction A", quantity: 1 },
    { name: "fraction B", quantity: 1 },
    { name: "fraction C", quantity: 1 },
  ], "0.01");
  const fractionalFirst = await service.getEqualPreview(ownerId, fractionalOrder.id);
  const fractionalSecond = await service.getEqualPreview(ownerId, fractionalOrder.id);
  assert(JSON.stringify(fractionalFirst.allocations) === JSON.stringify(fractionalSecond.allocations), "cent remainder allocation is stable across repeated previews");
  assert(JSON.stringify(fractionalFirst.allocations.map((allocation) => allocation.allocatedTotalCost)) === JSON.stringify(["0.01", "0.00", "0.00"]), "one cent is assigned without floating point drift");

  const conflictOrder = await createOrder("CONFLICT", [
    { name: "conflict A", quantity: 1 },
    { name: "conflict B", quantity: 1 },
  ]);
  const conflictPreview = await service.getEqualPreview(ownerId, conflictOrder.id);
  await db.purchaseOrderItem.update({ where: { id: conflictOrder.items[0].id }, data: { quantity: 2 } });
  await service.save(ownerId, conflictOrder.id, conflictPreview.allocations, false, conflictPreview.allocationVersion)
    .then(() => { throw new Error("expected preview conflict"); })
    .catch((error) => assert(error.code === "ALLOCATION_PREVIEW_CONFLICT", "quantity changes after preview reject a stale allocation"));
  const conflictAfter = await service.getSummary(ownerId, conflictOrder.id);
  assert(conflictAfter.items.every((item) => item.allocatedTotalCost === null), "stale preview rejection does not write allocations");

  const confirmOrder = await createOrder("CONFIRMED", [
    { name: "confirmed item", quantity: 1 },
  ], "12.34", "0.56");
  const confirmPreview = await service.getEqualPreview(ownerId, confirmOrder.id);
  const confirmed = await service.save(ownerId, confirmOrder.id, confirmPreview.allocations, true, confirmPreview.allocationVersion);
  assert(confirmed.allocationStatus === "CONFIRMED" && confirmed.difference === "0.00", "equal allocation can be explicitly confirmed");
  await service.getEqualPreview(ownerId, confirmOrder.id)
    .then(() => { throw new Error("expected confirmed allocation rejection"); })
    .catch((error) => assert(error.code === "ALLOCATION_ALREADY_CONFIRMED", "confirmed allocation cannot be averaged again"));

  otherOwnerId = `${runId}-other-owner`;
  await db.user.create({ data: { id: otherOwnerId, name: "equal allocation owner" } });
  const crossOwnerOrder = await db.purchaseOrder.create({
    data: {
      ownerId: otherOwnerId,
      orderNo: `${runId}-OTHER`,
      paidAt: new Date("2026-07-20T00:00:00.000Z"),
      totalAmount: "1.00",
      shippingAmount: "0.00",
      items: { create: { name: "other owner item", quantity: 1 } },
    },
  });
  orderIds.push(crossOwnerOrder.id);
  await service.getEqualPreview(ownerId, crossOwnerOrder.id)
    .then(() => { throw new Error("expected owner rejection"); })
    .catch((error) => assert(error.code === "ORDER_NOT_FOUND", "cross-owner average preview is rejected"));

  console.log(`verify:m1-equal-cost-allocation passed: ${checks} checks`);
} finally {
  if (orderIds.length) {
    await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (otherOwnerId) {
    await db.user.delete({ where: { id: otherOwnerId } });
  }
}
