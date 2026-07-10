import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { db } from "@/server/db";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const { inventoryItemId, todoType, reasonKey, actionType, note } = input;
    if (!inventoryItemId || !actionType) {
      return Response.json({ code: "VALIDATION_ERROR", message: "缺少必填参数。" }, { status: 422 });
    }
    // Fetch current state for old/new snapshot
    const item = await db.inventoryItem.findFirst({
      where: { id: inventoryItemId, ownerId: DEFAULT_OWNER_ID },
      select: { saleMode: true, itemStatus: true, storageLocation: true, expiryDate: true, purchaseOrderItemId: true },
    });
    if (!item) return Response.json({ code: "NOT_FOUND", message: "库存不存在。" }, { status: 404 });

    const log = await db.inventoryActionLog.create({
      data: {
        ownerId: DEFAULT_OWNER_ID,
        inventoryItemId,
        purchaseOrderId: null,
        todoType: todoType?.trim() || null,
        reasonKey: reasonKey?.trim() || null,
        actionType,
        note: note?.trim() || null,
        oldSaleMode: item.saleMode,
        oldItemStatus: item.itemStatus,
        oldStorageLocation: item.storageLocation,
        oldExpiryDate: item.expiryDate,
        // new values set below after update happens; for now same as old
        newSaleMode: item.saleMode,
        newItemStatus: item.itemStatus,
        newStorageLocation: item.storageLocation,
        newExpiryDate: item.expiryDate,
      },
    });
    return Response.json(log);
  } catch (error) {
    return toErrorResponse(error);
  }
}
