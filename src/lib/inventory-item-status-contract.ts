/**
 * InventoryItem status contract for the current V1 workflow.
 *
 * The legacy values below are raw historical/external strings only. They are
 * intentionally not members of Prisma's ItemStatus enum and cannot enter an
 * InventoryItem through normal APIs.
 */
export const SUPPORTED_INVENTORY_ITEM_STATUSES = [
  "PENDING_INSPECTION",
  "STOCKED",
  "PLATFORM_SHIPPED",
  "PLATFORM_RECEIVED",
  "PLATFORM_IN_WAREHOUSE",
  "PLATFORM_LISTED",
  "PLATFORM_REJECTED",
  "RETURNING",
  "RETURNED",
  "SOLD",
  "PROBLEM",
] as const;

export const LEGACY_INVENTORY_ITEM_STATUSES = [
  "LISTED",
  "IN_BATCH",
  "SHIPPED_TO_WAREHOUSE",
  "WAREHOUSE_RECEIVED",
  "INBOUND_SUCCESS",
  "INBOUND_FAILED",
  "PENDING_SETTLEMENT",
  "SETTLED",
] as const;

export const SELLABLE_INVENTORY_ITEM_STATUSES = [
  "STOCKED",
  "PLATFORM_SHIPPED",
  "PLATFORM_RECEIVED",
  "PLATFORM_IN_WAREHOUSE",
  "PLATFORM_LISTED",
] as const;

export type SupportedInventoryItemStatus = (typeof SUPPORTED_INVENTORY_ITEM_STATUSES)[number];
export type LegacyInventoryItemStatus = (typeof LEGACY_INVENTORY_ITEM_STATUSES)[number];

const supportedStatuses = new Set<string>(SUPPORTED_INVENTORY_ITEM_STATUSES);
const legacyStatuses = new Set<string>(LEGACY_INVENTORY_ITEM_STATUSES);

export function isSupportedInventoryItemStatus(status: string | null | undefined): status is SupportedInventoryItemStatus {
  return typeof status === "string" && supportedStatuses.has(status);
}

export function isLegacyInventoryItemStatus(status: string | null | undefined): status is LegacyInventoryItemStatus {
  return typeof status === "string" && legacyStatuses.has(status);
}

export function isSellableInventoryItemStatus(status: string | null | undefined) {
  return typeof status === "string" && SELLABLE_INVENTORY_ITEM_STATUSES.includes(status as (typeof SELLABLE_INVENTORY_ITEM_STATUSES)[number]);
}

export const LEGACY_INVENTORY_STATUS_MESSAGE = "库存处于旧流程状态，需先完成状态迁移。";
export const LEGACY_PRE_SALE_STATUS_MESSAGE = "销售前库存状态属于旧流程状态，无法自动恢复，请人工处理。";

/**
 * Dedicated status writers. `PENDING_INSPECTION` is a purchase-order state today;
 * no current service creates an InventoryItem in that state.
 */
export const INVENTORY_ITEM_STATUS_WRITE_PATHS = {
  PENDING_INSPECTION: "当前仅预留；物流签收写入 PurchaseOrder.status，不创建 InventoryItem。",
  STOCKED: "InspectionService.complete/updateCompletedInspection；PlatformReturnInspectionService.inspectReturn(RESTOCKED)。",
  PLATFORM_SHIPPED: "ShipmentService.confirmShipment；applyShipmentLineAction。",
  PLATFORM_RECEIVED: "ShipmentService 与 applyShipmentLineAction。",
  PLATFORM_IN_WAREHOUSE: "ShipmentService 与 applyShipmentLineAction。",
  PLATFORM_LISTED: "ShipmentService 与 applyShipmentLineAction。",
  PLATFORM_REJECTED: "ShipmentService 与 applyShipmentLineAction。",
  RETURNING: "ShipmentService 与 applyShipmentLineAction。",
  RETURNED: "ShipmentService 与 applyShipmentLineAction。",
  SOLD: "SalesService.confirm（唯一销售写入入口）。",
  PROBLEM: "InspectionService.complete/updateCompletedInspection。",
} as const;
