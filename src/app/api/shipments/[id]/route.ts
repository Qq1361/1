import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { shipmentService } from "@/server/services/shipment-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_r: Request, c: Context) {
  try { return Response.json(await shipmentService.get(DEFAULT_OWNER_ID, (await c.params).id)); }
  catch (e) { return toErrorResponse(e); }
}

export async function PATCH(r: Request, c: Context) {
  try { return Response.json(await shipmentService.update(DEFAULT_OWNER_ID, (await c.params).id, await r.json())); }
  catch (e) { return toErrorResponse(e); }
}
