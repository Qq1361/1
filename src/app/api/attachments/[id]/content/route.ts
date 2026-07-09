import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { attachmentService } from "@/server/services/attachment-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { attachment, object } = await attachmentService.read(
      DEFAULT_OWNER_ID,
      id,
    );
    const body = object.data.buffer.slice(
      object.data.byteOffset,
      object.data.byteOffset + object.data.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": object.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
