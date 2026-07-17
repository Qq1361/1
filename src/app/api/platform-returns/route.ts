import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toPlatformReturnErrorResponse } from "@/server/platform-return-inspection/platform-return-inspection-api";
import { platformReturnInspectionQuery } from "@/server/platform-return-inspection/platform-return-inspection-query";
import { listPlatformReturnsQuerySchema } from "@/server/platform-return-inspection/platform-return-inspection-validation";

export async function GET(request: Request) {
  try {
    const filters = listPlatformReturnsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await platformReturnInspectionQuery.list(DEFAULT_OWNER_ID, filters));
  } catch (error) {
    return toPlatformReturnErrorResponse(error);
  }
}
