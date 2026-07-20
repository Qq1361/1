import { DEFAULT_OWNER_ID } from "@/server/constants";
import { serializeDateOnlyFields } from "@/lib/date-only";
import { ServiceError, toErrorResponse } from "@/server/errors";
import { inspectionService } from "@/server/services/inspection-service";
import { inspectionListSchema } from "@/server/validation/inspection";

export async function GET(request: Request) {
  try {
    const parsed = inspectionListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      throw new ServiceError(
        field === "query" ? "INVALID_KEYWORD" : field === "pageSize" ? "INVALID_PAGE_SIZE" : "INVALID_PAGE",
        "待验货列表查询参数无效。",
        400,
      );
    }
    return Response.json(serializeDateOnlyFields(await inspectionService.list(DEFAULT_OWNER_ID, parsed.data)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
