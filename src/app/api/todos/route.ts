import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { todoService } from "@/server/services/todo-service";

export async function GET() {
  try {
    const data = await todoService.list(DEFAULT_OWNER_ID);
    return Response.json({
      data,
      counts: {
        missingTracking: data.filter(
          (item) => item.type === "MISSING_TRACKING",
        ).length,
        logisticsIssues: data.filter((item) =>
          ["LOGISTICS_EXCEPTION", "LOGISTICS_STALLED"].includes(item.type),
        ).length,
        pendingInspection: data.filter(
          (item) => item.type === "PENDING_INSPECTION",
        ).length,
        expiryBelow395: data.filter(
          (item) => item.type === "EXPIRY_BELOW_395",
        ).length,
        expiryBelow365: data.filter(
          (item) => item.type === "EXPIRY_BELOW_365",
        ).length,
        overstocked: data.filter((item) => item.type === "OVERSTOCKED").length,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
