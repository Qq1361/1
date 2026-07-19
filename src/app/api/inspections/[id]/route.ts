import { DEFAULT_OWNER_ID } from "@/server/constants";
import { serializeDateOnlyFields } from "@/lib/date-only";
import { toErrorResponse } from "@/server/errors";
import { inspectionService } from "@/server/services/inspection-service";
import { inspectionPatchSchema } from "@/server/validation/inspection";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    return Response.json(
      serializeDateOnlyFields(await inspectionService.get(DEFAULT_OWNER_ID, (await context.params).id)),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const input = inspectionPatchSchema.parse(await request.json());
    return Response.json(
      serializeDateOnlyFields(await inspectionService.update(
        DEFAULT_OWNER_ID,
        (await context.params).id,
        input,
      )),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
