import { z, ZodError } from "zod";
import { ServiceError } from "@/server/errors";

const businessTypeSchema = z.enum([
  "PURCHASE_INBOUND",
  "PLATFORM_OUTBOUND",
  "PLATFORM_RETURN",
  "PURCHASE_AFTER_SALE_RETURN",
  "SALE_AFTER_SALE_RETURN",
]);
const carrierCodeSchema = z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform((value) => value.toUpperCase());
const trackingNumberSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9\-/]+$/);

export const logisticsShipmentQuerySchema = z.object({
  businessType: businessTypeSchema,
  businessId: z.string().trim().min(1).max(191),
}).strict();

export const logisticsShipmentCreateSchema = z.object({
  businessType: businessTypeSchema,
  businessId: z.string().trim().min(1).max(191),
  provider: z.literal("KDNIAO"),
  carrierCode: carrierCodeSchema,
  carrierName: z.string().trim().min(1).max(100).nullable().optional(),
  trackingNumber: trackingNumberSchema,
}).strict();

export const logisticsSyncSchema = z.object({}).strict();

export function assertPurchaseInboundBusinessType(value: string) {
  if (value !== "PURCHASE_INBOUND") {
    throw new ServiceError(
      "LOGISTICS_BUSINESS_TYPE_NOT_ENABLED",
      "当前仅开放采购入库物流真实查询。",
      400,
    );
  }
}

export async function parseOptionalLogisticsJson(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ServiceError("INVALID_REQUEST", "请求 JSON 无效。", 400);
  }
}

function fieldErrors(error: ZodError) {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}

export function toLogisticsErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    const unknownField = error.issues.some((issue) => issue.code === z.ZodIssueCode.unrecognized_keys);
    return Response.json(
      { error: { code: unknownField ? "UNKNOWN_FIELD" : "VALIDATION_ERROR", message: "请求参数无效。", fieldErrors: fieldErrors(error) } },
      { status: 400 },
    );
  }
  if (error instanceof ServiceError) {
    return Response.json(
      { error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors ?? {} } },
      { status: error.status },
    );
  }
  console.error("Logistics API error", error);
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "服务器处理请求时发生错误。", fieldErrors: {} } },
    { status: 500 },
  );
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export function logisticsShipmentDto(result: {
  shipment: {
    id: string;
    businessType: string;
    businessId: string;
    provider: string;
    carrierCode: string;
    carrierName: string | null;
    trackingNumber: string;
    currentStatus: string;
    rawStatusCode: string | null;
    lastEventAt: Date | null;
    lastSyncedAt: Date | null;
    nextSyncAt: Date | null;
    syncStatus: string;
    failureCount: number;
    lastErrorCode: string | null;
    deliveredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  events: Array<{
    id: string;
    eventTime: Date;
    status: string;
    location: string | null;
    description: string;
    rawStatusCode: string | null;
    createdAt: Date;
  }>;
}) {
  return {
    shipment: result.shipment ? {
      id: result.shipment.id,
      businessType: result.shipment.businessType,
      businessId: result.shipment.businessId,
      provider: result.shipment.provider,
      carrierCode: result.shipment.carrierCode,
      carrierName: result.shipment.carrierName,
      trackingNumber: result.shipment.trackingNumber,
      currentStatus: result.shipment.currentStatus,
      rawStatusCode: result.shipment.rawStatusCode,
      lastEventAt: iso(result.shipment.lastEventAt),
      lastSyncedAt: iso(result.shipment.lastSyncedAt),
      nextSyncAt: iso(result.shipment.nextSyncAt),
      deliveredAt: iso(result.shipment.deliveredAt),
      syncStatus: result.shipment.syncStatus,
      failureCount: result.shipment.failureCount,
      lastErrorCode: result.shipment.lastErrorCode,
      createdAt: result.shipment.createdAt.toISOString(),
      updatedAt: result.shipment.updatedAt.toISOString(),
    } : null,
    events: result.events.map((event) => ({
      id: event.id,
      eventTime: event.eventTime.toISOString(),
      status: event.status,
      location: event.location,
      description: event.description,
      rawStatusCode: event.rawStatusCode,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
