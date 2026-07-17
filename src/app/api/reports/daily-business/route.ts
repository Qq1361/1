import { z } from "zod";
import { DEFAULT_OWNER_ID } from "@/server/constants";
import { ServiceError, toErrorResponse } from "@/server/errors";
import { getDailyBusinessReport } from "@/server/reports/daily-business-report";

const querySchema = z.object({
  date: z.string().optional(),
  timezone: z.string().optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      throw new ServiceError("VALIDATION_ERROR", "日报查询参数无效。", 400, parsed.error.flatten().fieldErrors);
    }
    return Response.json(await getDailyBusinessReport({
      ownerId: DEFAULT_OWNER_ID,
      date: parsed.data.date,
      timezone: parsed.data.timezone,
      generatedAt: new Date(),
    }));
  } catch (error) {
    if (error instanceof ServiceError) return toErrorResponse(error);
    console.error(error);
    return Response.json({ code: "DAILY_REPORT_GENERATION_FAILED", message: "生成每日经营报告失败。" }, { status: 500 });
  }
}
