import { z } from "zod";

const referenceAmount = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "商品参考成交总额格式无效");

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须是 YYYY-MM-DD 格式。");
const shelfLifeMonths = z
  .number()
  .int("保质期月数必须是整数。")
  .min(1, "保质期月数必须在 1 到 600 之间。")
  .max(600, "保质期月数必须在 1 到 600 之间。");

export const purchaseItemMutationSchema = z
  .object({
    name: z.string().trim().min(1, "商品名称不能为空").max(120),
    skuText: z.string().trim().max(200).optional().or(z.literal("")),
    quantity: z.coerce.number().int().min(1).max(999),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
    referenceAmount: referenceAmount.optional().or(z.literal("")),
    productionDate: dateOnly.nullable().optional(),
    shelfLifeMonths: shelfLifeMonths.nullable().optional(),
    expiryDate: dateOnly.nullable().optional(),
  })
  .strict();

export const purchaseItemBatchRowSchema = purchaseItemMutationSchema
  .omit({ quantity: true })
  .extend({
    skuText: z.string().trim().max(200).nullable().optional().or(z.literal("")),
    notes: z.string().trim().max(1000).nullable().optional().or(z.literal("")),
    referenceAmount: referenceAmount.nullable().optional().or(z.literal("")),
    productionDate: dateOnly.nullable().optional(),
    shelfLifeMonths: shelfLifeMonths.nullable().optional(),
    expiryDate: dateOnly.nullable().optional(),
  })
  .strict();

export const purchaseItemBatchSchema = z
  .object({
    items: z.array(purchaseItemBatchRowSchema).min(1).max(50),
  })
  .strict();

export const purchaseItemEntryErrorRemovalSchema = z
  .object({
    reason: z.enum([
      "DUPLICATE_ENTRY",
      "ACTUALLY_NOT_RECEIVED",
      "WRONG_PRODUCT_ENTERED",
      "OTHER",
    ]),
    note: z.string().trim().max(500, "说明不能超过 500 个字符。").optional().or(z.literal("")),
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
  productionDate: dateOnly.nullable().optional(),
  shelfLifeMonths: shelfLifeMonths.nullable().optional(),
  expiryDate: dateOnly.nullable().optional(),
});

const legacyPurchaseOrderSchema = z.object({
  orderNo: z.string().trim().min(1, "订单号不能为空").max(100),
  sellerNickname: z.string().trim().max(100).optional().or(z.literal("")),
  paidAt: z.coerce.date(),
  totalAmount: money,
  shippingAmount: money.default("0"),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  items: z.array(orderItemSchema).min(1, "至少添加一件商品").max(100),
}).strict();

const purchaseOrderBaseSchema = legacyPurchaseOrderSchema.omit({ items: true });

const singlePurchaseOrderSchema = purchaseOrderBaseSchema.extend({
  entryMode: z.literal("SINGLE").optional(),
  items: z.array(orderItemSchema).min(1, "At least one purchase item is required").max(100),
  batchItems: z.undefined().optional(),
}).strict();

const batchPurchaseOrderSchema = purchaseOrderBaseSchema.extend({
  entryMode: z.literal("BATCH"),
  items: z.undefined().optional(),
  batchItems: z.array(purchaseItemBatchRowSchema).min(1).max(50),
}).strict();

export const purchaseOrderSchema = z
  .union([singlePurchaseOrderSchema, batchPurchaseOrderSchema])
  .transform((input) => ({
    orderNo: input.orderNo,
    sellerNickname: input.sellerNickname,
    paidAt: input.paidAt,
    totalAmount: input.totalAmount,
    shippingAmount: input.shippingAmount,
    notes: input.notes,
    entryMode: input.entryMode ?? "SINGLE",
    items:
      input.entryMode === "BATCH"
        ? input.batchItems.map((item) => ({ id: undefined, ...item, quantity: 1 }))
        : input.items,
  }));

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
    .enum(["missingTracking", "trackingNotReceivedOverdue", "logisticsIssues"])
    .optional(),
  tracking: z
    .enum(["missing"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const allocationSchema = z.object({
  action: z.enum(["save", "confirm", "reopen"]),
  expectedAllocationVersion: z.string().max(10000).optional(),
  allocations: z
    .array(
      z.object({
        itemId: z.string().cuid(),
        allocatedTotalCost: money.nullable(),
      }),
    )
    .default([]),
});

export const discardAllocationDraftSchema = z
  .object({
    expectedAllocationVersion: z.string().trim().min(1).max(10000),
  })
  .strict();

export const trackingSchema = z.object({
  carrierCode: z.string().trim().min(1, "请选择或填写快递公司").max(50),
  trackingNo: z.string().trim().min(1, "快递单号不能为空").max(100),
  shippedAt: z.coerce.date().optional(),
});

export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type PurchaseItemMutationInput = z.infer<typeof purchaseItemMutationSchema>;
export type PurchaseItemBatchInput = z.infer<typeof purchaseItemBatchSchema>;
export type PurchaseItemEntryErrorRemovalInput = z.infer<typeof purchaseItemEntryErrorRemovalSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
