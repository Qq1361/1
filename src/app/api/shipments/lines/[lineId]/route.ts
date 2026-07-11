import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { shipmentService } from "@/server/services/shipment-service";
type C = { params: Promise<{ lineId: string }> };
export async function PATCH(r: Request, c: C) {
  try { return Response.json(await shipmentService.updateLine(DEFAULT_OWNER_ID, (await c.params).lineId, await r.json())); }
  catch (e) { return toErrorResponse(e); }
}
export async function DELETE(_r: Request, c: C) {
  try { return Response.json(await shipmentService.removeLineFromDraft(DEFAULT_OWNER_ID, (await c.params).lineId)); }
  catch (e) { return toErrorResponse(e); }
}
