import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { todoService } from "@/server/services/todo-service";

export async function GET() {
  try {
    const { todos, pendingInspectionCount } = await todoService.list(DEFAULT_OWNER_ID);
    return Response.json({
      data: todos,
      counts: {
        missingTracking: todos.filter((t) => t.type === "MISSING_TRACKING").length,
        logisticsIssues: todos.filter((t) =>
          ["LOGISTICS_EXCEPTION", "LOGISTICS_STALLED"].includes(t.type),
        ).length,
        pendingInspection: pendingInspectionCount,
        distanceTo395Within7Days: todos.filter((t) => t.type === "DISTANCE_TO_395_WITHIN_7_DAYS").length,
        expiryUnder395: todos.filter((t) => t.type === "EXPIRY_UNDER_395").length,
        expiryUnder365: todos.filter((t) => t.type === "EXPIRY_UNDER_365").length,
        overstocked: todos.filter((t) => t.type === "OVERSTOCKED").length,
        ninetyFiveUnder90: todos.filter((t) => t.type === "NINETY_FIVE_EXPIRY_UNDER_90").length,
        ninetyFiveUnder60: todos.filter((t) => t.type === "NINETY_FIVE_EXPIRY_UNDER_60").length,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
