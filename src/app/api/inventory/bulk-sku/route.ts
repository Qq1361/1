import { z } from "zod";
import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inventoryService } from "@/server/services/inventory-service";
import { ServiceError } from "@/server/errors";

const bulkSkuBaseSchema = z.object({
  inventoryItemIds: z.array(z.string().cuid()).min(1).max(500),
  skuText: z.string().max(200).nullable().optional(),
  overwriteExisting: z.boolean().default(false),
  allowMixedProducts: z.boolean().default(false),
  includeHistorical: z.boolean().default(false),
}).strict();

function withUniqueInventoryIds<T extends { inventoryItemIds: string[] }>(schema: z.ZodType<T>) {
  return schema.superRefine((value, context) => {
  if (new Set(value.inventoryItemIds).size !== value.inventoryItemIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryItemIds"], message: "库存选择中不能包含重复项。" });
  }
  });
}

const bulkSkuSchema = withUniqueInventoryIds(bulkSkuBaseSchema);

const bulkSkuConfirmSchema = withUniqueInventoryIds(bulkSkuBaseSchema.extend({
  selectionFingerprint: z.string().min(32).max(128),
}).strict());

export async function POST(request: Request) {
  try {
    const rawInput: unknown = await request.json();
    if (containsOwnershipStatus(rawInput)) {
      throw new ServiceError("INVENTORY_OWNERSHIP_UPDATE_FORBIDDEN", "批量 SKU 编辑接口不能修改资产归属。", 400);
    }
    return Response.json(
      await inventoryService.previewBulkSku(DEFAULT_OWNER_ID, bulkSkuSchema.parse(rawInput)),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const rawInput: unknown = await request.json();
    if (containsOwnershipStatus(rawInput)) {
      throw new ServiceError("INVENTORY_OWNERSHIP_UPDATE_FORBIDDEN", "批量 SKU 编辑接口不能修改资产归属。", 400);
    }
    return Response.json(
      await inventoryService.bulkUpdateSku(DEFAULT_OWNER_ID, bulkSkuConfirmSchema.parse(rawInput)),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

function containsOwnershipStatus(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    key === "ownershipStatus" || containsOwnershipStatus(child),
  );
}
