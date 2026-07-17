import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parsePlatformReturnJson, toPlatformReturnErrorResponse } from "@/server/platform-return-inspection/platform-return-inspection-api";
import { legacyConfirmRestockedSchema, platformReturnShipmentLineIdSchema } from "@/server/platform-return-inspection/platform-return-inspection-validation";
import { shipmentService } from "@/server/services/shipment-service";

type C = { params: Promise<{ lineId: string }> };

export async function POST(r: Request, c: C) {
  try {
    const lineId = platformReturnShipmentLineIdSchema.parse((await c.params).lineId);
    const input = legacyConfirmRestockedSchema.parse(await parsePlatformReturnJson(r));
    const line = await shipmentService.confirmRestocked(DEFAULT_OWNER_ID, lineId, input);
    return Response.json(line, {
      headers: {
        Deprecation: "true",
        Link: `</api/platform-returns/${lineId}/inspection>; rel=\"successor-version\"`,
      },
    });
  } catch (error) {
    return toPlatformReturnErrorResponse(error);
  }
}
