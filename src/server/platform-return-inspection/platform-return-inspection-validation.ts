import { z } from "zod";
import { PLATFORM_RETURN_INSPECTION_RESULTS } from "./platform-return-inspection-rules";

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional();
const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, "标识格式无效。");
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(20);

export const platformReturnPlatforms = ["DEWU", "NINETY_FIVE", "OTHER"] as const;
export const platformReturnInventoryStatuses = [
  "PENDING_INSPECTION", "STOCKED", "PLATFORM_SHIPPED", "PLATFORM_RECEIVED",
  "PLATFORM_IN_WAREHOUSE", "PLATFORM_LISTED", "PLATFORM_REJECTED", "RETURNING",
  "RETURNED", "SOLD", "PROBLEM",
] as const;
export const platformReturnPendingCategories = [
  "RETURNING",
  "PENDING_INSPECTION",
  "PENDING_DECISION",
] as const;

export const platformReturnShipmentLineIdSchema = id;

export const inspectPlatformReturnSchema = z.object({
  result: z.enum(PLATFORM_RETURN_INSPECTION_RESULTS),
  storageLocation: optionalText(200),
  problemReason: optionalText(1000),
  note: optionalText(2000),
  inspectedAt: z.string().datetime({ offset: true, message: "验货时间必须是 ISO 时间。" }).optional(),
}).strict();

export const legacyConfirmRestockedSchema = z.object({
  storageLocation: text(200).min(1, "重新入库必须填写库位。"),
  note: optionalText(2000),
}).strict();

export const listPlatformReturnsQuerySchema = z.object({
  platform: z.enum(platformReturnPlatforms).optional(),
  shipmentBatchId: id.optional(),
  shipmentLineId: id.optional(),
  inventoryItemId: id.optional(),
  inventoryStatus: z.enum(platformReturnInventoryStatuses).optional(),
  inspectionResult: z.enum(PLATFORM_RETURN_INSPECTION_RESULTS).optional(),
  pendingOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  keyword: optionalText(200),
  page,
  pageSize,
}).strict();

export const listPendingPlatformReturnsQuerySchema = z.object({
  category: z.enum(platformReturnPendingCategories).optional(),
  platform: z.enum(platformReturnPlatforms).optional(),
  batchId: id.optional(),
  keyword: optionalText(200),
  page,
  pageSize,
}).strict();
