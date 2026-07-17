/** Unified status labels for all UI display. Never expose raw enum values to users. */

// InventoryItem.itemStatus → Chinese
const legacyInventoryItemStatusLabels: Record<string, string> = {
  LISTED: "旧状态：已上架（待迁移）",
  IN_BATCH: "旧状态：批次中（待迁移）",
  SHIPPED_TO_WAREHOUSE: "旧状态：已发仓（待迁移）",
  WAREHOUSE_RECEIVED: "旧状态：仓库已收（待迁移）",
  INBOUND_SUCCESS: "旧状态：入仓成功（待迁移）",
  INBOUND_FAILED: "旧状态：入仓失败（待迁移）",
  PENDING_SETTLEMENT: "旧状态：待结算（待迁移）",
  SETTLED: "旧状态：已结算（待迁移）",
};

/** Historical display only. Do not use this map for status selectors. */
export function formatLegacyInventoryItemStatus(status: string): string {
  return legacyInventoryItemStatusLabels[status] || status;
}

export function formatItemStatus(status: string): string {
  const map: Record<string, string> = {
    STOCKED: "已入库",
    PLATFORM_SHIPPED: "已发往平台",
    PLATFORM_RECEIVED: "平台已签收",
    PLATFORM_IN_WAREHOUSE: "入仓成功 / 鉴别通过",
    PLATFORM_LISTED: "平台已上架 / 可售",
    PLATFORM_REJECTED: "平台拒收",
    RETURNING: "退回中",
    RETURNED: "已退回，待重新入库",
    SOLD: "已售出",
    PROBLEM: "问题件",
    PENDING_INSPECTION: "待验货",
  };
  return map[status] || formatLegacyInventoryItemStatus(status);
}

export function formatInventoryOwnershipStatus(status: string): string {
  const map: Record<string, string> = {
    OWNED: "自有库存",
    RETURNING_TO_UPSTREAM_SELLER: "正在退回上游卖家",
    RETURNED_TO_UPSTREAM_SELLER: "已退回上游卖家",
  };
  return map[status] || status;
}

// InventoryItem.saleMode → Chinese
export function formatSaleMode(mode: string): string {
  const map: Record<string, string> = {
    NONE: "未选择",
    DEWU_LIGHTNING: "得物闪电",
    DEWU_STANDARD: "得物普通",
    NINETY_FIVE: "95分",
    XIANYU: "闲鱼",
    OTHER: "其他",
  };
  return map[mode] || mode;
}

// PlatformShipmentLine.lineStatus → Chinese
export function formatLineStatus(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "草稿",
    SHIPPED: "已发货",
    RECEIVED: "平台已签收",
    IN_WAREHOUSE: "入仓成功 / 鉴别通过",
    LISTED: "平台已上架 / 可售",
    REJECTED: "平台拒收",
    RETURNING: "退回中",
    RETURNED: "已退回",
    CANCELLED: "已取消",
    SOLD: "已售出",
  };
  return map[status] || status;
}

// PlatformReturnInspection.result is an inspection conclusion. It must remain
// visually distinct from InventoryItem.itemStatus (for example, STOCKED).
export function formatPlatformReturnInspectionResult(result: string | null | undefined): string {
  const map: Record<string, string> = {
    RESTOCKED: "可重新入库",
    PROBLEM: "问题件",
    PENDING_DECISION: "待进一步判断",
  };
  return result ? (map[result] ?? result) : "尚未登记验货";
}

/** Platform-return workbench wording for the inventory fact at the end of a return cycle. */
export function formatPlatformReturnInventoryStatus(status: string): string {
  const map: Record<string, string> = {
    RETURNING: "平台退回途中",
    RETURNED: "已退回待验货",
    STOCKED: "在库",
    PROBLEM: "问题件",
    PLATFORM_REJECTED: "平台拒收",
    PLATFORM_SHIPPED: "已寄往平台",
    PLATFORM_RECEIVED: "平台已收货",
    PLATFORM_IN_WAREHOUSE: "平台仓内",
    PLATFORM_LISTED: "平台已上架 / 可售",
  };
  return map[status] ?? formatItemStatus(status);
}

export function formatPlatformReturnAction(action: string): string {
  const map: Record<string, string> = {
    INSPECTION_RECORDED: "登记退回验货",
    INSPECTION_REVISED: "修改退回验货结论",
  };
  return map[action] ?? action;
}

// PlatformShipmentBatch.status → Chinese
export function formatBatchStatus(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "草稿",
    SHIPPED: "已发货",
    PARTIALLY_RECEIVED: "部分签收",
    RECEIVED: "已签收",
    PARTIALLY_IN_WAREHOUSE: "部分入仓",
    IN_WAREHOUSE: "入仓成功",
    PARTIALLY_LISTED: "部分上架",
    LISTED: "已上架",
    PARTIALLY_REJECTED: "部分拒收",
    RETURNING: "退回中",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
  };
  return map[status] || status;
}

// ShipmentPurpose → Chinese
export function formatPurpose(purpose: string): string {
  const map: Record<string, string> = {
    DEWU_LIGHTNING_INBOUND: "得物闪电入仓",
    DEWU_STANDARD_FULFILLMENT: "得物普通寄送",
    NINETY_FIVE_INBOUND: "95分寄送",
    OTHER: "其他",
  };
  return map[purpose] || purpose;
}

// ShipmentPlatform → Chinese
export function formatPlatform(platform: string): string {
  const map: Record<string, string> = {
    DEWU: "得物",
    NINETY_FIVE: "95分",
    XIANYU: "闲鱼",
    OTHER: "其他",
  };
  return map[platform] || platform;
}

// SaleOrderStatus → Chinese
export function formatSaleStatus(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "草稿",
    CONFIRMED: "已确认销售",
    SETTLED: "已到账",
    CANCELLED: "已取消",
  };
  return map[status] || status;
}

// SaleFeeType → Chinese
export function formatFeeType(feeType: string): string {
  const map: Record<string, string> = {
    PLATFORM_COMMISSION: "平台佣金",
    AUTHENTICATION: "鉴定费",
    SHIPPING: "运费",
    PACKAGING: "包材费",
    OTHER: "其他",
  };
  return map[feeType] || feeType;
}
