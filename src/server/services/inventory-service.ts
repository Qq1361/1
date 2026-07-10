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
      reminder?: "EXPIRY_UNDER_395" | "EXPIRY_UNDER_365" | "STOCKED_OVER_3_DAYS";
      page: number;
      pageSize: number;
    },
  ) {
    const now = new Date();
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
              { storageLocation: { contains: query.query, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    // Apply reminder filters on top
    if (query.reminder) {
      where.itemStatus = "STOCKED";
      if (query.reminder === "STOCKED_OVER_3_DAYS") {
        where.stockedAt = { lte: new Date(now.getTime() - 72 * 60 * 60 * 1000) };
      } else if (query.reminder === "EXPIRY_UNDER_365") {
        where.expiryDate = {
          not: null,
          lte: new Date(now.getTime() + 365 * 86_400_000),
        };
      } else if (query.reminder === "EXPIRY_UNDER_395") {
        where.expiryDate = {
          not: null,
          lte: new Date(now.getTime() + 395 * 86_400_000),
        };
      }
    }
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

  async update(
    ownerId: string,
    id: string,
    data: { saleMode?: string; storageLocation?: string; itemStatus?: string; problemReason?: string },
  ) {
    const item = await db.inventoryItem.findFirst({
      where: { id, ownerId },
    });
    if (!item)
      throw new ServiceError("INVENTORY_NOT_FOUND", "库存商品不存在。", 404);
    if (["SOLD", "REMOVED"].includes(item.itemStatus)) {
      throw new ServiceError(
        "ITEM_FINALIZED",
        "该库存已售出或已移除，不允许修改。",
        409,
      );
    }
    const updateData: Record<string, unknown> = {};
    if (data.saleMode !== undefined) updateData.saleMode = data.saleMode as Prisma.EnumSaleModeFieldUpdateOperationsInput["set"];
    if (data.storageLocation !== undefined) updateData.storageLocation = data.storageLocation?.trim() || null;
    if (data.itemStatus !== undefined) {
      updateData.itemStatus = data.itemStatus as Prisma.EnumItemStatusFieldUpdateOperationsInput["set"];
      if (data.itemStatus === "PROBLEM") {
        updateData.problemReason = data.problemReason?.trim() || "标记为问题件";
      } else if (data.itemStatus === "STOCKED") {
        updateData.problemReason = null;
      }
    }
    return db.inventoryItem.update({ where: { id }, data: updateData });
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
