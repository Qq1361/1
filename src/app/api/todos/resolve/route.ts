import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { db } from "@/server/db";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const { todoType, entityType, entityId, reasonKey, note } = input;
    if (!todoType || !entityType || !entityId || !reasonKey) {
      return Response.json(
        { code: "VALIDATION_ERROR", message: "缺少必填参数。" },
        { status: 422 },
      );
    }
    // Use TodoResolution for business action resolution vs ReminderState for snooze
    await db.todoResolution.upsert({
      where: {
        ownerId_todoType_reasonKey: {
          ownerId: DEFAULT_OWNER_ID,
          todoType,
          reasonKey,
        },
      },
      update: {
        entityType,
        entityId,
        actionType: note || "RESOLVED",
        resolvedAt: new Date(),
      },
      create: {
        ownerId: DEFAULT_OWNER_ID,
        todoType,
        entityType,
        entityId,
        reasonKey,
        actionType: note || "RESOLVED",
        resolvedAt: new Date(),
      },
    });
    // Also mark ReminderState as resolved for this todo
    await db.reminderState.upsert({
      where: {
        ownerId_todoType_entityType_entityId: {
          ownerId: DEFAULT_OWNER_ID,
          todoType,
          entityType,
          entityId,
        },
      },
      update: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        reasonKey,
        note: `TodoResolution: ${note || "RESOLVED"}`,
      },
      create: {
        ownerId: DEFAULT_OWNER_ID,
        todoType,
        entityType,
        entityId,
        status: "RESOLVED",
        reasonKey,
        resolvedAt: new Date(),
        note: `TodoResolution: ${note || "RESOLVED"}`,
      },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
