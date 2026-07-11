import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { shipmentService } from "@/server/services/shipment-service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") ?? undefined;
    return Response.json(await shipmentService.list(DEFAULT_OWNER_ID, query));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    return Response.json(await shipmentService.create(DEFAULT_OWNER_ID, input), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
