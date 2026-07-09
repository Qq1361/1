export type OrderItemDto = {
  id: string;
  name: string;
  skuText: string | null;
  quantity: number;
  allocatedTotalCost: string | null;
  notes: string | null;
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
  entityType: "PURCHASE_ORDER" | "PURCHASE_ORDER_ITEM";
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
