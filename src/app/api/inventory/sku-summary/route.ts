import { z } from "zod";
import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inventoryService } from "@/server/services/inventory-service";

const skuSummarySchema = z.object({
  query: z.string().trim().max(100).optional(),
  filter: z
    .enum(["ALL", "LOCAL_AVAILABLE", "PLATFORM", "SOLD", "UNAVAILABLE"])
    .default("ALL"),
});

export async function GET(request: Request) {
  try {
    const query = skuSummarySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(await inventoryService.skuSummary(DEFAULT_OWNER_ID, query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
