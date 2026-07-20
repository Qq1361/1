import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db.ts";
import { InspectionService } from "../src/server/services/inspection-service.ts";
import { InventoryBulkService } from "../src/server/services/inventory-bulk-service.ts";
import { InventoryService } from "../src/server/services/inventory-service.ts";
import { WarehouseService } from "../src/server/services/warehouse-service.ts";
import { inspectionBatchPassDetailsSchema } from "../src/server/validation/inspection.ts";
import { inventoryBulkOperationSchema } from "../src/server/validation/inventory.ts";

const runId = `M8-MANUAL-${Date.now()}-${randomUUID().slice(0, 6)}`;
const ownerId = `${runId}-owner`;
const otherOwnerId = `${runId}-other-owner`;
const orderIds = [];
const warehouseIds = [];
let checks = 0;
const assert = (value, message) => { if (!value) throw new Error(message); checks += 1; };
async function rejects(work, code) { try { await work(); } catch (error) { return error?.code === code; } return false; }

async function pendingOrder(label, count = 1) {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-${label}`,
      paidAt: new Date(),
      totalAmount: `${count * 10}.00`,
      shippingAmount: "0.00",
      status: "PENDING_INSPECTION",
      allocationStatus: "CONFIRMED",
      allocationConfirmedAt: new Date(),
      items: { create: Array.from({ length: count }, (_, index) => ({ name: `${runId}-${label}-${index + 1}`, quantity: 1, allocatedTotalCost: "10.00" })) },
    },
    include: { items: true },
  });
  orderIds.push(order.id);
  const inspections = await Promise.all(order.items.map((item) => db.inspection.create({ data: { ownerId, purchaseOrderItemId: item.id, sequence: 1 } })));
  return { order, inspections };
}

async function inventoryFixture(label, warehouseId, storageLocationId, storageLocation = null) {
  const { order, inspections } = await pendingOrder(label);
  return db.inventoryItem.create({
    data: {
      ownerId,
      purchaseOrderItemId: order.items[0].id,
      inspectionId: inspections[0].id,
      inventoryCode: `${runId}-${label}`,
      name: `${runId}-${label}`,
      unitCost: "10.00",
      itemStatus: "STOCKED",
      ownershipStatus: "OWNED",
      stockedAt: new Date(),
      warehouseId,
      storageLocationId,
      storageLocation,
      condition: "LIKE_NEW",
    },
  });
}

function detail(inspection, warehouseId, location) {
  return {
    inspectionId: inspection.id,
    sku: null,
    warehouseId,
    ...location,
    condition: "LIKE_NEW",
    saleMode: "NONE",
    productionDate: null,
    shelfLifeMonths: null,
    expiryDate: null,
    note: null,
    shelfLifeChangeReason: null,
  };
}

try {
  const warehouses = new WarehouseService();
  const inspections = new InspectionService();
  const bulk = new InventoryBulkService();
  const inventory = new InventoryService();
  await db.user.create({ data: { id: ownerId, name: ownerId } });
  await db.user.create({ data: { id: otherOwnerId, name: otherOwnerId } });
  const manualWarehouse = await warehouses.create(ownerId, `${runId}-手动仓`);
  const standardWarehouse = await warehouses.create(ownerId, `${runId}-标准仓`);
  const standardLocation = await warehouses.createLocation(ownerId, standardWarehouse.id, "A-01");
  const otherWarehouse = await warehouses.create(otherOwnerId, `${runId}-other-warehouse`);
  const otherLocation = await warehouses.createLocation(otherOwnerId, otherWarehouse.id, "OTHER-01");
  warehouseIds.push(manualWarehouse.id, standardWarehouse.id, otherWarehouse.id);

  const noLocationBatch = await pendingOrder("manual-batch");
  const manualBatch = await inspections.batchPassWithDetails(ownerId, [detail(noLocationBatch.inspections[0], manualWarehouse.id, { locationMode: "MANUAL", storageLocation: " 货架2-第3层 ", storageLocationId: null })]);
  const manualInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: manualBatch.inventoryItemIds[0] } });
  assert(manualInventory.warehouseId === manualWarehouse.id && manualInventory.storageLocation === "货架2-第3层" && manualInventory.storageLocationId === null, "manual batch pass stores warehouse plus trimmed free-text location without a standard location");
  assert(await db.warehouseLocation.count({ where: { warehouseId: manualWarehouse.id } }) === 0, "manual inbound does not create WarehouseLocation records");
  assert(manualInventory.itemStatus === "STOCKED" && manualInventory.unitCost.toFixed(2) === "10.00", "manual inbound does not change status or cost semantics");

  const mixedBatch = await pendingOrder("mixed-batch", 2);
  const mixed = await inspections.batchPassWithDetails(ownerId, [
    detail(mixedBatch.inspections[0], manualWarehouse.id, { locationMode: "MANUAL", storageLocation: "货架3-第1层", storageLocationId: null }),
    detail(mixedBatch.inspections[1], standardWarehouse.id, { locationMode: "STANDARD", storageLocation: null, storageLocationId: standardLocation.id }),
  ]);
  const mixedItems = await db.inventoryItem.findMany({ where: { id: { in: mixed.inventoryItemIds } }, orderBy: { inventoryCode: "asc" } });
  assert(mixedItems.some((item) => item.warehouseId === manualWarehouse.id && item.storageLocation === "货架3-第1层" && item.storageLocationId === null) && mixedItems.some((item) => item.warehouseId === standardWarehouse.id && item.storageLocationId === standardLocation.id && item.storageLocation === null), "one batch supports mixed manual and standard locations per item");
  const invalidManualBatch = await pendingOrder("invalid-manual");
  assert(await rejects(() => inspections.batchPassWithDetails(ownerId, [detail(invalidManualBatch.inspections[0], manualWarehouse.id, { locationMode: "MANUAL", storageLocation: "   ", storageLocationId: null })]), "MANUAL_STORAGE_LOCATION_REQUIRED"), "blank manual storage location is rejected by the service");
  const tooLongManualBatch = await pendingOrder("too-long-manual");
  assert(await rejects(() => inspections.batchPassWithDetails(ownerId, [detail(tooLongManualBatch.inspections[0], manualWarehouse.id, { locationMode: "MANUAL", storageLocation: "x".repeat(101), storageLocationId: null })]), "MANUAL_STORAGE_LOCATION_INVALID"), "manual locations longer than 100 characters are rejected");
  const inactiveWarehouseBatch = await pendingOrder("inactive-warehouse");
  await warehouses.update(ownerId, manualWarehouse.id, { isActive: false });
  assert(await rejects(() => inspections.batchPassWithDetails(ownerId, [detail(inactiveWarehouseBatch.inspections[0], manualWarehouse.id, { locationMode: "MANUAL", storageLocation: "A-01", storageLocationId: null })]), "WAREHOUSE_INACTIVE"), "inactive warehouses cannot receive manual inbound inventory");
  await warehouses.update(ownerId, manualWarehouse.id, { isActive: true });
  const inactiveLocationBatch = await pendingOrder("inactive-standard-location");
  await warehouses.updateLocation(ownerId, standardLocation.id, { isActive: false });
  assert(await rejects(() => inspections.batchPassWithDetails(ownerId, [detail(inactiveLocationBatch.inspections[0], standardWarehouse.id, { locationMode: "STANDARD", storageLocation: null, storageLocationId: standardLocation.id })]), "WAREHOUSE_LOCATION_INACTIVE"), "inactive standard locations are rejected");
  await warehouses.updateLocation(ownerId, standardLocation.id, { isActive: true });
  const mismatchBatch = await pendingOrder("standard-mismatch");
  assert(await rejects(() => inspections.batchPassWithDetails(ownerId, [detail(mismatchBatch.inspections[0], manualWarehouse.id, { locationMode: "STANDARD", storageLocation: null, storageLocationId: standardLocation.id })]), "WAREHOUSE_LOCATION_MISMATCH"), "standard locations must belong to the selected warehouse");
  const crossOwnerWarehouseBatch = await pendingOrder("cross-owner-warehouse");
  assert(await rejects(() => inspections.batchPassWithDetails(ownerId, [detail(crossOwnerWarehouseBatch.inspections[0], otherWarehouse.id, { locationMode: "MANUAL", storageLocation: "Other-01", storageLocationId: null })]), "WAREHOUSE_CROSS_OWNER"), "cross-owner warehouses are rejected");
  const crossOwnerLocationBatch = await pendingOrder("cross-owner-location");
  assert(await rejects(() => inspections.batchPassWithDetails(ownerId, [detail(crossOwnerLocationBatch.inspections[0], standardWarehouse.id, { locationMode: "STANDARD", storageLocation: null, storageLocationId: otherLocation.id })]), "WAREHOUSE_LOCATION_NOT_FOUND"), "cross-owner standard locations are rejected");
  const atomicBatch = await pendingOrder("atomic-location", 2);
  assert(await rejects(() => inspections.batchPassWithDetails(ownerId, [
    detail(atomicBatch.inspections[0], manualWarehouse.id, { locationMode: "MANUAL", storageLocation: "A-02", storageLocationId: null }),
    detail(atomicBatch.inspections[1], manualWarehouse.id, { locationMode: "MANUAL", storageLocation: "   ", storageLocationId: null }),
  ]), "MANUAL_STORAGE_LOCATION_REQUIRED"), "an invalid item rejects the complete mixed-location batch");
  assert(await db.inventoryItem.count({ where: { inspectionId: { in: atomicBatch.inspections.map((item) => item.id) } } }) === 0, "invalid location input leaves the batch with zero inventory writes");

  const source = await inventoryFixture("move-source", standardWarehouse.id, standardLocation.id);
  const original = await db.inventoryItem.findUniqueOrThrow({ where: { id: source.id } });
  const toManual = { inventoryItemIds: [source.id], operation: "MOVE_LOCATION", payload: { locationMode: "MANUAL", warehouseId: manualWarehouse.id, storageLocation: "货架9-第2层", storageLocationId: null }, confirmMixedProducts: false };
  const manualPreview = await bulk.preview(ownerId, toManual);
  assert(manualPreview.changes[0].before.locationMode === "STANDARD" && manualPreview.changes[0].after.locationMode === "MANUAL" && manualPreview.changes[0].after.storageLocation === "货架9-第2层", "manual move preview exposes both location modes and manual text");
  await bulk.update(ownerId, { ...toManual, selectionFingerprint: manualPreview.selectionFingerprint });
  const afterManual = await db.inventoryItem.findUniqueOrThrow({ where: { id: source.id } });
  assert(afterManual.warehouseId === manualWarehouse.id && afterManual.storageLocationId === null && afterManual.storageLocation === "货架9-第2层", "standard-to-manual move clears the standard relation");
  assert(afterManual.itemStatus === original.itemStatus && afterManual.unitCost.toFixed(2) === original.unitCost.toFixed(2), "manual move preserves inventory status and cost");
  const manualToManual = { ...toManual, payload: { locationMode: "MANUAL", warehouseId: manualWarehouse.id, storageLocation: "货架9-第3层", storageLocationId: null } };
  const manualToManualPreview = await bulk.preview(ownerId, manualToManual);
  await bulk.update(ownerId, { ...manualToManual, selectionFingerprint: manualToManualPreview.selectionFingerprint });
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: source.id } })).storageLocation === "货架9-第3层", "manual-to-manual move updates only the free-text location");
  const toStandard = { ...toManual, payload: { locationMode: "STANDARD", warehouseId: standardWarehouse.id, storageLocationId: standardLocation.id, storageLocation: null } };
  const standardPreview = await bulk.preview(ownerId, toStandard);
  await bulk.update(ownerId, { ...toStandard, selectionFingerprint: standardPreview.selectionFingerprint });
  const afterStandard = await db.inventoryItem.findUniqueOrThrow({ where: { id: source.id } });
  assert(afterStandard.warehouseId === standardWarehouse.id && afterStandard.storageLocationId === standardLocation.id && afterStandard.storageLocation === null, "manual-to-standard move clears manual text");
  const logs = await db.inventoryItemActionLog.findMany({ where: { inventoryItemId: source.id, actionType: "MOVE_LOCATION" } });
  assert(logs.length === 3 && logs.every((log) => log.beforeData.locationMode && log.afterData.locationMode && "storageLocation" in log.beforeData && "storageLocationName" in log.afterData), "move logs retain warehouse and both location snapshots");
  const listed = await inventory.list(ownerId, { page: 1, pageSize: 50, sort: "STOCKED_AT_DESC" });
  assert(listed.data.find((item) => item.id === source.id)?.displayStorageLocation === `${standardWarehouse.name} / ${standardLocation.name}`, "standard locations display warehouse and standard location name");
  assert(listed.data.find((item) => item.id === manualInventory.id)?.displayStorageLocation === `${manualWarehouse.name} / 货架2-第3层`, "manual locations display warehouse and free-text location");

  assert(!inventoryBulkOperationSchema.safeParse({ ...toManual, payload: { warehouseId: manualWarehouse.id, storageLocation: "X" } }).success, "bulk API requires explicit locationMode");
  assert(!inspectionBatchPassDetailsSchema.safeParse({ items: [detail(noLocationBatch.inspections[0], manualWarehouse.id, { locationMode: "MANUAL", storageLocation: "X", storageLocationId: standardLocation.id })] }).success, "batch API rejects mixed manual and standard identifiers");
  assert(!inspectionBatchPassDetailsSchema.safeParse({ items: [detail(noLocationBatch.inspections[0], standardWarehouse.id, { locationMode: "STANDARD", storageLocation: null })] }).success, "standard mode requires an explicit standard location identifier");
  assert(!inspectionBatchPassDetailsSchema.safeParse({ items: [detail(noLocationBatch.inspections[0], standardWarehouse.id, { locationMode: "STANDARD", storageLocation: "manual-text", storageLocationId: standardLocation.id })] }).success, "standard mode rejects manual location text");
  assert(await rejects(() => bulk.preview(ownerId, { ...toManual, payload: { locationMode: "MANUAL", warehouseId: manualWarehouse.id, storageLocation: "A\u0001", storageLocationId: null } }), "MANUAL_STORAGE_LOCATION_INVALID"), "manual location control characters are rejected");
  assert(await rejects(() => bulk.preview(ownerId, { ...toManual, payload: { locationMode: "MANUAL", warehouseId: otherWarehouse.id, storageLocation: "Other-02", storageLocationId: null } }), "WAREHOUSE_NOT_FOUND"), "bulk moves reject cross-owner warehouses");

  const legacy = await inventoryFixture("legacy-text", null, null, "legacy free text");
  const warehouseOnly = await inventoryFixture("warehouse-only", manualWarehouse.id, null, null);
  const refreshed = await inventory.list(ownerId, { page: 1, pageSize: 50, sort: "STOCKED_AT_DESC" });
  assert(refreshed.data.find((item) => item.id === legacy.id)?.displayStorageLocation === "legacy free text", "legacy free-text locations remain displayable without a warehouse");
  assert(refreshed.data.find((item) => item.id === warehouseOnly.id)?.displayStorageLocation === `${manualWarehouse.name} / 未填写库位`, "warehouse-only inventory displays the explicit missing-location state");
  assert(await db.saleOrder.count({ where: { ownerId, saleNo: { startsWith: runId } } }) === 0 && await db.platformShipmentBatch.count({ where: { ownerId, batchNo: { startsWith: runId } } }) === 0, "manual location workflows create no sales or platform shipments");
  console.log(`verify:m8-manual-storage-location passed: ${checks} checks`);
} finally {
  if (orderIds.length) await db.inventoryItemActionLog.deleteMany({ where: { inventoryItem: { purchaseOrderItem: { purchaseOrderId: { in: orderIds } } } } });
  if (orderIds.length) await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  if (warehouseIds.length) await db.warehouseLocation.deleteMany({ where: { warehouseId: { in: warehouseIds } } });
  if (warehouseIds.length) await db.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
  await db.user.deleteMany({ where: { id: ownerId } });
  await db.user.deleteMany({ where: { id: otherOwnerId } });
  await db.$disconnect();
}
