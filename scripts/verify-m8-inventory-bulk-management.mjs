import "dotenv/config";
import { db } from "../src/server/db.ts";
import { InventoryBulkService } from "../src/server/services/inventory-bulk-service.ts";
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
  await db.user.createMany({ data: [{ id: ownerA, name: ownerA }, { id: ownerB, name: ownerB }] });
  const w1 = await warehouseService.create(ownerA, `${runId}-W1`); const l1 = await warehouseService.createLocation(ownerA, w1.id, "A-01");
  const w2 = await warehouseService.create(ownerA, `${runId}-W2`); const l2 = await warehouseService.createLocation(ownerA, w2.id, "B-01");
  const otherW = await warehouseService.create(ownerB, `${runId}-OTHER`); const otherL = await warehouseService.createLocation(ownerB, otherW.id, "X-01");
  warehouseIds.push(w1.id, w2.id, otherW.id);
  const first = await fixture(ownerA, "ONE", w1.id, l1.id); const second = await fixture(ownerA, "TWO", w1.id, l1.id); const other = await fixture(ownerB, "OTHER", otherW.id, otherL.id);
  const move = { inventoryItemIds: [first.id, second.id], operation: "MOVE_LOCATION", payload: { warehouseId: w2.id, storageLocationId: l2.id }, reason: "整理库位", confirmMixedProducts: false };
  const movePreview = await bulk.preview(ownerA, move);
  assert(movePreview.selectedCount === 2 && movePreview.changedCount === 2, "preview returns selected items and changes");
  const moved = await bulk.update(ownerA, { ...move, selectionFingerprint: movePreview.selectionFingerprint });
  assert(moved.updatedCount === 2, "batch move updates all items");
  const movedItems = await db.inventoryItem.findMany({ where: { id: { in: [first.id, second.id] } } });
  assert(movedItems.every((item) => item.warehouseId === w2.id && item.storageLocationId === l2.id && item.itemStatus === "STOCKED"), "move keeps item state unchanged");
  const logs = await db.inventoryItemActionLog.findMany({ where: { inventoryItemId: { in: [first.id, second.id] }, actionType: "MOVE_LOCATION" } });
  assert(logs.length === 2 && logs[0].batchId === logs[1].batchId, "each changed item receives a same-batch audit log");
  const condition = { inventoryItemIds: [first.id, second.id], operation: "SET_CONDITION", payload: { condition: "NEW" }, confirmMixedProducts: true };
  const conditionPreview = await bulk.preview(ownerA, condition); await bulk.update(ownerA, { ...condition, selectionFingerprint: conditionPreview.selectionFingerprint });
  assert((await db.inventoryItem.count({ where: { id: { in: [first.id, second.id] }, condition: "NEW" } })) === 2, "condition update succeeds");
  const saleMode = { inventoryItemIds: [first.id], operation: "SET_SALE_MODE", payload: { saleMode: "XIANYU" }, confirmMixedProducts: false };
  const salePreview = await bulk.preview(ownerA, saleMode); await bulk.update(ownerA, { ...saleMode, selectionFingerprint: salePreview.selectionFingerprint });
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: first.id } })).saleMode === "XIANYU", "sale mode is a metadata-only update");
  const shelf = { inventoryItemIds: [first.id], operation: "SET_SHELF_LIFE", payload: { productionDate: { mode: "SET", value: "2026-01-31" }, shelfLifeMonths: { mode: "SET", value: 1 }, expiryDate: { mode: "AUTO" } }, reason: "核对实物包装", confirmMixedProducts: false };
  const shelfPreview = await bulk.preview(ownerA, shelf); await bulk.update(ownerA, { ...shelf, selectionFingerprint: shelfPreview.selectionFingerprint });
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: first.id } })).expiryDate?.toISOString().startsWith("2026-02-28"), "shelf life uses clamped calendar-month expiry");
  assert(await rejects(() => bulk.preview(ownerA, { ...move, payload: { warehouseId: w1.id, storageLocationId: otherL.id } }), "WAREHOUSE_LOCATION_NOT_FOUND"), "cross-owner location is rejected");
  assert(await rejects(() => bulk.preview(ownerA, { ...move, payload: { warehouseId: w1.id, storageLocationId: l2.id } }), "WAREHOUSE_LOCATION_MISMATCH"), "mismatched warehouse location is rejected");
  assert(await rejects(() => bulk.preview(ownerA, { ...move, inventoryItemIds: [first.id, first.id] }), "INVENTORY_BULK_DUPLICATE_ID"), "duplicate IDs are rejected");
  assert(await rejects(() => bulk.preview(ownerA, { ...move, inventoryItemIds: [other.id] }), "INVENTORY_BULK_CROSS_OWNER"), "cross-owner inventory is rejected");
  await db.inventoryItem.update({ where: { id: second.id }, data: { itemStatus: "SOLD" } });
  const locked = await bulk.preview(ownerA, { ...move, inventoryItemIds: [first.id, second.id] });
  assert(locked.blockedCount === 1, "sold inventory is shown as a blocking item");
  assert(await rejects(() => bulk.update(ownerA, { ...move, inventoryItemIds: [first.id, second.id], selectionFingerprint: locked.selectionFingerprint }), "INVENTORY_BULK_ITEM_LOCKED"), "locked selection is all-or-nothing");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: first.id } })).warehouseId === w2.id, "failed batch leaves editable item unchanged");
  console.log(`verify:m8-inventory-bulk-management passed: ${checks} checks`);
} finally {
  if (orderIds.length) await db.inventoryItemActionLog.deleteMany({ where: { inventoryItem: { purchaseOrderItem: { purchaseOrderId: { in: orderIds } } } } });
  if (orderIds.length) await db.inventoryItem.deleteMany({ where: { purchaseOrderItem: { purchaseOrderId: { in: orderIds } } } });
  if (orderIds.length) await db.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  if (warehouseIds.length) await db.warehouseLocation.deleteMany({ where: { warehouseId: { in: warehouseIds } } });
  if (warehouseIds.length) await db.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
  await db.user.deleteMany({ where: { id: { in: [ownerA, ownerB] } } });
}
