import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { getDailyBusinessReportDeliveryStatus } from "@/server/notifications/daily-business-report-delivery-coordinator";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const allowed = new Set(["date", "timezone"]);
    if ([...searchParams.keys()].some((key) => !allowed.has(key))) {
      return Response.json({ code: "UNKNOWN_FIELD", message: "请求参数无效。" }, { status: 400 });
    }
    return Response.json(await getDailyBusinessReportDeliveryStatus({
      ownerId: DEFAULT_OWNER_ID,
      date: searchParams.get("date") ?? undefined,
      timezone: searchParams.get("timezone") ?? undefined,
      requestedAt: new Date(),
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
