import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inventoryService } from "@/server/services/inventory-service";
import { inventoryListSchema } from "@/server/validation/inspection";

export async function GET(request: Request) {
  try {
    const query = inventoryListSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(await inventoryService.list(DEFAULT_OWNER_ID, query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
