import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { db } from "@/server/db";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const { todoType, entityType, entityId, snoozedUntil, note, reasonKey } = input;
    if (!todoType || !entityType || !entityId || !snoozedUntil) {
      return Response.json(
        { code: "VALIDATION_ERROR", message: "缺少必填参数。" },
        { status: 422 },
      );
    }
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
        status: "SNOOZED",
        reasonKey: reasonKey?.trim() || null,
        snoozedUntil: new Date(snoozedUntil),
        note: note?.trim() || null,
      },
      create: {
        ownerId: DEFAULT_OWNER_ID,
        todoType,
        entityType,
        entityId,
        status: "SNOOZED",
        reasonKey: reasonKey?.trim() || null,
        snoozedUntil: new Date(snoozedUntil),
        note: note?.trim() || null,
      },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
