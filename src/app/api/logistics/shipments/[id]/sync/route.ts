import { DEFAULT_OWNER_ID } from "@/server/constants";
import {
  logisticsShipmentDto,
  logisticsSyncSchema,
  parseOptionalLogisticsJson,
  toLogisticsErrorResponse,
} from "@/server/logistics/logistics-api";
import { genericLogisticsService } from "@/server/logistics/logistics-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    logisticsSyncSchema.parse(await parseOptionalLogisticsJson(request));
    const id = (await context.params).id;
    await genericLogisticsService.syncShipmentWithProvider(DEFAULT_OWNER_ID, id);
    const shipment = await genericLogisticsService.getShipment(DEFAULT_OWNER_ID, id);
    const events = await genericLogisticsService.listTrackingEvents(DEFAULT_OWNER_ID, id);
    return Response.json(logisticsShipmentDto({ shipment, events }));
  } catch (error) {
    return toLogisticsErrorResponse(error);
  }
}
