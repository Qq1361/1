import { z } from "zod";

const referenceAmount = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "商品参考成交总额格式无效");

export const purchaseItemMutationSchema = z
  .object({
    name: z.string().trim().min(1, "商品名称不能为空").max(120),
    skuText: z.string().trim().max(200).optional().or(z.literal("")),
    quantity: z.coerce.number().int().min(1).max(999),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
    referenceAmount: referenceAmount.optional().or(z.literal("")),
  })
  .strict();

export const purchaseItemBatchRowSchema = purchaseItemMutationSchema
  .omit({ quantity: true })
  .extend({
    skuText: z.string().trim().max(200).nullable().optional().or(z.literal("")),
    notes: z.string().trim().max(1000).nullable().optional().or(z.literal("")),
    referenceAmount: referenceAmount.nullable().optional().or(z.literal("")),
  })
  .strict();

export const purchaseItemBatchSchema = z
  .object({
    items: z.array(purchaseItemBatchRowSchema).min(1).max(50),
  })
  .strict();

const money = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "请输入有效金额，最多两位小数");

export const orderItemSchema = z.object({
  id: z.string().cuid().optional(),
  clientId: z.string().min(1).optional(),
  name: z.string().trim().min(1, "商品名称不能为空").max(120),
  skuText: z.string().trim().max(200).optional().or(z.literal("")),
  quantity: z.coerce.number().int().min(1).max(999),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  referenceAmount: referenceAmount.optional().or(z.literal("")),
});

export const purchaseOrderSchema = z.object({
  orderNo: z.string().trim().min(1, "订单号不能为空").max(100),
  sellerNickname: z.string().trim().max(100).optional().or(z.literal("")),
  paidAt: z.coerce.date(),
  totalAmount: money,
  shippingAmount: money.default("0"),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  items: z.array(orderItemSchema).min(1, "至少添加一件商品").max(100),
}).strict();

export const orderListQuerySchema = z.object({
  query: z.string().trim().max(100).optional(),
  status: z
    .enum([
      "PAID",
      "WAITING_SHIPMENT",
      "IN_TRANSIT",
      "PENDING_INSPECTION",
      "PARTIALLY_STOCKED",
      "STOCKED",
      "CANCELLED",
    ])
    .optional(),
  allocationStatus: z
    .enum(["UNALLOCATED", "DRAFT", "CONFIRMED"])
    .optional(),
  todo: z
    .enum(["missingTracking", "logisticsIssues"])
    .optional(),
  tracking: z
    .enum(["missing"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const allocationSchema = z.object({
  action: z.enum(["save", "confirm", "reopen"]),
  allocations: z
    .array(
      z.object({
        itemId: z.string().cuid(),
        allocatedTotalCost: money.nullable(),
      }),
    )
    .default([]),
});

export const trackingSchema = z.object({
  carrierCode: z.string().trim().min(1, "请选择或填写快递公司").max(50),
  trackingNo: z.string().trim().min(1, "快递单号不能为空").max(100),
  shippedAt: z.coerce.date().optional(),
});

export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type PurchaseItemMutationInput = z.infer<typeof purchaseItemMutationSchema>;
export type PurchaseItemBatchInput = z.infer<typeof purchaseItemBatchSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
