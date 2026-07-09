import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";

export class InventoryService {
  async list(
    ownerId: string,
    query: {
      query?: string;
      itemStatus?: Prisma.EnumItemStatusFilter["equals"];
      saleMode?: Prisma.EnumSaleModeFilter["equals"];
      locationStatus?: Prisma.EnumLocationStatusFilter["equals"];
      page: number;
      pageSize: number;
    },
  ) {
    const where: Prisma.InventoryItemWhereInput = {
      ownerId,
      itemStatus: query.itemStatus,
      saleMode: query.saleMode,
      locationStatus: query.locationStatus,
      ...(query.query
        ? {
            OR: [
              { name: { contains: query.query, mode: "insensitive" } },
              { skuText: { contains: query.query, mode: "insensitive" } },
              { inventoryCode: { contains: query.query, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [data, total] = await db.$transaction([
      db.inventoryItem.findMany({
        where,
        orderBy: { stockedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.inventoryItem.count({ where }),
    ]);
    return { data, total, page: query.page, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  async get(ownerId: string, id: string) {
    const item = await db.inventoryItem.findFirst({
      where: { id, ownerId },
      include: {
        inspection: true,
        purchaseOrderItem: { include: { purchaseOrder: true } },
      },
    });
    if (!item)
      throw new ServiceError("INVENTORY_NOT_FOUND", "库存商品不存在。", 404);
    const attachments = await db.attachment.findMany({
      where: { ownerId, entityType: "INSPECTION", entityId: item.inspectionId },
      orderBy: { createdAt: "desc" },
    });
    return { ...item, attachments };
  }
}

export const inventoryService = new InventoryService();
