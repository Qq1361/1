import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inventoryBulkService } from "@/server/services/inventory-bulk-service";
import { inventoryBulkOperationSchema } from "@/server/validation/inventory";

export async function POST(request: Request) {
  try {
    const input = inventoryBulkOperationSchema.parse(await request.json());
    return Response.json(await inventoryBulkService.update(DEFAULT_OWNER_ID, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
