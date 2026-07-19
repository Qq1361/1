import { DEFAULT_OWNER_ID } from "@/server/constants";
import { serializeDateOnlyFields } from "@/lib/date-only";
import { toErrorResponse } from "@/server/errors";
import { inspectionService } from "@/server/services/inspection-service";
import { inspectionCompleteSchema } from "@/server/validation/inspection";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const input = inspectionCompleteSchema.parse(await request.json());
    return Response.json(
      serializeDateOnlyFields(await inspectionService.complete(
        DEFAULT_OWNER_ID,
        (await context.params).id,
        input,
      )),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
