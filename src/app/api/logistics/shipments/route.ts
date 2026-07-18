import { DEFAULT_OWNER_ID } from "@/server/constants";
import {
  assertPurchaseInboundBusinessType,
  logisticsShipmentCreateSchema,
  logisticsShipmentDto,
  logisticsShipmentQuerySchema,
  toLogisticsErrorResponse,
  parseOptionalLogisticsJson,
} from "@/server/logistics/logistics-api";
import { genericLogisticsService } from "@/server/logistics/logistics-service";

export async function GET(request: Request) {
  try {
    const input = logisticsShipmentQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    assertPurchaseInboundBusinessType(input.businessType);
    const result = await genericLogisticsService.getShipmentForBusiness(DEFAULT_OWNER_ID, input.businessType, input.businessId);
    return Response.json(logisticsShipmentDto(result));
  } catch (error) {
    return toLogisticsErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = logisticsShipmentCreateSchema.parse(await parseOptionalLogisticsJson(request));
    assertPurchaseInboundBusinessType(input.businessType);
    const shipment = await genericLogisticsService.registerShipment(DEFAULT_OWNER_ID, input);
    const events = await genericLogisticsService.listTrackingEvents(DEFAULT_OWNER_ID, shipment.id);
    return Response.json(
      logisticsShipmentDto({ shipment, events }),
      { status: shipment.wasCreated ? 201 : 200 },
    );
  } catch (error) {
    return toLogisticsErrorResponse(error);
  }
}
