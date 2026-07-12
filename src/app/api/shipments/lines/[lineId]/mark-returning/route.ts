import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { applyShipmentLineAction } from "@/server/shipments/applyShipmentLineAction";
type C = { params: Promise<{ lineId: string }> };
export async function POST(r: Request, c: C) {
  try { const input = await r.json(); return Response.json(await applyShipmentLineAction(DEFAULT_OWNER_ID, (await c.params).lineId, "markReturning", input)); }
  catch (e) { return toErrorResponse(e); }
}
