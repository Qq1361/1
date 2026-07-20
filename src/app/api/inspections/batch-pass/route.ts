import { DEFAULT_OWNER_ID } from "@/server/constants";
import { serializeDateOnlyFields } from "@/lib/date-only";
import { toErrorResponse } from "@/server/errors";
import { inspectionService } from "@/server/services/inspection-service";
import { inspectionBatchPassDetailsSchema, inspectionBatchPassSchema } from "@/server/validation/inspection";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const detailed = inspectionBatchPassDetailsSchema.safeParse(payload);
    const result = detailed.success
      ? await inspectionService.batchPassWithDetails(DEFAULT_OWNER_ID, detailed.data.items, detailed.data.commonNote)
      : await inspectionService.batchPass(DEFAULT_OWNER_ID, inspectionBatchPassSchema.parse(payload).inspectionIds);
    return Response.json(serializeDateOnlyFields(result));
  } catch (error) {
    return toErrorResponse(error);
  }
}
