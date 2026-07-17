import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parsePlatformReturnJson, toPlatformReturnErrorResponse } from "@/server/platform-return-inspection/platform-return-inspection-api";
import { platformReturnInspectionQuery } from "@/server/platform-return-inspection/platform-return-inspection-query";
import { platformReturnInspectionService } from "@/server/platform-return-inspection/platform-return-inspection-service";
import { inspectPlatformReturnSchema, platformReturnShipmentLineIdSchema } from "@/server/platform-return-inspection/platform-return-inspection-validation";

type Context = { params: Promise<{ shipmentLineId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const shipmentLineId = platformReturnShipmentLineIdSchema.parse((await context.params).shipmentLineId);
    const input = inspectPlatformReturnSchema.parse(await parsePlatformReturnJson(request));
    await platformReturnInspectionService.inspectReturn({ ownerId: DEFAULT_OWNER_ID, shipmentLineId, ...input });
    const detail = await platformReturnInspectionQuery.getDetail(DEFAULT_OWNER_ID, shipmentLineId);
    return Response.json({
      inspection: detail.inspection,
      shipmentLine: detail.shipmentLine,
      inventoryItem: detail.inventoryItem,
      latestActionLog: detail.actionLogs[0] ?? null,
      availableActions: detail.availableActions,
    });
  } catch (error) {
    return toPlatformReturnErrorResponse(error);
  }
}
