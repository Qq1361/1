import "dotenv/config";
import { db } from "../src/server/db.ts";
import { InventoryBulkService } from "../src/server/services/inventory-bulk-service.ts";
import { InventoryService } from "../src/server/services/inventory-service.ts";
import { WarehouseService } from "../src/server/services/warehouse-service.ts";

const runId = `M8-BULK-${Date.now()}`;
const ownerA = `${runId}-owner-a`;
const ownerB = `${runId}-owner-b`;
const orderIds = [];
const warehouseIds = [];
let checks = 0;
const assert = (value, message) => { if (!value) throw new Error(message); checks += 1; };
async function rejects(work, code) { try { await work(); } catch (error) { return error?.code === code; } return false; }

async function fixture(ownerId, suffix, warehouseId, storageLocationId, extra = {}) {
  const order = await db.purchaseOrder.create({ data: { ownerId, orderNo: `${runId}-${suffix}`, paidAt: new Date("2026-07-20T00:00:00Z"), totalAmount: "10", shippingAmount: "0", items: { create: { name: `${runId}-${suffix}`, quantity: 1 } } }, include: { items: true } });
  orderIds.push(order.id);
  const inspection = await db.inspection.create({ data: { ownerId, purchaseOrderItemId: order.items[0].id, sequence: 1, status: "PENDING" } });
  return db.inventoryItem.create({ data: { ownerId, purchaseOrderItemId: order.items[0].id, inspectionId: inspection.id, inventoryCode: `${runId}-${suffix}`, name: `${runId}-${suffix}`, unitCost: "10", itemStatus: "STOCKED", ownershipStatus: "OWNED", stockedAt: new Date("2026-07-20T00:00:00Z"), warehouseId, storageLocationId, condition: "LIKE_NEW", ...extra } });
}

try {
  const warehouseService = new WarehouseService();
  const bulk = new InventoryBulkService();
  const inventory = new InventoryService();
  await db.user.createMany({ data: [{ id: ownerA, name: ownerA }, { id: ownerB, name: ownerB }] });
  const w1 = await warehouseService.create(ownerA, `${runId}-W1`); const l1 = await warehouseService.createLocation(ownerA, w1.id, "A-01");
  const w2 = await warehouseService.create(ownerA, `${runId}-W2`); const l2 = await warehouseService.createLocation(ownerA, w2.id, "B-01");
  const otherW = await warehouseService.create(ownerB, `${runId}-OTHER`); const otherL = await warehouseService.createLocation(ownerB, otherW.id, "X-01");
  warehouseIds.push(w1.id, w2.id, otherW.id);
  const first = await fixture(ownerA, "ONE", w1.id, l1.id); const second = await fixture(ownerA, "TWO", w1.id, l1.id); const other = await fixture(ownerB, "OTHER", otherW.id, otherL.id);
  const selection = await inventory.selectAllMatching(ownerA, { page: 1, pageSize: 20, sort: "STOCKED_AT_DESC" });
  assert(selection.total === 2 && new Set(selection.inventoryItemIds).size === 2, "selection endpoint returns the complete owner-scoped ID set");
  assert(await rejects(() => bulk.preview(ownerA, { inventoryItemIds: Array.from({ length: 201 }, () => first.id), operation: "SET_SALE_MODE", payload: { saleMode: "NONE" }, confirmMixedProducts: false }), "INVENTORY_BULK_TOO_MANY"), "more than 200 selected IDs are rejected before any write");
  const move = { inventoryItemIds: [first.id, second.id], operation: "MOVE_LOCATION", payload: { warehouseId: w2.id, storageLocationId: l2.id }, reason: "整理库位", confirmMixedProducts: false };
  const movePreview = await bulk.preview(ownerA, move);
  assert(movePreview.selectedCount === 2 && movePreview.changedCount === 2, "preview returns selected items and changes");
  assert(movePreview.blockedCount === 0 && movePreview.changes.every((change) => (
    change.before.warehouseId === w1.id
    && change.before.warehouseName === `${runId}-W1`
    && change.before.storageLocationId === l1.id
    && change.before.storageLocationName === "A-01"
    && change.after.warehouseId === w2.id
    && change.after.warehouseName === `${runId}-W2`
    && change.after.storageLocationId === l2.id
    && change.after.storageLocationName === "B-01"
  )), "move preview exposes old and target warehouse and location names without blocking editable inventory");
  const moved = await bulk.update(ownerA, { ...move, selectionFingerprint: movePreview.selectionFingerprint });
  assert(moved.updatedCount === 2, "batch move updates all items");
  assert(Boolean(moved.batchId), "successful batch update returns its audit batch ID");
  const movedItems = await db.inventoryItem.findMany({ where: { id: { in: [first.id, second.id] } } });
  assert(movedItems.every((item) => item.warehouseId === w2.id && item.storageLocationId === l2.id && item.itemStatus === "STOCKED"), "move keeps item state unchanged");
  assert(movedItems.every((item) => item.unitCost.toString() === "10"), "move keeps unit cost unchanged");
  const logs = await db.inventoryItemActionLog.findMany({ where: { inventoryItemId: { in: [first.id, second.id] }, actionType: "MOVE_LOCATION" } });
  assert(logs.length === 2 && logs[0].batchId === logs[1].batchId, "each changed item receives a same-batch audit log");
  assert(logs.every((log) => log.ownerId === ownerA && log.beforeData && log.afterData && log.createdAt), "audit logs contain owner, snapshots and timestamp");
  assert(logs.every((log) => log.beforeData.warehouseId === w1.id && log.afterData.warehouseId === w2.id), "move audit snapshots include before and after locations");
  const inactiveWarehouse = await warehouseService.create(ownerA, `${runId}-INACTIVE-W`); const inactiveLocation = await warehouseService.createLocation(ownerA, inactiveWarehouse.id, "OFF-W"); warehouseIds.push(inactiveWarehouse.id);
  await db.warehouse.update({ where: { id: inactiveWarehouse.id }, data: { isActive: false } });
  assert(await rejects(() => bulk.preview(ownerA, { ...move, payload: { warehouseId: inactiveWarehouse.id, storageLocationId: inactiveLocation.id } }), "WAREHOUSE_INACTIVE"), "inactive target warehouse is rejected");
  const inactiveLocationOnly = await warehouseService.createLocation(ownerA, w2.id, "OFF-L");
  await db.warehouseLocation.update({ where: { id: inactiveLocationOnly.id }, data: { isActive: false } });
  assert(await rejects(() => bulk.preview(ownerA, { ...move, payload: { warehouseId: w2.id, storageLocationId: inactiveLocationOnly.id } }), "WAREHOUSE_LOCATION_INACTIVE"), "inactive target location is rejected");
  const condition = { inventoryItemIds: [first.id, second.id], operation: "SET_CONDITION", payload: { condition: "NEW" }, confirmMixedProducts: true };
  const conditionWithoutConfirmation = { ...condition, confirmMixedProducts: false };
  const unconfirmedPreview = await bulk.preview(ownerA, conditionWithoutConfirmation);
  assert(unconfirmedPreview.requiresMixedProductConfirmation, "mixed-product condition preview requires explicit confirmation");
  assert(await rejects(() => bulk.update(ownerA, { ...conditionWithoutConfirmation, selectionFingerprint: unconfirmedPreview.selectionFingerprint }), "INVENTORY_BULK_MIXED_PRODUCTS_CONFIRMATION_REQUIRED"), "mixed-product condition update is rejected without confirmation");
  const conditionPreview = await bulk.preview(ownerA, condition); assert(conditionPreview.changedCount === 2, "confirmed condition preview reports each changed item"); await bulk.update(ownerA, { ...condition, selectionFingerprint: conditionPreview.selectionFingerprint });
  assert((await db.inventoryItem.count({ where: { id: { in: [first.id, second.id] }, condition: "NEW" } })) === 2, "condition update succeeds");
  const saleMode = { inventoryItemIds: [first.id], operation: "SET_SALE_MODE", payload: { saleMode: "XIANYU" }, confirmMixedProducts: false };
  const salePreview = await bulk.preview(ownerA, saleMode); await bulk.update(ownerA, { ...saleMode, selectionFingerprint: salePreview.selectionFingerprint });
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: first.id } })).saleMode === "XIANYU", "sale mode is a metadata-only update");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: first.id } })).itemStatus === "STOCKED", "sale mode does not write inventory status");
  const beforePreviewLogs = await db.inventoryItemActionLog.count({ where: { inventoryItemId: first.id } });
  const readOnlyPreview = await bulk.preview(ownerA, { ...saleMode, payload: { saleMode: "NONE" } });
  assert((await db.inventoryItemActionLog.count({ where: { inventoryItemId: first.id } })) === beforePreviewLogs && readOnlyPreview.changedCount === 1, "preview is read-only and returns per-item changes");
  const skuFirst = await fixture(ownerA, "SKU-EMPTY", w2.id, l2.id, { name: `${runId}-SKU` });
  const skuExisting = await fixture(ownerA, "SKU-EXISTING", w2.id, l2.id, { name: `${runId}-SKU`, skuText: "1W1" });
  const skuSold = await fixture(ownerA, "SKU-SOLD", w2.id, l2.id, { name: `${runId}-SKU`, itemStatus: "SOLD" });
  const skuInput = { inventoryItemIds: [skuFirst.id, skuExisting.id, skuSold.id], skuText: " 2c0 ", overwriteExisting: false, allowMixedProducts: false, includeHistorical: false };
  const skuActionCount = await db.inventoryActionLog.count({ where: { inventoryItemId: { in: skuInput.inventoryItemIds } } });
  const skuPreview = await inventory.previewBulkSku(ownerA, skuInput);
  assert(skuPreview.updateCount === 1 && skuPreview.skippedCount === 2, "SKU preview only plans empty SKU updates by default");
  assert(skuPreview.changes.some((change) => change.inventoryItemId === skuFirst.id && change.oldSku === null && change.newSku === "2C0" && change.willUpdate), "SKU preview normalizes and shows an empty SKU update");
  assert(skuPreview.changes.some((change) => change.inventoryItemId === skuExisting.id && change.result === "SKU_ALREADY_EXISTS"), "SKU preview retains existing SKU unless overwrite is confirmed");
  assert(skuPreview.changes.some((change) => change.inventoryItemId === skuSold.id && change.result === "HISTORICAL_ITEM_EXCLUDED"), "SKU preview excludes SOLD history unless explicitly included");
  assert((await db.inventoryActionLog.count({ where: { inventoryItemId: { in: skuInput.inventoryItemIds } } })) === skuActionCount, "SKU preview does not write audit logs or inventory data");
  const skuUpdated = await inventory.bulkUpdateSku(ownerA, { ...skuInput, selectionFingerprint: skuPreview.selectionFingerprint });
  assert(skuUpdated.updatedCount === 1 && skuUpdated.skippedCount === 2, "SKU confirmation only updates preview-planned inventory");
  const skuAfterFirstUpdate = await db.inventoryItem.findMany({ where: { id: { in: skuInput.inventoryItemIds } } });
  assert(skuAfterFirstUpdate.find((item) => item.id === skuFirst.id)?.skuText === "2C0" && skuAfterFirstUpdate.find((item) => item.id === skuExisting.id)?.skuText === "1W1" && skuAfterFirstUpdate.find((item) => item.id === skuSold.id)?.skuText === null, "SKU confirmation preserves existing and excluded historical records");
  const skuConcurrentPreview = await inventory.previewBulkSku(ownerA, { inventoryItemIds: [skuFirst.id, skuExisting.id], skuText: "3n1", overwriteExisting: true, allowMixedProducts: false, includeHistorical: false });
  await db.inventoryItem.update({ where: { id: skuExisting.id }, data: { skuText: "CONCURRENT" } });
  assert(await rejects(() => inventory.bulkUpdateSku(ownerA, { inventoryItemIds: [skuFirst.id, skuExisting.id], skuText: "3n1", overwriteExisting: true, allowMixedProducts: false, includeHistorical: false, selectionFingerprint: skuConcurrentPreview.selectionFingerprint }), "INVENTORY_BULK_SELECTION_CHANGED"), "stale SKU preview rejects the complete confirmation without partial writes");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: skuFirst.id } })).skuText === "2C0", "stale SKU confirmation leaves previously previewed items unchanged");
  const historicalSkuPreview = await inventory.previewBulkSku(ownerA, { inventoryItemIds: [skuSold.id], skuText: "4n1", overwriteExisting: false, allowMixedProducts: false, includeHistorical: true });
  await inventory.bulkUpdateSku(ownerA, { inventoryItemIds: [skuSold.id], skuText: "4n1", overwriteExisting: false, allowMixedProducts: false, includeHistorical: true, selectionFingerprint: historicalSkuPreview.selectionFingerprint });
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: skuSold.id } })).skuText === "4N1", "including SOLD history changes only its inventory archive SKU");
  const shelf = { inventoryItemIds: [first.id], operation: "SET_SHELF_LIFE", payload: { productionDate: { mode: "SET", value: "2026-01-31" }, shelfLifeMonths: { mode: "SET", value: 1 }, expiryDate: { mode: "AUTO" } }, reason: "核对实物包装", confirmMixedProducts: false };
  const shelfPreview = await bulk.preview(ownerA, shelf); await bulk.update(ownerA, { ...shelf, selectionFingerprint: shelfPreview.selectionFingerprint });
  assert(shelfPreview.requiresReason && shelfPreview.requiresMixedProductConfirmation === false, "single-product shelf-life preview declares its required reason without a mixed-product prompt");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: first.id } })).expiryDate?.toISOString().startsWith("2026-02-28"), "shelf life uses clamped calendar-month expiry");
  assert(await rejects(() => bulk.update(ownerA, { ...shelf, reason: "", selectionFingerprint: shelfPreview.selectionFingerprint }), "SHELF_LIFE_REASON_REQUIRED"), "shelf life update requires a reason");
  const clearShelf = { inventoryItemIds: [first.id], operation: "SET_SHELF_LIFE", payload: { productionDate: { mode: "CLEAR" }, shelfLifeMonths: { mode: "CLEAR" }, expiryDate: { mode: "CLEAR" } }, reason: "实物无日期", confirmMixedProducts: false };
  const clearShelfPreview = await bulk.preview(ownerA, clearShelf); await bulk.update(ownerA, { ...clearShelf, selectionFingerprint: clearShelfPreview.selectionFingerprint });
  const shelfCleared = await db.inventoryItem.findUniqueOrThrow({ where: { id: first.id } });
  assert(shelfCleared.productionDate === null && shelfCleared.shelfLifeMonths === null && shelfCleared.expiryDate === null, "shelf-life fields can be cleared explicitly");
  assert(await rejects(() => bulk.preview(ownerA, { ...shelf, payload: { ...shelf.payload, productionDate: { mode: "SET", value: "2026-01-31T00:00:00Z" } } }), "SHELF_LIFE_DATE_INVALID"), "ISO date-time input is rejected");
  assert(await rejects(() => bulk.preview(ownerA, { ...move, payload: { warehouseId: w1.id, storageLocationId: otherL.id } }), "WAREHOUSE_LOCATION_NOT_FOUND"), "cross-owner location is rejected");
  assert(await rejects(() => bulk.preview(ownerA, { ...move, payload: { warehouseId: w1.id, storageLocationId: l2.id } }), "WAREHOUSE_LOCATION_MISMATCH"), "mismatched warehouse location is rejected");
  assert(await rejects(() => bulk.preview(ownerA, { ...move, inventoryItemIds: [first.id, first.id] }), "INVENTORY_BULK_DUPLICATE_ID"), "duplicate IDs are rejected");
  assert(await rejects(() => bulk.preview(ownerA, { ...move, inventoryItemIds: [other.id] }), "INVENTORY_BULK_CROSS_OWNER"), "cross-owner inventory is rejected");
  await db.inventoryItem.update({ where: { id: second.id }, data: { itemStatus: "SOLD" } });
  const locked = await bulk.preview(ownerA, { ...move, inventoryItemIds: [first.id, second.id] });
  assert(locked.blockedCount === 1, "sold inventory is shown as a blocking item");
  assert(await rejects(() => bulk.update(ownerA, { ...move, inventoryItemIds: [first.id, second.id], selectionFingerprint: locked.selectionFingerprint }), "INVENTORY_BULK_ITEM_LOCKED"), "locked selection is all-or-nothing");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: first.id } })).warehouseId === w2.id, "failed batch leaves editable item unchanged");
  const conflictPreview = await bulk.preview(ownerA, { ...saleMode, inventoryItemIds: [first.id], payload: { saleMode: "OTHER" } });
  await db.inventoryItem.update({ where: { id: first.id }, data: { skuText: "CONCURRENT" } });
  assert(await rejects(() => bulk.update(ownerA, { ...saleMode, inventoryItemIds: [first.id], payload: { saleMode: "OTHER" }, selectionFingerprint: conflictPreview.selectionFingerprint }), "INVENTORY_BULK_SELECTION_CHANGED"), "stale preview fingerprint rejects concurrent changes");
  const saleOrder = await db.saleOrder.create({ data: { ownerId: ownerA, saleNo: `${runId}-SALE`, platform: "OTHER", soldAt: new Date(), grossAmount: "10" } });
  const saleLocked = await fixture(ownerA, "SALE-LOCK", w2.id, l2.id);
  await db.saleLine.create({ data: { ownerId: ownerA, saleOrderId: saleOrder.id, inventoryItemId: saleLocked.id, inventoryCodeSnapshot: saleLocked.inventoryCode, productNameSnapshot: saleLocked.name, unitCostSnapshot: "10", saleAmount: "10", costAmount: "10", profitAmount: "0", preSaleItemStatus: "STOCKED" } });
  assert((await bulk.preview(ownerA, { ...saleMode, inventoryItemIds: [saleLocked.id] })).blockedCount === 1, "sales-line related inventory is locked");
  const shipmentBatch = await db.platformShipmentBatch.create({ data: { ownerId: ownerA, batchNo: `${runId}-SHIP`, platform: "OTHER", defaultPurpose: "OTHER" } });
  const shipmentLocked = await fixture(ownerA, "SHIP-LOCK", w2.id, l2.id);
  await db.platformShipmentLine.create({ data: { ownerId: ownerA, batchId: shipmentBatch.id, inventoryItemId: shipmentLocked.id, inventoryCodeSnapshot: shipmentLocked.inventoryCode, productNameSnapshot: shipmentLocked.name, unitCostSnapshot: "10", sourcePurchaseOrderId: orderIds.at(-1) } });
  assert((await bulk.preview(ownerA, { ...saleMode, inventoryItemIds: [shipmentLocked.id] })).blockedCount === 1, "platform-shipment related inventory is locked");
  console.log(`verify:m8-inventory-bulk-management passed: ${checks} checks`);
} finally {
  await db.saleOrder.deleteMany({ where: { ownerId: ownerA } }).catch(() => undefined);
  await db.platformShipmentBatch.deleteMany({ where: { ownerId: ownerA } }).catch(() => undefined);
  if (orderIds.length) await db.inventoryItemActionLog.deleteMany({ where: { inventoryItem: { purchaseOrderItem: { purchaseOrderId: { in: orderIds } } } } });
  if (orderIds.length) await db.inventoryItem.deleteMany({ where: { purchaseOrderItem: { purchaseOrderId: { in: orderIds } } } });
  if (orderIds.length) await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  if (warehouseIds.length) await db.warehouseLocation.deleteMany({ where: { warehouseId: { in: warehouseIds } } });
  if (warehouseIds.length) await db.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
  await db.user.deleteMany({ where: { id: { in: [ownerA, ownerB] } } });
}
