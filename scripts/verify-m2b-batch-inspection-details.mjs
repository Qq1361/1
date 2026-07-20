import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db.ts";
import { InspectionService } from "../src/server/services/inspection-service.ts";
import { WarehouseService } from "../src/server/services/warehouse-service.ts";

const runId = `M8-BATCH-${Date.now()}-${randomUUID().slice(0, 6)}`;
const ownerId = "default-user";
const orderIds = [];
const warehouseIds = [];
let checks = 0;
const service = new InspectionService();
const warehouseService = new WarehouseService();

function assert(condition, message) { if (!condition) throw new Error(message); checks += 1; }
async function rejects(work, code) { try { await work(); } catch (error) { return error?.code === code; } return false; }

async function fixture(label, count = 1, owner = ownerId) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId: owner, orderNo: `${runId}-${label}`, paidAt: new Date("2026-07-20T00:00:00.000Z"), totalAmount: `${count * 10}.00`, shippingAmount: "0.00",
      status: "PENDING_INSPECTION", allocationStatus: "CONFIRMED", allocationConfirmedAt: new Date(),
      items: { create: Array.from({ length: count }, (_, index) => ({ name: `${runId}-${label}-${index + 1}`, skuText: index % 2 ? null : "2c0", quantity: 1, allocatedTotalCost: "10.00", productionDate: new Date("2026-01-31T00:00:00.000Z"), shelfLifeMonths: 12, expiryDate: new Date("2027-01-31T00:00:00.000Z") })) },
    }, include: { items: true },
  });
  orderIds.push(order.id);
  const inspections = await Promise.all(order.items.map((item) => db.inspection.create({ data: { ownerId: owner, purchaseOrderItemId: item.id, sequence: 1 } })));
  return { order, inspections };
}

function details(inspections, warehouseId, storageLocationId, extra = {}) {
  return inspections.map((inspection) => ({ inspectionId: inspection.id, sku: "2c0", warehouseId, storageLocationId, condition: "LIKE_NEW", saleMode: "NONE", productionDate: "2026-01-31", shelfLifeMonths: 12, expiryDate: "2027-01-31", note: null, shelfLifeChangeReason: null, ...extra }));
}

try {
  const warehouse = await warehouseService.create(ownerId, `${runId}-仓库`);
  warehouseIds.push(warehouse.id);
  const location = await warehouseService.createLocation(ownerId, warehouse.id, "A-01");
  const otherWarehouse = await warehouseService.create(ownerId, `${runId}-其他仓库`);
  warehouseIds.push(otherWarehouse.id);
  const otherLocation = await warehouseService.createLocation(ownerId, otherWarehouse.id, "B-01");

  const basic = await fixture("basic", 2);
  const prepared = await service.prepareBatchPass(ownerId, basic.inspections.map((item) => item.id));
  assert(prepared.items.length === 2 && prepared.items[0].productionDate === "2026-01-31", "prepare returns fresh per-item shelf-life snapshots");
  assert(prepared.warehouses.some((item) => item.id === warehouse.id && item.locations.some((entry) => entry.id === location.id)), "prepare returns active warehouse locations");
  const beforeSales = await db.saleOrder.count();
  const beforeRefunds = await db.purchaseRefundRecord.count();
  const result = await service.batchPassWithDetails(ownerId, details(basic.inspections, warehouse.id, location.id, { note: "单件核验" }), "公共核验");
  assert(result.processedCount === 2 && result.inventoryItemIds.length === 2, "batch creates one independent inventory item for each selected inspection");
  const inventory = await db.inventoryItem.findMany({ where: { inspectionId: { in: basic.inspections.map((item) => item.id) } }, include: { inspection: true } });
  assert(inventory.length === 2 && inventory.every((item) => item.warehouseId === warehouse.id && item.storageLocationId === location.id && item.condition === "LIKE_NEW"), "warehouse, location and condition are persisted per inventory item");
  assert(inventory.every((item) => item.itemStatus === "STOCKED" && item.saleMode === "NONE" && item.productionDate?.toISOString().slice(0, 10) === "2026-01-31"), "batch keeps normal stocked status and exact shelf-life snapshots");
  assert(inventory.every((item) => item.inspection.notes?.includes("[批量验货入库]") && item.inspection.notes?.includes("公共备注：公共核验") && item.inspection.notes?.includes("单件备注：单件核验")), "common and per-item notes append an audit block");
  assert(await db.saleOrder.count() === beforeSales && await db.purchaseRefundRecord.count() === beforeRefunds && !inventory.some((item) => item.itemStatus === "SOLD"), "batch does not create sales, refunds or SOLD inventory");

  const corrected = await fixture("shelf-correction");
  const changed = details(corrected.inspections, warehouse.id, location.id, { productionDate: "2026-02-01", shelfLifeMonths: 12, expiryDate: "2027-02-01", shelfLifeChangeReason: "以实物包装标注为准" });
  await service.batchPassWithDetails(ownerId, changed);
  const correctedInspection = await db.inspection.findUniqueOrThrow({ where: { id: corrected.inspections[0].id } });
  assert(correctedInspection.notes?.includes("[保质期实物修正]") && correctedInspection.notes.includes("修改原因：以实物包装标注为准"), "shelf-life correction is appended to inspection audit notes");

  const missingReason = await fixture("missing-reason");
  assert(await rejects(() => service.batchPassWithDetails(ownerId, details(missingReason.inspections, warehouse.id, location.id, { expiryDate: "2027-02-01" })), "SHELF_LIFE_CHANGE_REASON_REQUIRED"), "shelf-life change without a reason is rejected");
  assert(await db.inventoryItem.count({ where: { inspectionId: missingReason.inspections[0].id } }) === 0, "missing shelf-life reason leaves no inventory");

  const invalidDate = await fixture("invalid-date");
  assert(await rejects(() => service.batchPassWithDetails(ownerId, details(invalidDate.inspections, warehouse.id, location.id, { expiryDate: "2026/01/01" })), "SHELF_LIFE_DATE_INVALID"), "non date-only expiry is rejected");
  const mismatch = await fixture("location-mismatch");
  assert(await rejects(() => service.batchPassWithDetails(ownerId, details(mismatch.inspections, warehouse.id, otherLocation.id)), "WAREHOUSE_LOCATION_MISMATCH"), "location must belong to selected warehouse");
  await warehouseService.updateLocation(ownerId, location.id, { isActive: false });
  const inactive = await fixture("inactive-location");
  assert(await rejects(() => service.batchPassWithDetails(ownerId, details(inactive.inspections, warehouse.id, location.id)), "WAREHOUSE_LOCATION_INACTIVE"), "inactive location is rejected");
  await warehouseService.updateLocation(ownerId, location.id, { isActive: true });
  await warehouseService.update(ownerId, warehouse.id, { isActive: false });
  const inactiveWarehouse = await fixture("inactive-warehouse");
  assert(await rejects(() => service.batchPassWithDetails(ownerId, details(inactiveWarehouse.inspections, warehouse.id, location.id)), "WAREHOUSE_INACTIVE"), "inactive warehouse is rejected");
  await warehouseService.update(ownerId, warehouse.id, { isActive: true });

  const atomic = await fixture("atomic", 2);
  const invalid = details(atomic.inspections, warehouse.id, location.id);
  invalid[1].condition = "NOT_A_CONDITION";
  assert(await rejects(() => service.batchPassWithDetails(ownerId, invalid), "INVENTORY_CONDITION_INVALID"), "invalid item rejects the whole batch");
  assert(await db.inventoryItem.count({ where: { inspectionId: { in: atomic.inspections.map((item) => item.id) } } }) === 0 && await db.inspection.count({ where: { id: { in: atomic.inspections.map((item) => item.id) }, completedAt: { not: null } } }) === 0, "failed batch rolls back inventories and inspections");

  const duplicate = await fixture("duplicate");
  const repeated = [...details(duplicate.inspections, warehouse.id, location.id), ...details(duplicate.inspections, warehouse.id, location.id)];
  assert(await rejects(() => service.batchPassWithDetails(ownerId, repeated), "BATCH_INSPECTION_DUPLICATE_IDS"), "duplicate inspection IDs are rejected");
  assert(await rejects(() => service.batchPassWithDetails(ownerId, Array.from({ length: 51 }, () => details(duplicate.inspections, warehouse.id, location.id)[0])), "BATCH_INSPECTION_TOO_MANY"), "51 selected records are rejected");

  const concurrent = await fixture("concurrent");
  const [left, right] = await Promise.allSettled([service.batchPassWithDetails(ownerId, details(concurrent.inspections, warehouse.id, location.id)), service.batchPassWithDetails(ownerId, details(concurrent.inspections, warehouse.id, location.id))]);
  assert([left, right].filter((entry) => entry.status === "fulfilled").length === 1 && await db.inventoryItem.count({ where: { inspectionId: concurrent.inspections[0].id } }) === 1, "concurrent requests create exactly one inventory item");

  console.log(`verify:m2b-batch-inspection-details passed: ${checks} checks`);
} finally {
  if (orderIds.length) await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  if (warehouseIds.length) await db.warehouseLocation.deleteMany({ where: { warehouseId: { in: warehouseIds } } });
  if (warehouseIds.length) await db.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
  await db.$disconnect();
}
