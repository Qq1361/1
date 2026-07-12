/** Unified status labels for all UI display. Never expose raw enum values to users. */

// InventoryItem.itemStatus → Chinese
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
    REMOVED: "已移出",
    PENDING_INSPECTION: "待验货",
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
