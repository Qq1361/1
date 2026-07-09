export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "form";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return Response.json(
      { code: "VALIDATION_ERROR", message: "请检查输入内容。", fieldErrors },
      { status: 422 },
    );
  }
  if (error instanceof ServiceError) {
    return Response.json(
      {
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
      },
      { status: error.status },
    );
  }

  console.error(error);
  return Response.json(
    { code: "INTERNAL_ERROR", message: "服务器处理请求时发生错误。" },
    { status: 500 },
  );
}
import { ZodError } from "zod";
