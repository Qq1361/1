import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { shipmentService } from "@/server/services/shipment-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(await shipmentService.get(DEFAULT_OWNER_ID, id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const input = await request.json();
    return Response.json(await shipmentService.update(DEFAULT_OWNER_ID, id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
