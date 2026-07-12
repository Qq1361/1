import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { db } from "@/server/db";

type C = { params: Promise<{ id: string }> };

export async function GET(_r: Request, c: C) {
  try {
    const { id } = await c.params;
    const sale = await db.saleOrder.findFirst({
      where: { id, ownerId: DEFAULT_OWNER_ID },
      include: {
        lines: { include: { inventoryItem: { select: { id: true, inventoryCode: true, name: true, itemStatus: true, saleMode: true, storageLocation: true } } } },
        feeLines: true,
        actionLogs: { orderBy: { createdAt: "desc" }, take: 30 },
      },
    });
    if (!sale) return Response.json({ code: "NOT_FOUND", message: "销售订单不存在。" }, { status: 404 });
    return Response.json(sale);
  } catch (error) { return toErrorResponse(error); }
}
