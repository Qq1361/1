import { ZodError } from "zod";
import { ServiceError } from "@/server/errors";

export async function parsePlatformReturnJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ServiceError("VALIDATION_ERROR", "请求 JSON 无效。", 400);
  }
}

function fieldErrors(error: ZodError) {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    errors[key] = [...(errors[key] ?? []), issue.message];
  }
  return errors;
}

export function toPlatformReturnErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return Response.json({ code: "VALIDATION_ERROR", message: "请求参数无效。", fieldErrors: fieldErrors(error) }, { status: 400 });
  }
  if (error instanceof ServiceError) {
    if (error.status === 404) {
      return Response.json({ code: "PLATFORM_RETURN_NOT_FOUND", message: "平台退回记录不存在或无权访问。" }, { status: 404 });
    }
    if (error.status === 400 || error.status === 422) {
      return Response.json({ code: "VALIDATION_ERROR", message: error.message, fieldErrors: error.fieldErrors }, { status: 400 });
    }
    if (error.status === 409) {
      const code = error.code === "PLATFORM_RETURN_INSPECTION_FINAL"
        ? "PLATFORM_RETURN_FINALIZED"
        : error.code === "PLATFORM_RETURN_INSPECTION_CONFLICT"
          ? "PLATFORM_RETURN_CONCURRENT_CONFLICT"
          : "PLATFORM_RETURN_STATE_CONFLICT";
      return Response.json({ code, message: error.message }, { status: 409 });
    }
    return Response.json({ code: error.code, message: error.message, fieldErrors: error.fieldErrors }, { status: error.status });
  }
  console.error(error);
  return Response.json({ code: "INTERNAL_ERROR", message: "服务器处理平台退回请求时发生错误。" }, { status: 500 });
}
