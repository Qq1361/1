import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inventoryService } from "@/server/services/inventory-service";
import { inventoryListSchema } from "@/server/validation/inspection";
import { ServiceError } from "@/server/errors";
import { isSupportedInventoryItemStatus } from "@/lib/inventory-item-status-contract";

export async function GET(request: Request) {
  try {
    const rawQuery = Object.fromEntries(new URL(request.url).searchParams);
    if (rawQuery.itemStatus && !isSupportedInventoryItemStatus(rawQuery.itemStatus)) {
      throw new ServiceError("INVALID_INVENTORY_STATUS_FILTER", "库存状态筛选参数无效。", 400);
    }
    const query = inventoryListSchema.parse(
      rawQuery,
    );
    return Response.json(await inventoryService.list(DEFAULT_OWNER_ID, query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
