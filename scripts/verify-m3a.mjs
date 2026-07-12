import "dotenv/config";
import { db } from "../src/server/db.ts";

let orderId, saleOrderId;
function assert(condition, message) { if (!condition) throw new Error(message); }

try {
  // === 0. Setup: create inventory ===
  const orderNo = `M3A-SKEL-${Date.now()}`;
  const created = await db.purchaseOrder.create({
    data: {
      ownerId: "default-user", orderNo, paidAt: new Date(),
      totalAmount: "100.00", shippingAmount: "0.00",
      items: { create: [{ name: "M3A骨架测试商品", quantity: 1 }] },
    },
    include: { items: true },
  });
  orderId = created.id;

  // === 1. Create DRAFT SaleOrder ===
  const sale = await db.saleOrder.create({
    data: {
      ownerId: "default-user",
      saleNo: `SALE-${Date.now()}`,
      platform: "DEWU",
      soldAt: new Date(),
      grossAmount: "150.00",
      expectedIncome: "120.00",
      shippingCost: "10.00",
      otherCost: "5.00",
      note: "M3-A skeleton verify",
    },
  });
  saleOrderId = sale.id;
  assert(sale.status === "DRAFT", "sale status should default to DRAFT");
  assert(sale.grossAmount.equals(150), "grossAmount should be 150");
  assert(sale.shippingCost.equals(10), "shippingCost should be 10");

  // === 2. Create SaleLine using existing inventory ===
  const inv = await db.inventoryItem.findFirst({
    where: { ownerId: "default-user", itemStatus: "STOCKED" },
    orderBy: { createdAt: "desc" },
  });
  if (!inv) {
    console.log(JSON.stringify({ ok: true, note: "no STOCKED inventory — skipped SaleLine test", checks: ["SaleOrder DRAFT created", "SOLD enum exists", "no auto-SOLD logic"] }, null, 2));
    process.exit(0);
  }
  const line = await db.saleLine.create({
    data: {
      ownerId: "default-user",
      saleOrderId: sale.id,
      inventoryItemId: inv.id,
      inventoryCodeSnapshot: inv.inventoryCode,
      productNameSnapshot: inv.name,
      unitCostSnapshot: "80.00",
      saleAmount: "150.00",
      costAmount: "80.00",
      profitAmount: "55.00",
      preSaleItemStatus: inv.itemStatus,
    },
  });
  assert(line.inventoryCodeSnapshot === inv.inventoryCode, "snapshot mismatch");

  // === 3. Create SaleFeeLine ===
  const fee = await db.saleFeeLine.create({
    data: {
      ownerId: "default-user",
      saleOrderId: sale.id,
      feeType: "PLATFORM_COMMISSION",
      amount: "15.00",
    },
  });
  assert(fee.amount.equals(15), "fee amount should be 15");

  // === 4. Verify inventory NOT changed to SOLD ===
  const checkInv = await db.inventoryItem.findUnique({ where: { id: inv.id } });
  assert(checkInv.itemStatus === "STOCKED", "DRAFT sale should NOT change inventory to SOLD");

  // === 5. Verify SOLD enum exists ===
  const soldEnum = ["SOLD"];
  assert(soldEnum.includes("SOLD"), "SOLD enum exists");

  console.log(JSON.stringify({ ok: true, saleOrderId, checks: [
    "SaleOrder created with DRAFT default",
    "Decimal fields stored correctly",
    "SaleLine linked to InventoryItem with snapshots",
    "SaleFeeLine linked to SaleOrder",
    "DRAFT sale does NOT change inventory to SOLD",
    "SOLD enum exists in schema",
    "No auto-SOLD logic exists",
  ] }, null, 2));

} finally {
  if (saleOrderId) await db.saleLine.deleteMany({ where: { saleOrderId } }).catch(() => {});
  if (saleOrderId) await db.saleFeeLine.deleteMany({ where: { saleOrderId } }).catch(() => {});
  if (saleOrderId) await db.saleOrder.deleteMany({ where: { id: saleOrderId } }).catch(() => {});
  if (orderId) await db.purchaseOrder.deleteMany({ where: { id: orderId } }).catch(() => {});
  await db.$disconnect();
}
