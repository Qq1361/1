import { ZodError, z } from "zod";
import { ServiceError } from "@/server/errors";

const moneyPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const optionalText = z.string().max(1_000).nullable().optional();
const strictDateTime = z.string().datetime({ offset: true });

export const marketItemCreateSchema = z.object({
  displayName: z.string().min(1).max(300),
  skuText: optionalText,
  versionText: optionalText,
  conditionText: optionalText,
  packageVariant: optionalText,
  accessoryVariant: optionalText,
  defaultTargetProfitAmount: z.string().regex(moneyPattern).nullable().optional(),
  note: optionalText,
}).strict();

export const marketItemUpdateSchema = z.object({
  displayName: z.string().min(1).max(300).optional(),
  skuText: optionalText,
  versionText: optionalText,
  conditionText: optionalText,
  packageVariant: optionalText,
  accessoryVariant: optionalText,
  defaultTargetProfitAmount: z.string().regex(moneyPattern).nullable().optional(),
  note: optionalText,
}).strict().refine((input) => Object.keys(input).length > 0, "至少提供一个可编辑字段。");

const platformSchema = z.enum(["DEWU", "NINETY_FIVE", "XIANYU", "OTHER"]);
const quoteTypeSchema = z.enum(["EXPECTED_INCOME", "LISTING_PRICE", "MANUAL_REFERENCE"]);
const lifecycleSchema = z.enum(["UNCONFIRMED", "CURRENT", "EXPIRED", "INVALIDATED", "SUPERSEDED"]);
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

export const marketQuoteCreateSchema = z.object({
  platform: platformSchema,
  quoteType: quoteTypeSchema,
  amount: z.string().regex(moneyPattern),
  recordedAt: strictDateTime,
  expiresAt: strictDateTime.nullable().optional(),
  sourceReference: optionalText,
  note: optionalText,
  confirmImmediately: z.boolean().optional(),
}).strict();

export const marketQuoteReplaceSchema = marketQuoteCreateSchema.extend({
  invalidationReason: z.string().min(1).max(1_000),
}).strict();

export const marketQuoteInvalidateSchema = z.object({
  reason: z.string().min(1).max(1_000),
}).strict();

export const marketPurchaseDecisionSchema = z.object({
  proposedPurchasePrice: z.string().regex(moneyPattern),
  targetProfitAmount: z.string().regex(moneyPattern),
  additionalCostAmount: z.string().regex(moneyPattern),
  platform: platformSchema.optional(),
}).strict();

const paginationQuery = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
};

export const marketItemsListQuerySchema = z.object({
  keyword: z.string().max(300).optional(),
  platform: platformSchema.optional(),
  quoteType: quoteTypeSchema.optional(),
  active: booleanQuery.optional(),
  lifecycleStatus: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  hasCurrentQuote: booleanQuery.optional(),
  ...paginationQuery,
}).strict().transform((input) => ({
  ...input,
  active: input.lifecycleStatus === undefined ? input.active : input.lifecycleStatus === "ACTIVE",
}));

export const marketQuoteHistoryQuerySchema = z.object({
  platform: platformSchema.optional(),
  quoteType: quoteTypeSchema.optional(),
  lifecycleStatus: lifecycleSchema.optional(),
  dateFrom: strictDateTime.optional(),
  dateTo: strictDateTime.optional(),
  ...paginationQuery,
}).strict().superRefine((input, ctx) => {
  if (input.dateFrom && input.dateTo && new Date(input.dateFrom) > new Date(input.dateTo)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTo"], message: "结束时间不能早于开始时间。" });
  }
});

export async function parseMarketJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ServiceError("INVALID_REQUEST", "请求 JSON 无效。", 400);
  }
}

function zodFieldErrors(error: ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  return fieldErrors;
}

export function toMarketErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    const unknownField = error.issues.some((issue) => issue.code === z.ZodIssueCode.unrecognized_keys);
    return Response.json({ error: { code: unknownField ? "UNKNOWN_FIELD" : "VALIDATION_ERROR", message: "请求参数无效。", fieldErrors: zodFieldErrors(error) } }, { status: 400 });
  }
  if (error instanceof ServiceError) {
    return Response.json({ error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors ?? {} } }, { status: error.status === 422 ? 400 : error.status });
  }
  if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2010" || error.code === "P2034")) {
    return Response.json({ error: { code: "MARKET_QUOTE_CORRECTION_CONFLICT", message: "报价已被其他请求修正，请刷新后查看最新记录。", fieldErrors: {} } }, { status: 409 });
  }
  console.error("Market API error", error);
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "服务器处理请求时发生错误。", fieldErrors: {} } }, { status: 500 });
}

export function queryObject(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams);
}
