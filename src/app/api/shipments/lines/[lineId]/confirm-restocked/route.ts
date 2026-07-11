import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { shipmentService } from "@/server/services/shipment-service";
type C = { params: Promise<{ lineId: string }> };
export async function POST(_r: Request, c: C) {
  try { return Response.json(await shipmentService.confirmRestocked(DEFAULT_OWNER_ID, (await c.params).lineId)); }
  catch (e) { return toErrorResponse(e); }
}
