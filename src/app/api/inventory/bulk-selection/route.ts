import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inventoryService } from "@/server/services/inventory-service";
import { inventoryListSchema } from "@/server/validation/inspection";

export async function POST(request: Request) {
  try {
    const rawInput = await request.json();
    const query = inventoryListSchema.parse({ ...rawInput, page: 1, pageSize: 100 });
    return Response.json(await inventoryService.selectAllMatching(DEFAULT_OWNER_ID, query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
