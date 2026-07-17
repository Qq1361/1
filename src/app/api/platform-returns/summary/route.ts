import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { getPlatformReturnSummary } from "@/server/reports/platform-return-summary";

export async function GET() {
  try {
    return Response.json(await getPlatformReturnSummary(DEFAULT_OWNER_ID));
  } catch (error) {
    return toErrorResponse(error);
  }
}
