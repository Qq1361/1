import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { shipmentService } from "@/server/services/shipment-service";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(await shipmentService.markReceived(DEFAULT_OWNER_ID, id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
