import { kdniaoPublicStatus } from "@/server/logistics/kdniao-config";
import { toLogisticsErrorResponse } from "@/server/logistics/logistics-api";

export async function GET() {
  try {
    return Response.json(kdniaoPublicStatus());
  } catch (error) {
    return toLogisticsErrorResponse(error);
  }
}
