import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { logisticsService } from "@/server/services/logistics-service";
import { trackingSchema } from "@/server/validation/purchase-order";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const input = trackingSchema.parse(await request.json());
    return Response.json(
      await logisticsService.saveTracking(DEFAULT_OWNER_ID, id, input),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
