import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { shipmentService } from "@/server/services/shipment-service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") ?? undefined;
    const page = parseInt(searchParams.get("page") ?? "1");
    const pageSize = parseInt(searchParams.get("pageSize") ?? "20");
    return Response.json(await shipmentService.selectableItems(DEFAULT_OWNER_ID, query, page, pageSize));
  } catch (error) { return toErrorResponse(error); }
}
