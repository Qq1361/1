import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { warehouseService } from "@/server/services/warehouse-service";
import { warehouseLocationCreateSchema } from "@/server/validation/warehouse";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await warehouseService.createLocation(DEFAULT_OWNER_ID, (await params).id, warehouseLocationCreateSchema.parse(await request.json()).name), { status: 201 }); }
  catch (error) { return toErrorResponse(error); }
}
