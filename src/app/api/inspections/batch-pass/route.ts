import { DEFAULT_OWNER_ID } from "@/server/constants";
import { serializeDateOnlyFields } from "@/lib/date-only";
import { toErrorResponse } from "@/server/errors";
import { inspectionService } from "@/server/services/inspection-service";
import { inspectionBatchPassSchema } from "@/server/validation/inspection";

export async function POST(request: Request) {
  try {
    const input = inspectionBatchPassSchema.parse(await request.json());
    return Response.json(serializeDateOnlyFields(await inspectionService.batchPass(DEFAULT_OWNER_ID, input.inspectionIds)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
