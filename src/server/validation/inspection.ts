import { z } from "zod";
import { SUPPORTED_INVENTORY_ITEM_STATUSES } from "@/lib/inventory-item-status-contract";

export const inspectionPatchSchema = z.object({
  currentStep: z.number().int().min(1).max(6).optional(),
  hasBox: z.boolean().nullable().optional(),
  capCondition: z.string().trim().max(200).nullable().optional(),
  paintCondition: z.string().trim().max(200).nullable().optional(),
  leakageCondition: z.string().trim().max(200).nullable().optional(),
  isNew: z.boolean().nullable().optional(),
  hasUsageTrace: z.boolean().nullable().optional(),
  batchCode: z.string().trim().max(100).nullable().optional(),
  skuText: z.string().max(200).nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  storageLocation: z.string().trim().max(100).nullable().optional(),
  appearanceNotes: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const inspectionCompleteSchema = inspectionPatchSchema.extend({
  result: z.enum(["PASS", "PROBLEM"]),
});

export const inspectionBatchPassSchema = z
  .object({
    inspectionIds: z.array(z.string().cuid()),
  })
  .strict();

export const inspectionListSchema = z.object({
  query: z
    .string()
    .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), "搜索内容不能包含控制字符")
    .transform((value) => value.trim())
    .pipe(z.string().max(100))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const inventoryListSchema = z.object({
  query: z.string().trim().max(100).optional(),
  itemStatus: z
    .enum(SUPPORTED_INVENTORY_ITEM_STATUSES)
    .optional(),
  saleMode: z
    .enum([
      "NONE",
      "DEWU_LIGHTNING",
      "DEWU_STANDARD",
      "NINETY_FIVE",
      "XIANYU",
      "OTHER",
    ])
    .optional(),
  locationStatus: z
    .enum(["LOCAL", "DEWU_WAREHOUSE", "RETURNING", "SOLD"])
    .optional(),
  reminder: z
    .enum([
      "EXPIRY_UNDER_395",
      "EXPIRY_UNDER_365",
      "DISTANCE_TO_395_WITHIN_7_DAYS",
      "DISTANCE_TO_365_WITHIN_10_DAYS",
      "NINETY_FIVE_EXPIRY_UNDER_90",
      "NINETY_FIVE_EXPIRY_UNDER_60",
      "STOCKED_OVER_3_DAYS",
    ])
    .optional(),
  productNameExact: z.string().trim().min(1).max(200).optional(),
  skuExact: z.string().max(200).optional(),
  skuEmpty: z.enum(["true"]).transform(() => true).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
