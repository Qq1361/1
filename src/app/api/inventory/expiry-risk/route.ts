import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inventoryService } from "@/server/services/inventory-service";

export async function GET() {
  try {
    return Response.json(await inventoryService.expiryRiskSummary(DEFAULT_OWNER_ID));
  } catch (error) {
    return toErrorResponse(error);
  }
}
