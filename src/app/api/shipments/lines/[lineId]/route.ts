import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { shipmentService } from "@/server/services/shipment-service";

type Context = { params: Promise<{ lineId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { lineId } = await context.params;
    const input = await request.json();
    return Response.json(await shipmentService.updateLine(DEFAULT_OWNER_ID, lineId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
