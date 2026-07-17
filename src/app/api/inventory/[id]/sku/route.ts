import { z } from "zod";
import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inventoryService } from "@/server/services/inventory-service";
import { ServiceError } from "@/server/errors";

type Context = { params: Promise<{ id: string }> };

const skuSchema = z.object({ skuText: z.string().max(200).nullable().optional() });

export async function PATCH(request: Request, context: Context) {
  try {
    const rawInput: unknown = await request.json();
    if (containsOwnershipStatus(rawInput)) {
      throw new ServiceError("INVENTORY_OWNERSHIP_UPDATE_FORBIDDEN", "SKU 编辑接口不能修改资产归属。", 400);
    }
    const input = skuSchema.parse(rawInput);
    return Response.json(
      await inventoryService.updateSkuOnly(DEFAULT_OWNER_ID, (await context.params).id, input.skuText),
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
