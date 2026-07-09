import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { attachmentService } from "@/server/services/attachment-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(await attachmentService.get(DEFAULT_OWNER_ID, id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await attachmentService.delete(DEFAULT_OWNER_ID, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
