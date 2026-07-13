export type OrderItemDto = {
  id: string;
  name: string;
  skuText: string | null;
  quantity: number;
  allocatedTotalCost: string | null;
  notes: string | null;
  inventoryItems?: PurchaseInventoryItemDto[];
};

export type PurchaseInventoryItemDto = {
  id: string;
  inventoryCode: string;
  name: string;
  skuText: string | null;
  unitCost: string;
  itemStatus: string;
  saleMode: string;
  storageLocation: string | null;
  saleLines?: PurchaseSaleLineDto[];
};

export type PurchaseSaleLineDto = {
  id: string;
  unitCostSnapshot: string;
  saleAmount: string;
  costAmount: string;
  profitAmount: string;
  saleOrder: {
    id: string;
    saleNo: string;
    platform: string;
    platformOrderNo: string | null;
    platformTradeNo: string | null;
    soldAt: string;
    grossAmount: string;
    expectedIncome: string | null;
    actualReceivedAmount: string | null;
    shippingCost: string;
    otherCost: string;
    status: string;
    cancelledAt: string | null;
    feeLines: { amount: string }[];
  };
};

export type OrderDto = {
  id: string;
  orderNo: string;
  platform: "XIANYU";
  status: string;
  allocationStatus: "UNALLOCATED" | "DRAFT" | "CONFIRMED";
  allocationConfirmedAt: string | null;
  paidAt: string;
  totalAmount: string;
  shippingAmount: string;
  carrierCode: string | null;
  trackingNo: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  logisticsStatus:
    | "NOT_SHIPPED"
    | "IN_TRANSIT"
    | "OUT_FOR_DELIVERY"
    | "DELIVERED"
    | "EXCEPTION"
    | "STALLED"
    | "RETURNING"
    | "UNKNOWN";
  logisticsLastCheckedAt: string | null;
  logisticsLastEventAt: string | null;
  logisticsLastEventText: string | null;
  logisticsExceptionType: string | null;
  logisticsExceptionMessage: string | null;
  notes: string | null;
  sellerNickname: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemDto[];
  logisticsEvents: LogisticsEventDto[];
};

export type LogisticsEventDto = {
  id: string;
  carrierCode: string;
  trackingNo: string;
  eventTime: string;
  eventText: string;
  location: string | null;
  status: OrderDto["logisticsStatus"];
};

export type AttachmentDto = {
  id: string;
  entityType: "PURCHASE_ORDER" | "PURCHASE_ORDER_ITEM" | "INSPECTION";
  entityId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type ApiError = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};
