import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { warehouseService } from "@/server/services/warehouse-service";
import { warehouseLocationUpdateSchema } from "@/server/validation/warehouse";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await warehouseService.updateLocation(DEFAULT_OWNER_ID, (await params).id, warehouseLocationUpdateSchema.parse(await request.json()))); }
  catch (error) { return toErrorResponse(error); }
}
