import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inventoryService } from "@/server/services/inventory-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    return Response.json(
      await inventoryService.get(DEFAULT_OWNER_ID, (await context.params).id),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
