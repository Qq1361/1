import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inspectionService } from "@/server/services/inspection-service";
import { inspectionBatchPassSchema } from "@/server/validation/inspection";

export async function POST(request: Request) {
  try {
    const input = inspectionBatchPassSchema.parse(await request.json());
    return Response.json(await inspectionService.batchPass(DEFAULT_OWNER_ID, input.inspectionIds));
  } catch (error) {
    return toErrorResponse(error);
  }
}
