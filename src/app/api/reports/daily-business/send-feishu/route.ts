import { z } from "zod";
import { DEFAULT_OWNER_ID } from "@/server/constants";
import { ServiceError, toErrorResponse } from "@/server/errors";
import { deliverDailyBusinessReport } from "@/server/notifications/daily-business-report-delivery-coordinator";

const requestSchema = z.object({
  date: z.string().optional(),
  timezone: z.string().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ServiceError("VALIDATION_ERROR", "请求参数无效。", 400);
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const unknownField = parsed.error.issues.some((issue) => issue.code === z.ZodIssueCode.unrecognized_keys);
      throw new ServiceError(unknownField ? "UNKNOWN_FIELD" : "VALIDATION_ERROR", "请求参数无效。", 400, parsed.error.flatten().fieldErrors);
    }
    return Response.json(await deliverDailyBusinessReport({
      ownerId: DEFAULT_OWNER_ID,
      date: parsed.data.date,
      timezone: parsed.data.timezone,
      requestedAt: new Date(),
    }));
  } catch (error) {
    if (error instanceof ServiceError) return toErrorResponse(error);
    return toErrorResponse(error);
  }
}
