import "dotenv/config";
import { db } from "../src/server/db.ts";
import { inventoryService } from "../src/server/services/inventory-service.ts";
import { WarehouseService } from "../src/server/services/warehouse-service.ts";

const runId = `M8-${Date.now()}`;
const ownerA = `${runId}-owner-a`;
const ownerB = `${runId}-owner-b`;
const orderIds = [];
const warehouseIds = [];
let checks = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

async function rejects(work, code) {
  try {
    await work();
  } catch (error) {
    return !code || error?.code === code;
  }
  return false;
}

async function createInventoryFixture({ ownerId, suffix, warehouseId = null, storageLocationId = null, storageLocation = null, condition = null }) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-${suffix}`,
      paidAt: new Date("2026-07-20T00:00:00.000Z"),
      totalAmount: "10.00",
      shippingAmount: "0.00",
      items: { create: { name: `${runId} ${suffix}`, quantity: 1 } },
    },
    include: { items: true },
  });
  orderIds.push(order.id);
  const inspection = await db.inspection.create({
    data: { ownerId, purchaseOrderItemId: order.items[0].id, sequence: 1, status: "PENDING" },
  });
  return db.inventoryItem.create({
    data: {
      ownerId,
      purchaseOrderItemId: order.items[0].id,
      inspectionId: inspection.id,
      inventoryCode: `${runId}-${suffix}`,
      name: `${runId} ${suffix}`,
      unitCost: "10.00",
      itemStatus: "STOCKED",
      stockedAt: new Date("2026-07-20T00:00:00.000Z"),
      warehouseId,
      storageLocationId,
      storageLocation,
      condition,
    },
  });
}

try {
  const service = new WarehouseService();
  await db.user.createMany({ data: [{ id: ownerA, name: "M8 owner A" }, { id: ownerB, name: "M8 owner B" }] });

  const aWarehouse = await service.create(ownerA, "主仓");
  const bWarehouse = await service.create(ownerB, "主仓");
  warehouseIds.push(aWarehouse.id, bWarehouse.id);
  assert(aWarehouse.ownerId === ownerA && bWarehouse.ownerId === ownerB, "warehouses are isolated by owner");
  assert(await rejects(() => service.create(ownerA, "主仓"), "WAREHOUSE_NAME_DUPLICATE"), "same owner cannot create a duplicate warehouse name");
  assert((await service.list(ownerA)).length === 1 && (await service.list(ownerB)).length === 1, "one owner cannot read another owner's warehouses");

  const aLocation = await service.createLocation(ownerA, aWarehouse.id, "A-01");
  const bLocation = await service.createLocation(ownerB, bWarehouse.id, "A-01");
  assert(aLocation.ownerId === ownerA && bLocation.ownerId === ownerB, "locations retain their owner and warehouse");
  assert(await rejects(() => service.createLocation(ownerA, aWarehouse.id, "A-01"), "WAREHOUSE_LOCATION_NAME_DUPLICATE"), "same warehouse cannot create a duplicate location name");
  assert(await rejects(() => service.createLocation(ownerA, bWarehouse.id, "A-02"), "WAREHOUSE_NOT_FOUND"), "cross-owner warehouse location creation is rejected");
  assert(await rejects(() => service.updateLocation(ownerA, bLocation.id, { name: "B-02" }), "WAREHOUSE_LOCATION_NOT_FOUND"), "cross-owner location update is rejected");

  await service.updateLocation(ownerA, aLocation.id, { isActive: false });
  assert((await service.list(ownerA, true))[0].locations.length === 0, "inactive locations are excluded from new inbound selection query");
  assert((await service.list(ownerA))[0].locations[0].isActive === false, "historical warehouse display retains inactive locations");
  await service.update(ownerA, aWarehouse.id, { isActive: false });
  assert((await service.list(ownerA, true)).length === 0, "inactive warehouses are excluded from new inbound selection query");
  assert(await rejects(() => service.createLocation(ownerA, aWarehouse.id, "A-02"), "WAREHOUSE_INACTIVE"), "inactive warehouse cannot accept a new location");
  await service.update(ownerA, aWarehouse.id, { isActive: true });
  await service.updateLocation(ownerA, aLocation.id, { isActive: true });

  const legacyItem = await createInventoryFixture({ ownerId: ownerA, suffix: "LEGACY", storageLocation: "旧货架" });
  const structuredItem = await createInventoryFixture({
    ownerId: ownerA,
    suffix: "STRUCTURED",
    warehouseId: aWarehouse.id,
    storageLocationId: aLocation.id,
    condition: "LIKE_NEW",
  });
  assert(legacyItem.warehouseId === null && legacyItem.storageLocationId === null && legacyItem.storageLocation === "旧货架" && legacyItem.condition === null, "legacy inventory remains untouched and retains free-text fallback");
  assert(structuredItem.warehouseId === aWarehouse.id && structuredItem.storageLocationId === aLocation.id && structuredItem.condition === "LIKE_NEW", "new structured inventory stores warehouse location and condition independently");
  const listed = await inventoryService.list(ownerA, { page: 1, pageSize: 20 });
  assert(listed.data.find((item) => item.id === legacyItem.id)?.displayStorageLocation === "旧货架" && listed.data.find((item) => item.id === structuredItem.id)?.displayStorageLocation === "主仓 / A-01", "inventory display prefers structured locations and falls back to legacy text");
  assert(legacyItem.itemStatus === "STOCKED" && structuredItem.itemStatus === "STOCKED" && legacyItem.saleMode === "NONE" && structuredItem.saleMode === "NONE", "warehouse foundation does not change inventory or sales state");
  assert(await rejects(() => db.warehouseLocation.delete({ where: { id: aLocation.id } })), "referenced locations cannot be hard-deleted");
  assert(await rejects(() => db.warehouse.delete({ where: { id: aWarehouse.id } })), "referenced warehouses cannot be hard-deleted");
  assert(await db.inventoryItem.count({ where: { ownerId: ownerA, itemStatus: "SOLD" } }) === 0, "warehouse foundation does not create SOLD inventory");

  console.log(`verify:m8-warehouse-foundation passed: ${checks} checks`);
} finally {
  if (orderIds.length) await db.inventoryItem.deleteMany({ where: { purchaseOrderItem: { purchaseOrderId: { in: orderIds } } } });
  if (orderIds.length) await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  if (warehouseIds.length) await db.warehouseLocation.deleteMany({ where: { warehouseId: { in: warehouseIds } } });
  if (warehouseIds.length) await db.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
  await db.user.deleteMany({ where: { id: { in: [ownerA, ownerB] } } });
}
