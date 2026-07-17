/**
 * M3-0 Platform Shipment Status Machine
 * Single source of truth for all shipment line state transitions.
 * Never modify these rules in UI code without updating this file.
 */

export type ShipmentLineActionKey =
  | "confirmShipped"
  | "markReceived"
  | "markInWarehouse"
  | "markListed"
  | "markRejected"
  | "markReturning"
  | "markReturned"
  | "confirmRestocked";

export interface ShipmentLineAction {
  key: ShipmentLineActionKey;
  label: string;
  purposeLabelOverrides?: Partial<Record<string, string>>;
  allowedFrom: string[];
  nextLineStatus: string;
  nextInventoryStatus: string;
  requiresInput: boolean;
  requiredFields?: string[];
  dangerousConfirmMessage?: string;
}

// Core: ALLOWED line status transitions
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SHIPPED"],
  SHIPPED: ["RECEIVED", "REJECTED", "RETURNING"],
  RECEIVED: ["IN_WAREHOUSE", "LISTED", "REJECTED", "RETURNING"],
  IN_WAREHOUSE: ["LISTED", "REJECTED", "RETURNING"],
  LISTED: ["REJECTED", "RETURNING"],
  REJECTED: ["RETURNING"],
  RETURNING: ["RETURNED"],
  RETURNED: [], // Only confirmRestocked (special — doesn't change lineStatus further)
  CANCELLED: [],
  SOLD: [],
};

// LineStatus → InventoryItem.itemStatus mapping
export const LINE_TO_INVENTORY_STATUS: Record<string, string> = {
  DRAFT: "STOCKED",
  SHIPPED: "PLATFORM_SHIPPED",
  RECEIVED: "PLATFORM_RECEIVED",
  IN_WAREHOUSE: "PLATFORM_IN_WAREHOUSE",
  LISTED: "PLATFORM_LISTED",
  REJECTED: "PLATFORM_REJECTED",
  RETURNING: "RETURNING",
  RETURNED: "RETURNED",
  CANCELLED: "STOCKED",
};

// ItemStatus that CANNOT join any new shipment batch
export const NON_SELECTABLE_STATUSES = [
  "PLATFORM_SHIPPED", "PLATFORM_RECEIVED", "PLATFORM_IN_WAREHOUSE",
  "PLATFORM_LISTED", "PLATFORM_REJECTED", "RETURNING", "RETURNED",
  "SOLD", "PROBLEM",
];

// Active line statuses that block re-selection
export const ACTIVE_SHIPMENT_STATUSES = ["DRAFT", "SHIPPED", "RECEIVED", "IN_WAREHOUSE", "LISTED"];

// Terminated line statuses
export const TERMINAL_LINE_STATUSES = ["LISTED", "RETURNED", "REJECTED", "CANCELLED", "SOLD"];

// All defined actions
export const SHIPMENT_LINE_ACTIONS: ShipmentLineAction[] = [
  {
    key: "confirmShipped", label: "确认发货",
    allowedFrom: ["DRAFT"], nextLineStatus: "SHIPPED", nextInventoryStatus: "PLATFORM_SHIPPED",
    requiresInput: false, dangerousConfirmMessage: "确认发货后库存状态将变为已发往平台，确定继续？",
  },
  {
    key: "markReceived", label: "平台已签收",
    purposeLabelOverrides: {},
    allowedFrom: ["SHIPPED"], nextLineStatus: "RECEIVED", nextInventoryStatus: "PLATFORM_RECEIVED",
    requiresInput: false,
  },
  {
    key: "markInWarehouse", label: "入仓成功",
    purposeLabelOverrides: { DEWU_STANDARD_FULFILLMENT: "鉴别通过/待结算" },
    allowedFrom: ["RECEIVED"], nextLineStatus: "IN_WAREHOUSE", nextInventoryStatus: "PLATFORM_IN_WAREHOUSE",
    requiresInput: false, dangerousConfirmMessage: "入仓成功不等于已售出，仅代表平台已接收库存。",
  },
  {
    key: "markListed", label: "上架/可售",
    allowedFrom: ["RECEIVED", "IN_WAREHOUSE"], nextLineStatus: "LISTED", nextInventoryStatus: "PLATFORM_LISTED",
    requiresInput: false, dangerousConfirmMessage: "上架可售不等于已售出，仅代表库存已上架平台。",
  },
  {
    key: "markRejected", label: "平台拒收",
    allowedFrom: ["SHIPPED", "RECEIVED", "IN_WAREHOUSE", "LISTED"],
    nextLineStatus: "REJECTED", nextInventoryStatus: "PLATFORM_REJECTED",
    requiresInput: true, requiredFields: ["rejectedReason"],
  },
  {
    key: "markReturning", label: "退回中",
    allowedFrom: ["SHIPPED", "RECEIVED", "IN_WAREHOUSE", "LISTED", "REJECTED"],
    nextLineStatus: "RETURNING", nextInventoryStatus: "RETURNING",
    requiresInput: false,
  },
  {
    key: "markReturned", label: "已退回本地",
    allowedFrom: ["RETURNING"], nextLineStatus: "RETURNED", nextInventoryStatus: "RETURNED",
    requiresInput: true, requiredFields: ["returnedStorageLocation"],
  },
  {
    key: "confirmRestocked", label: "确认重新入库",
    allowedFrom: ["RETURNED"], nextLineStatus: "RETURNED", nextInventoryStatus: "STOCKED",
    requiresInput: true, requiredFields: ["storageLocation"],
    dangerousConfirmMessage: "确认后该库存将恢复为本地库存，可再次加入新批次。",
  },
];

export function getAction(key: ShipmentLineActionKey): ShipmentLineAction | undefined {
  return SHIPMENT_LINE_ACTIONS.find(a => a.key === key);
}

export function getActionLabel(key: ShipmentLineActionKey, purpose?: string): string {
  const action = getAction(key);
  if (!action) return key;
  if (purpose && action.purposeLabelOverrides?.[purpose]) return action.purposeLabelOverrides[purpose];
  return action.label;
}

export function getAvailableActions(lineStatus: string, purpose?: string): ShipmentLineAction[] {
  return SHIPMENT_LINE_ACTIONS.filter(a => a.allowedFrom.includes(lineStatus));
}

export function canTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export function lineStatusToItemStatus(lineStatus: string): string {
  return LINE_TO_INVENTORY_STATUS[lineStatus] || "STOCKED";
}

export function isLineStatusActive(status: string): boolean {
  return ACTIVE_SHIPMENT_STATUSES.includes(status);
}

export function computeBatchStatus(lineStatuses: string[]): string {
  if (lineStatuses.length === 0) return "DRAFT";
  if (lineStatuses.every(s => s === "DRAFT")) return "DRAFT";
  if (lineStatuses.every(s => s === "SHIPPED")) return "SHIPPED";

  const hasListed = lineStatuses.some(s => s === "LISTED");
  const hasInWarehouse = lineStatuses.some(s => s === "IN_WAREHOUSE");
  const hasReceived = lineStatuses.some(s => s === "RECEIVED");
  const hasShipped = lineStatuses.some(s => s === "SHIPPED");
  const hasRejected = lineStatuses.some(s => s === "REJECTED");
  const hasReturning = lineStatuses.some(s => s === "RETURNING");
  const allTerminal = lineStatuses.every(s => TERMINAL_LINE_STATUSES.includes(s));

  if (hasReturning) return "RETURNING";
  if (allTerminal) {
    if (lineStatuses.every(s => s === "LISTED" || s === "SOLD")) return "LISTED";
    return "COMPLETED";
  }
  if (hasListed) return "PARTIALLY_LISTED";
  if (hasInWarehouse) return "PARTIALLY_IN_WAREHOUSE";
  if (hasReceived) return "PARTIALLY_RECEIVED";
  if (hasRejected) return "PARTIALLY_REJECTED";
  return "SHIPPED";
}
