import { DEFAULT_OWNER_ID } from "@/server/constants";
import { serializeDateOnlyFields } from "@/lib/date-only";
import { toErrorResponse } from "@/server/errors";
import { inspectionService } from "@/server/services/inspection-service";
import { inspectionListSchema } from "@/server/validation/inspection";

export async function GET(request: Request) {
  try {
    const query = inspectionListSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(serializeDateOnlyFields(await inspectionService.list(DEFAULT_OWNER_ID, query.query)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
