import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { applyShipmentLineAction } from "@/server/shipments/applyShipmentLineAction";
type C = { params: Promise<{ lineId: string }> };
export async function POST(_r: Request, c: C) {
  try { return Response.json(await applyShipmentLineAction(DEFAULT_OWNER_ID, (await c.params).lineId, "markInWarehouse")); }
  catch (e) { return toErrorResponse(e); }
}
