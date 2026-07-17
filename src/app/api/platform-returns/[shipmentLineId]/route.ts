import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toPlatformReturnErrorResponse } from "@/server/platform-return-inspection/platform-return-inspection-api";
import { platformReturnInspectionQuery } from "@/server/platform-return-inspection/platform-return-inspection-query";
import { platformReturnShipmentLineIdSchema } from "@/server/platform-return-inspection/platform-return-inspection-validation";

type Context = { params: Promise<{ shipmentLineId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const shipmentLineId = platformReturnShipmentLineIdSchema.parse((await context.params).shipmentLineId);
    return Response.json(await platformReturnInspectionQuery.getDetail(DEFAULT_OWNER_ID, shipmentLineId));
  } catch (error) {
    return toPlatformReturnErrorResponse(error);
  }
}
