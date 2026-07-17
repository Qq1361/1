import "dotenv/config";
import { db } from "../src/server/db.ts";

const legacyStatuses = [
  "LISTED",
  "IN_BATCH",
  "SHIPPED_TO_WAREHOUSE",
  "WAREHOUSE_RECEIVED",
  "INBOUND_SUCCESS",
  "INBOUND_FAILED",
  "PENDING_SETTLEMENT",
  "SETTLED",
];

function emptyStatusCounts() {
  return Object.fromEntries(legacyStatuses.map((status) => [status, 0]));
}

function toStatusCounts(rows, field) {
  const counts = emptyStatusCounts();
  for (const row of rows) counts[row[field]] = Number(row._count?._all ?? row.count ?? 0);
  return counts;
}

function readCount(rows) {
  return Number(rows[0]?.count ?? 0);
}

try {
  const enumRows = await db.$queryRaw`
    SELECT enumlabel
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'ItemStatus'
    ORDER BY enumsortorder
  `;
  const presentEnumValues = new Set(enumRows.map((row) => row.enumlabel));
  const legacyEnumValuesPresent = legacyStatuses.some((status) => presentEnumValues.has(status));

  const [snapshotRows, pendingInspectionPurchaseOrderCount, openInspectionCount] = await Promise.all([
    db.saleLine.groupBy({
      by: ["preSaleItemStatus"],
      where: { preSaleItemStatus: { in: legacyStatuses } },
      _count: { _all: true },
    }),
    db.purchaseOrder.count({ where: { status: "PENDING_INSPECTION" } }),
    db.inspection.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } }),
  ]);
  const inventoryItemCountPromise = db.inventoryItem.count({ where: { itemStatus: "PENDING_INSPECTION" } });
  const migrationPreflight = legacyEnumValuesPresent ? await Promise.all([
    db.$queryRaw`
      SELECT "itemStatus"::text AS "itemStatus", COUNT(*)::int AS count
      FROM "inventory_items"
      WHERE "itemStatus"::text = ANY (ARRAY['LISTED', 'IN_BATCH', 'SHIPPED_TO_WAREHOUSE', 'WAREHOUSE_RECEIVED', 'INBOUND_SUCCESS', 'INBOUND_FAILED', 'PENDING_SETTLEMENT', 'SETTLED'])
      GROUP BY "itemStatus"
    `,
    db.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "sale_lines" line
      JOIN "sale_orders" sale_order ON sale_order.id = line."saleOrderId"
      JOIN "inventory_items" inventory_item ON inventory_item.id = line."inventoryItemId"
      WHERE sale_order.status::text IN ('CONFIRMED', 'SETTLED')
        AND inventory_item."itemStatus"::text = ANY (ARRAY['LISTED', 'IN_BATCH', 'SHIPPED_TO_WAREHOUSE', 'WAREHOUSE_RECEIVED', 'INBOUND_SUCCESS', 'INBOUND_FAILED', 'PENDING_SETTLEMENT', 'SETTLED'])
    `,
    db.saleLine.count({
      where: {
        saleOrder: { status: { in: ["CONFIRMED", "SETTLED"] } },
        preSaleItemStatus: { in: legacyStatuses },
      },
    }),
    db.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "sale_lines" line
      JOIN "sale_orders" sale_order ON sale_order.id = line."saleOrderId"
      JOIN "inventory_items" inventory_item ON inventory_item.id = line."inventoryItemId"
      WHERE sale_order.status::text = 'DRAFT'
        AND inventory_item."itemStatus"::text = ANY (ARRAY['LISTED', 'IN_BATCH', 'SHIPPED_TO_WAREHOUSE', 'WAREHOUSE_RECEIVED', 'INBOUND_SUCCESS', 'INBOUND_FAILED', 'PENDING_SETTLEMENT', 'SETTLED'])
    `,
    db.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "platform_shipment_lines" line
      JOIN "inventory_items" inventory_item ON inventory_item.id = line."inventoryItemId"
      WHERE line."lineStatus"::text <> 'CANCELLED'
        AND inventory_item."itemStatus"::text = ANY (ARRAY['LISTED', 'IN_BATCH', 'SHIPPED_TO_WAREHOUSE', 'WAREHOUSE_RECEIVED', 'INBOUND_SUCCESS', 'INBOUND_FAILED', 'PENDING_SETTLEMENT', 'SETTLED'])
    `,
    db.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "platform_shipment_lines" line
      JOIN "platform_shipment_batches" batch ON batch.id = line."batchId"
      JOIN "inventory_items" inventory_item ON inventory_item.id = line."inventoryItemId"
      WHERE batch.status::text NOT IN ('COMPLETED', 'CANCELLED')
        AND inventory_item."itemStatus"::text = ANY (ARRAY['LISTED', 'IN_BATCH', 'SHIPPED_TO_WAREHOUSE', 'WAREHOUSE_RECEIVED', 'INBOUND_SUCCESS', 'INBOUND_FAILED', 'PENDING_SETTLEMENT', 'SETTLED'])
    `,
  ]) : null;

  const [inventoryRows, effectiveSalesWithLegacyInventoryRows, effectiveSalesWithLegacySnapshot, draftSalesWithLegacyInventoryRows, effectiveShipmentLinesWithLegacyInventoryRows, activeShipmentLinesWithLegacyInventoryRows] = migrationPreflight ?? [[], [], 0, [], [], []];
  const effectiveSalesWithLegacyInventory = readCount(effectiveSalesWithLegacyInventoryRows);
  const draftSalesWithLegacyInventory = readCount(draftSalesWithLegacyInventoryRows);
  const effectiveShipmentLinesWithLegacyInventory = readCount(effectiveShipmentLinesWithLegacyInventoryRows);
  const activeShipmentLinesWithLegacyInventory = readCount(activeShipmentLinesWithLegacyInventoryRows);
  const inventoryItems = toStatusCounts(inventoryRows, "itemStatus");
  const saleLineSnapshots = toStatusCounts(snapshotRows, "preSaleItemStatus");
  const inventoryItemLegacyTotal = Object.values(inventoryItems).reduce((sum, count) => sum + count, 0);
  const saleLineSnapshotLegacyTotal = Object.values(saleLineSnapshots).reduce((sum, count) => sum + count, 0);
  const blockingReasons = [];

  if (inventoryItemLegacyTotal) blockingReasons.push(`InventoryItem.itemStatus contains ${inventoryItemLegacyTotal} legacy record(s).`);
  if (legacyEnumValuesPresent) {
    if (saleLineSnapshotLegacyTotal) blockingReasons.push(`SaleLine.preSaleItemStatus contains ${saleLineSnapshotLegacyTotal} legacy snapshot(s).`);
    if (effectiveSalesWithLegacyInventory) blockingReasons.push(`${effectiveSalesWithLegacyInventory} confirmed/settled sale line(s) reference legacy-status inventory.`);
    if (effectiveSalesWithLegacySnapshot) blockingReasons.push(`${effectiveSalesWithLegacySnapshot} confirmed/settled sale line(s) contain legacy pre-sale snapshots.`);
    if (draftSalesWithLegacyInventory) blockingReasons.push(`${draftSalesWithLegacyInventory} draft sale line(s) reference legacy-status inventory.`);
    if (effectiveShipmentLinesWithLegacyInventory) blockingReasons.push(`${effectiveShipmentLinesWithLegacyInventory} non-cancelled shipment line(s) reference legacy-status inventory.`);
    if (activeShipmentLinesWithLegacyInventory) blockingReasons.push(`${activeShipmentLinesWithLegacyInventory} unfinished shipment batch line(s) reference legacy-status inventory.`);
  }

  const pendingInspectionInventoryCount = await inventoryItemCountPromise;
  const result = {
    legacyEnumValuesPresent,
    alreadyRetired: !legacyEnumValuesPresent,
    safeToRemoveLegacyEnumValues: !legacyEnumValuesPresent || blockingReasons.length === 0,
    legacyStatuses,
    inventoryItems,
    saleLineSnapshots,
    activeSalesReferences: {
      confirmedOrSettledWithLegacyInventory: effectiveSalesWithLegacyInventory,
      confirmedOrSettledWithLegacySnapshot: effectiveSalesWithLegacySnapshot,
      draftWithLegacyInventory: draftSalesWithLegacyInventory,
    },
    shipmentReferences: {
      nonCancelledLinesWithLegacyInventory: effectiveShipmentLinesWithLegacyInventory,
      unfinishedBatchLinesWithLegacyInventory: activeShipmentLinesWithLegacyInventory,
    },
    pendingInspectionAudit: {
      inventoryItemCount: pendingInspectionInventoryCount,
      purchaseOrderCount: pendingInspectionPurchaseOrderCount,
      openInspectionCount,
      note: "PENDING_INSPECTION is currently a purchase-order lifecycle state. InventoryItem records are created on inspection completion, so this value is retained as pending design work rather than a deletion candidate.",
    },
    blockingReasons,
  };

  console.log(JSON.stringify(result, null, 2));
  if (legacyEnumValuesPresent && !result.safeToRemoveLegacyEnumValues) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
