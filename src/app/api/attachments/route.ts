import { z } from "zod";
import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { attachmentService } from "@/server/services/attachment-service";

const entitySchema = z.object({
  entityType: z.enum(["PURCHASE_ORDER", "PURCHASE_ORDER_ITEM"]),
  entityId: z.string().cuid(),
});

export async function GET(request: Request) {
  try {
    const input = entitySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(
      await attachmentService.list(
        DEFAULT_OWNER_ID,
        input.entityType,
        input.entityId,
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const input = entitySchema.parse({
      entityType: formData.get("entityType"),
      entityId: formData.get("entityId"),
    });
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { code: "FILE_REQUIRED", message: "请选择要上传的图片。" },
        { status: 422 },
      );
    }
    return Response.json(
      await attachmentService.upload(
        DEFAULT_OWNER_ID,
        input.entityType,
        input.entityId,
        file,
      ),
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
