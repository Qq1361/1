import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { salesService } from "@/server/sales/sales-service";
type C = { params: Promise<{ id: string }> };
export async function POST(_r: Request, c: C) {
  try { return Response.json(await salesService.confirm(DEFAULT_OWNER_ID, (await c.params).id)); }
  catch (e) { return toErrorResponse(e); }
}
