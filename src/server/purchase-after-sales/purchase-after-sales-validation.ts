import { z } from "zod";

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const ISO_DATE_TIME = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional();
const positiveMoney = z.string().trim().regex(MONEY_PATTERN, "金额格式无效");

export const purchaseAfterSaleTypes = ["REFUND_ONLY", "RETURN_AND_REFUND"] as const;
export const purchaseAfterSaleStatuses = [
  "DRAFT", "REQUESTED", "SELLER_APPROVED", "SELLER_REJECTED", "RETURN_PENDING",
  "RETURNING_TO_SELLER", "SELLER_RECEIVED", "REFUND_PENDING", "PARTIALLY_REFUNDED",
  "REFUNDED", "COMPLETED", "CANCELLED",
] as const;

const draftLineSchema = z.object({
  purchaseOrderItemId: text(128).min(1),
  inspectionId: text(128).min(1),
  inventoryItemId: text(128).min(1),
  requestedRefundAmount: positiveMoney,
  note: optionalText(1000),
}).strict();

const draftBaseSchema = z.object({
  type: z.enum(purchaseAfterSaleTypes),
  reason: optionalText(1000),
  note: optionalText(2000),
});

export const createPurchaseAfterSaleSchema = draftBaseSchema.extend({
  purchaseOrderId: text(128).min(1),
  lines: z.array(draftLineSchema).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  const inspectionIds = new Set<string>();
  const inventoryItemIds = new Set<string>();
  value.lines.forEach((line, index) => {
    if (inspectionIds.has(line.inspectionId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines", index, "inspectionId"], message: "同一验货记录不能重复。" });
    if (inventoryItemIds.has(line.inventoryItemId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines", index, "inventoryItemId"], message: "同一库存不能重复。" });
    inspectionIds.add(line.inspectionId);
    inventoryItemIds.add(line.inventoryItemId);
  });
});

export const updatePurchaseAfterSaleSchema = draftBaseSchema.extend({
  lines: z.array(draftLineSchema).min(1).max(100).optional(),
}).strict();

export const sellerApproveSchema = z.object({
  lines: z.array(z.object({
    afterSaleLineId: text(128).min(1),
    approvedRefundAmount: positiveMoney,
  }).strict()).min(1).max(100),
  note: optionalText(2000),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.lines.forEach((line, index) => {
    if (ids.has(line.afterSaleLineId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines", index, "afterSaleLineId"], message: "售后明细不能重复。" });
    ids.add(line.afterSaleLineId);
  });
});

export const sellerRejectSchema = z.object({
  reason: optionalText(1000),
  note: optionalText(2000),
}).strict().superRefine((value, ctx) => {
  if (!value.reason && !value.note) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "请填写拒绝原因或备注。" });
});

export const returnShippedSchema = z.object({
  returnCarrierCode: text(100).min(1),
  returnTrackingNo: text(200).min(1),
  returnShippedAt: ISO_DATE_TIME.optional(),
  note: optionalText(2000),
}).strict();

export const sellerReceivedSchema = z.object({
  sellerReceivedAt: ISO_DATE_TIME.optional(),
  note: optionalText(2000),
}).strict();

export const optionalNoteSchema = z.object({ note: optionalText(2000) }).strict();

export const refundSchema = z.object({
  idempotencyKey: text(200).min(1),
  refundAmount: positiveMoney,
  refundedAt: ISO_DATE_TIME.optional(),
  refundMethod: optionalText(100),
  externalRefundNo: optionalText(200),
  note: optionalText(2000),
  allocations: z.array(z.object({
    afterSaleLineId: text(128).min(1),
    amount: positiveMoney,
  }).strict()).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.allocations.forEach((allocation, index) => {
    if (ids.has(allocation.afterSaleLineId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["allocations", index, "afterSaleLineId"], message: "退款分配明细不能重复。" });
    ids.add(allocation.afterSaleLineId);
  });
});

export const listPurchaseAfterSalesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(purchaseAfterSaleStatuses).optional(),
  type: z.enum(purchaseAfterSaleTypes).optional(),
  purchaseOrderId: text(128).min(1).optional(),
  keyword: text(200).optional(),
}).strict();

export const eligibleItemsQuerySchema = z.object({
  purchaseOrderId: text(128).min(1),
  keyword: text(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
