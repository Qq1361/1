import { z } from "zod";

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const ISO_DATE_TIME = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => z.union([text(max), z.null(), z.undefined()]).transform((value) => value?.trim() || null);
const money = z.string().trim().regex(MONEY_PATTERN, "金额格式无效");
const positiveMoney = money.refine((value) => value !== "0" && value !== "0.0" && value !== "0.00", "金额必须大于 0");

export const saleAfterSaleTypes = ["REFUND_ONLY", "RETURN_AND_REFUND"] as const;
export const saleAfterSaleStatuses = [
  "DRAFT", "REQUESTED", "APPROVED", "REJECTED", "RETURN_PENDING", "RETURNING",
  "RETURN_RECEIVED", "INSPECTED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED",
  "COMPLETED", "CANCELLED",
] as const;
export const saleAfterSaleInspectionResults = ["RESTOCKED", "PROBLEM", "PENDING_DECISION"] as const;

const lineSchema = z.object({
  saleLineId: text(128).min(1),
  inventoryItemId: text(128).min(1),
  requestedRefundAmount: positiveMoney,
  note: optionalText(1000),
}).strict();

const baseSchema = z.object({
  type: z.enum(saleAfterSaleTypes),
  reason: optionalText(1000),
  note: optionalText(2000),
});

function uniqueLines(lines: Array<{ saleLineId: string; inventoryItemId: string }>, ctx: z.RefinementCtx) {
  const saleLineIds = new Set<string>();
  const inventoryItemIds = new Set<string>();
  lines.forEach((line, index) => {
    if (saleLineIds.has(line.saleLineId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines", index, "saleLineId"], message: "同一销售明细不能重复。" });
    if (inventoryItemIds.has(line.inventoryItemId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines", index, "inventoryItemId"], message: "同一库存不能重复。" });
    saleLineIds.add(line.saleLineId);
    inventoryItemIds.add(line.inventoryItemId);
  });
}

export const createSaleAfterSaleSchema = baseSchema.extend({
  saleOrderId: text(128).min(1),
  lines: z.array(lineSchema).min(1).max(100),
}).strict().superRefine((value, ctx) => uniqueLines(value.lines, ctx));

export const updateSaleAfterSaleSchema = baseSchema.partial().extend({
  lines: z.array(lineSchema).min(1).max(100).optional(),
}).strict().superRefine((value, ctx) => { if (value.lines) uniqueLines(value.lines, ctx); });

export const listSaleAfterSalesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(saleAfterSaleStatuses).optional(),
  type: z.enum(saleAfterSaleTypes).optional(),
  saleOrderId: text(128).min(1).optional(),
  keyword: text(200).optional(),
}).strict();

export const eligibleLinesQuerySchema = z.object({
  saleOrderId: text(128).min(1),
  keyword: text(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const approvalLineSchema = z.object({ afterSaleLineId: text(128).min(1), approvedRefundAmount: positiveMoney }).strict();
export const approveSaleAfterSaleSchema = z.object({ lines: z.array(approvalLineSchema).min(1).max(100), note: optionalText(2000) }).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.lines.forEach((line, index) => {
    if (ids.has(line.afterSaleLineId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines", index, "afterSaleLineId"], message: "售后明细不能重复。" });
    ids.add(line.afterSaleLineId);
  });
});

export const reasonOrNoteSchema = z.object({ reason: optionalText(1000), note: optionalText(2000) }).strict().superRefine((value, ctx) => {
  if (!value.reason && !value.note) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "请填写原因或备注。" });
});

export const returnShippedSaleAfterSaleSchema = z.object({
  returnCarrierCode: text(100).min(1),
  returnTrackingNo: text(200).min(1),
  returnShippedAt: ISO_DATE_TIME.optional(),
  note: optionalText(2000),
}).strict();

export const returnReceivedSaleAfterSaleSchema = z.object({ returnReceivedAt: ISO_DATE_TIME.optional(), note: optionalText(2000) }).strict();
export const optionalSaleAfterSaleNoteSchema = z.object({ note: optionalText(2000) }).strict();

const inspectionSchema = z.object({
  afterSaleLineId: text(128).min(1),
  result: z.enum(saleAfterSaleInspectionResults),
  storageLocation: optionalText(200),
  problemReason: optionalText(1000),
  note: optionalText(2000),
}).strict().superRefine((value, ctx) => {
  if (value.result === "RESTOCKED" && !value.storageLocation) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["storageLocation"], message: "可再次销售时必须填写库位。" });
  if (value.result === "PROBLEM" && !value.problemReason && !value.note) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["problemReason"], message: "问题件必须填写原因或备注。" });
});

export const inspectSaleAfterSaleSchema = z.object({ inspections: z.array(inspectionSchema).min(1).max(100) }).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.inspections.forEach((item, index) => {
    if (ids.has(item.afterSaleLineId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspections", index, "afterSaleLineId"], message: "验货明细不能重复。" });
    ids.add(item.afterSaleLineId);
  });
});

export const refundSaleAfterSaleSchema = z.object({
  idempotencyKey: text(200).min(1),
  refundAmount: positiveMoney,
  refundedAt: ISO_DATE_TIME.optional(),
  refundMethod: optionalText(100),
  externalRefundNo: optionalText(200),
  note: optionalText(2000),
  allocations: z.array(z.object({ afterSaleLineId: text(128).min(1), amount: positiveMoney }).strict()).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.allocations.forEach((item, index) => {
    if (ids.has(item.afterSaleLineId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["allocations", index, "afterSaleLineId"], message: "退款分配明细不能重复。" });
    ids.add(item.afterSaleLineId);
  });
});
