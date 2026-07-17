import { ZodError } from "zod";
import { ServiceError, toErrorResponse } from "@/server/errors";

export async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ServiceError("INVALID_REQUEST", "请求 JSON 无效。", 400);
  }
}

export async function parseOptionalJsonBody(request: Request) {
  const body = await request.text();
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new ServiceError("INVALID_REQUEST", "请求 JSON 无效。", 400);
  }
}

export function toPurchaseAfterSaleErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "form";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return Response.json({ code: "INVALID_REQUEST", message: "请求参数无效。", fieldErrors }, { status: 400 });
  }
  if (error instanceof ServiceError && error.status === 422) {
    return Response.json({ code: error.code, message: error.message, fieldErrors: error.fieldErrors }, { status: 400 });
  }
  return toErrorResponse(error);
}
