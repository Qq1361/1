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
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemDto[];
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
