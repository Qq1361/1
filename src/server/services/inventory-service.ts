import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { getReminderType } from "@/server/services/todo-service";

export class InventoryService {
  async list(
    ownerId: string,
    query: {
      query?: string;
      itemStatus?: Prisma.EnumItemStatusFilter["equals"];
      saleMode?: Prisma.EnumSaleModeFilter["equals"];
      locationStatus?: Prisma.EnumLocationStatusFilter["equals"];
      reminder?: string;
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
              { purchaseOrderItem: { purchaseOrder: { orderNo: { contains: query.query, mode: "insensitive" } } } },
              { purchaseOrderItem: { purchaseOrder: { sellerNickname: { contains: query.query, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };
    // Reminder filter: fetch all, then filter in-memory using the shared getReminderType
    // to ensure exact consistency with /api/todos counts
    if (query.reminder) {
      // Use a broader DB filter first to limit data, then refine in code
      if (query.reminder === "STOCKED_OVER_3_DAYS") {
        where.itemStatus = "STOCKED";
        where.stockedAt = { lte: new Date(now.getTime() - 72 * 60 * 60 * 1000) };
      } else {
        // For expiry reminders, fetch STOCKED items with any expiry
        where.itemStatus = "STOCKED";
        where.expiryDate = { not: null };
      }
    }
    // For reminder filters, use the exact same todo computation as /api/todos
    // to ensure count consistency with dashboard cards
    if (query.reminder && query.reminder !== "STOCKED_OVER_3_DAYS") {
      // Fetch all matching items + todos + reminder states in one transaction
      const allItems = await db.inventoryItem.findMany({
        where,
        orderBy: { stockedAt: "desc" },
      });
      // Get reminder states to apply the same snooze/resolve filtering as /api/todos
      const [reminderStates, todoResolutions] = await Promise.all([
        db.reminderState.findMany({
          where: { ownerId },
          select: { todoType: true, entityType: true, entityId: true, status: true, snoozedUntil: true, reasonKey: true },
        }),
        db.todoResolution.findMany({
          where: { ownerId },
          select: { todoType: true, reasonKey: true },
        }),
      ]);
      const resolutionSet = new Set(todoResolutions.map((r) => `${r.todoType}:${r.reasonKey}`));
      const reminderMap = new Map<string, { status: string; snoozedUntil: Date | null; reasonKey: string | null }>();
      for (const r of reminderStates) {
        reminderMap.set(`${r.todoType}:${r.entityType}:${r.entityId}`, { status: r.status, snoozedUntil: r.snoozedUntil, reasonKey: r.reasonKey });
      }

      const filtered = allItems.filter((item) => {
        const type = getReminderType({
          saleMode: item.saleMode,
          itemStatus: item.itemStatus,
          expiryDate: item.expiryDate,
          stockedAt: item.stockedAt,
        }, now);
        if (type !== query.reminder) return false;
        // Apply same snooze/resolve filtering as TodoService.list
        const reasonKey = `${item.saleMode}:${item.expiryDate?.toISOString() ?? "none"}:${item.itemStatus}`;
        if (resolutionSet.has(`${type}:${reasonKey}`)) return false;
        const state = reminderMap.get(`${type}:INVENTORY_ITEM:${item.id}`);
        if (state) {
          if (state.reasonKey && state.reasonKey !== reasonKey) return true; // state changed, show again
          if (state.status === "RESOLVED") return false;
          if (state.status === "SNOOZED" && state.snoozedUntil && state.snoozedUntil > now) return false;
        }
        return true;
      });
      const total = filtered.length;
      const data = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
      return { data, total, page: query.page, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
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
        shipmentLines: {
          orderBy: { createdAt: "desc" },
          include: {
            batch: true,
            group: true,
          },
        },
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
