import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { logisticsService } from "@/server/services/logistics-service";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(
      await logisticsService.manualDeliver(DEFAULT_OWNER_ID, id),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
