import { DEFAULT_OWNER_ID } from "@/server/constants";
import { ServiceError, toErrorResponse } from "@/server/errors";
import { db } from "@/server/db";
import { deliverDailyBusinessReport } from "@/server/notifications/daily-business-report-delivery-coordinator";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = (await context.params).id;
    const delivery = await db.dailyBusinessReportDelivery.findFirst({
      where: { id, ownerId: DEFAULT_OWNER_ID },
      select: { reportDate: true, timezone: true },
    });
    if (!delivery) throw new ServiceError("DAILY_REPORT_DELIVERY_NOT_FOUND", "日报发送记录不存在。", 404);
    const date = delivery.reportDate.toISOString().slice(0, 10);
    return Response.json(await deliverDailyBusinessReport({
      ownerId: DEFAULT_OWNER_ID,
      date,
      timezone: delivery.timezone,
      requestedAt: new Date(),
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
