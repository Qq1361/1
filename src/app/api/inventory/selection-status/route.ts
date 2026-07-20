import { DEFAULT_OWNER_ID } from "@/server/constants";
import { db } from "@/server/db";
import { toErrorResponse } from "@/server/errors";
import { inventorySelectionStatusSchema } from "@/server/validation/inventory";

/**
 * Reconciles the client-only cross-page selection after a list refresh.
 * It deliberately returns only items that still belong to the current owner.
 */
export async function POST(request: Request) {
  try {
    const { inventoryItemIds } = inventorySelectionStatusSchema.parse(await request.json());
    const items = await db.inventoryItem.findMany({
      where: { ownerId: DEFAULT_OWNER_ID, id: { in: inventoryItemIds } },
      select: { id: true },
    });
    return Response.json({ inventoryItemIds: items.map((item) => item.id) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
