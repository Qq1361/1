import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { warehouseService } from "@/server/services/warehouse-service";
import { warehouseCreateSchema } from "@/server/validation/warehouse";

export async function GET(request: Request) {
  try {
    const activeOnly = new URL(request.url).searchParams.get("activeOnly") === "true";
    return Response.json(await warehouseService.list(DEFAULT_OWNER_ID, activeOnly));
  }
  catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try { return Response.json(await warehouseService.create(DEFAULT_OWNER_ID, warehouseCreateSchema.parse(await request.json()).name), { status: 201 }); }
  catch (error) { return toErrorResponse(error); }
}
