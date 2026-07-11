import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";

const purposeSaleMode: Record<string, string> = {
  DEWU_LIGHTNING_INBOUND: "DEWU_LIGHTNING",
  DEWU_STANDARD_FULFILLMENT: "DEWU_STANDARD",
  NINETY_FIVE_INBOUND: "NINETY_FIVE",
  OTHER: "OTHER",
};

function batchNo() {
  const d = new Date();
  const day = d.toISOString().slice(0, 10).replaceAll("-", "");
  const seq = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SHIP-${day}-${seq}`;
}

export class ShipmentService {
  async list(ownerId: string, query?: string) {
    const where: Prisma.PlatformShipmentBatchWhereInput = {
      ownerId,
      ...(query
        ? {
            OR: [
              { batchNo: { contains: query, mode: "insensitive" } },
              { trackingNo: { contains: query, mode: "insensitive" } },
              { lines: { some: { inventoryCodeSnapshot: { contains: query, mode: "insensitive" } } } },
              { lines: { some: { productNameSnapshot: { contains: query, mode: "insensitive" } } } },
              { groups: { some: { platformOrderNo: { contains: query, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      db.platformShipmentBatch.findMany({
        where,
        include: {
          _count: { select: { lines: true } },
          groups: { select: { id: true, groupName: true, platformOrderNo: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.platformShipmentBatch.count({ where }),
    ]);
    return { data, total };
  }

  async get(ownerId: string, id: string) {
    const batch = await db.platformShipmentBatch.findFirst({
      where: { id, ownerId },
      include: {
        groups: true,
        lines: {
          include: {
            inventoryItem: {
              select: {
                id: true, inventoryCode: true, name: true, skuText: true,
                unitCost: true, expiryDate: true, itemStatus: true,
                saleMode: true, storageLocation: true,
                purchaseOrderItem: {
                  select: { purchaseOrder: { select: { id: true, orderNo: true } } },
                },
              },
            },
            group: true,
          },
        },
      },
    });
    if (!batch) throw new ServiceError("BATCH_NOT_FOUND", "寄送批次不存在。", 404);
    return batch;
  }

  async create(
    ownerId: string,
    input: {
      platform: string;
      purpose: string;
      carrierCode?: string;
      trackingNo?: string;
      shippedAt?: string;
      note?: string;
      itemIds: string[];
      groupAssignments?: { itemId: string; platformOrderNo?: string; groupName?: string }[];
    },
  ) {
    // Validate items are STOCKED and not in other active batches
    const items = await db.inventoryItem.findMany({
      where: { id: { in: input.itemIds }, ownerId },
      include: { shipmentLines: { where: { lineStatus: { notIn: ["RETURNED"] } }, select: { id: true } } },
    });
    if (items.length !== input.itemIds.length) {
      throw new ServiceError("ITEMS_NOT_FOUND", "部分库存不存在。", 404);
    }
    for (const item of items) {
      if (item.itemStatus !== "STOCKED") {
        throw new ServiceError(
          "ITEM_NOT_AVAILABLE",
          `库存 ${item.inventoryCode} 当前状态为 ${item.itemStatus}，不能加入寄送批次。`,
          409,
        );
      }
      if (item.shipmentLines.length > 0) {
        throw new ServiceError(
          "ITEM_IN_ACTIVE_BATCH",
          `库存 ${item.inventoryCode} 已在其他未结束寄送批次中。`,
          409,
        );
      }
    }

    const saleMode = purposeSaleMode[input.purpose] ?? "OTHER";
    const bNo = batchNo();

    const batch = await db.$transaction(async (tx) => {
      const b = await tx.platformShipmentBatch.create({
        data: {
          ownerId,
          batchNo: bNo,
          platform: input.platform as "DEWU" | "NINETY_FIVE" | "OTHER",
          purpose: input.purpose as "DEWU_LIGHTNING_INBOUND" | "DEWU_STANDARD_FULFILLMENT" | "NINETY_FIVE_INBOUND" | "OTHER",
          status: "SHIPPED",
          carrierCode: input.carrierCode?.trim() || null,
          trackingNo: input.trackingNo?.trim() || null,
          shippedAt: input.shippedAt ? new Date(input.shippedAt) : new Date(),
          note: input.note?.trim() || null,
        },
      });

      // Create a default group for unassigned items
      const groupMap = new Map<string, string>(); // itemId -> groupId
      const assignedItems = new Set<string>();

      if (input.groupAssignments?.length) {
        for (const ga of input.groupAssignments) {
          if (!ga.groupName && !ga.platformOrderNo) continue;
          const groupId = groupMap.get(ga.itemId);
          if (!groupId) {
            const g = await tx.platformShipmentGroup.create({
              data: {
                ownerId, batchId: b.id,
                platformOrderNo: ga.platformOrderNo?.trim() || null,
                groupName: ga.groupName?.trim() || null,
              },
            });
            // Assign all items with same groupName to this group
            for (const a of input.groupAssignments!) {
              if ((a.groupName === ga.groupName || a.platformOrderNo === ga.platformOrderNo) && !assignedItems.has(a.itemId)) {
                groupMap.set(a.itemId, g.id);
                assignedItems.add(a.itemId);
              }
            }
          }
        }
      }

      // Create default group for unassigned items
      const unassigned = items.filter((i) => !groupMap.has(i.id));
      if (unassigned.length > 0) {
        const defaultGroup = await tx.platformShipmentGroup.create({
          data: { ownerId, batchId: b.id, groupName: "默认组" },
        });
        for (const item of unassigned) {
          groupMap.set(item.id, defaultGroup.id);
        }
      }

      // Create lines
      for (const item of items) {
        const gId = groupMap.get(item.id) ?? null;
        await tx.platformShipmentLine.create({
          data: {
            ownerId, batchId: b.id, groupId: gId, inventoryItemId: item.id,
            lineStatus: "SHIPPED",
            inventoryCodeSnapshot: item.inventoryCode,
            productNameSnapshot: item.name,
            skuSnapshot: item.skuText,
            unitCostSnapshot: item.unitCost,
            saleModeSnapshot: item.saleMode,
            sourcePurchaseOrderId: item.purchaseOrderItemId,
          },
        });
        // Update inventory item
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { itemStatus: "PLATFORM_SHIPPED" as const, saleMode: saleMode as "DEWU_LIGHTNING" | "DEWU_STANDARD" | "NINETY_FIVE" | "OTHER" },
        });
      }

      return tx.platformShipmentBatch.findUniqueOrThrow({
        where: { id: b.id },
        include: { groups: true, lines: true },
      });
    });

    return batch;
  }

  async update(ownerId: string, id: string, input: { carrierCode?: string; trackingNo?: string; shippedAt?: string; note?: string }) {
    const batch = await db.platformShipmentBatch.findFirst({ where: { id, ownerId } });
    if (!batch) throw new ServiceError("BATCH_NOT_FOUND", "寄送批次不存在。", 404);
    return db.platformShipmentBatch.update({
      where: { id },
      data: {
        carrierCode: input.carrierCode?.trim() || undefined,
        trackingNo: input.trackingNo?.trim() || undefined,
        shippedAt: input.shippedAt ? new Date(input.shippedAt) : undefined,
        note: input.note?.trim() || undefined,
      },
    });
  }

  async markReceived(ownerId: string, id: string) {
    const batch = await this.get(ownerId, id);
    if (batch.status === "CANCELLED") throw new ServiceError("BATCH_CANCELLED", "已取消的批次不能签收。", 409);
    await db.$transaction(async (tx) => {
      await tx.platformShipmentBatch.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date() } });
      await tx.platformShipmentLine.updateMany({
        where: { batchId: id },
        data: { lineStatus: "RECEIVED" },
      });
      await tx.inventoryItem.updateMany({
        where: { shipmentLines: { some: { batchId: id } } },
        data: { itemStatus: "PLATFORM_RECEIVED" },
      });
    });
    return this.get(ownerId, id);
  }

  async cancel(ownerId: string, id: string) {
    const batch = await this.get(ownerId, id);
    if (!["DRAFT", "SHIPPED"].includes(batch.status)) {
      throw new ServiceError("BATCH_CANNOT_CANCEL", "只有未签收的批次才能取消。", 409);
    }
    await db.$transaction(async (tx) => {
      await tx.platformShipmentBatch.update({ where: { id }, data: { status: "CANCELLED" } });
      await tx.platformShipmentLine.updateMany({ where: { batchId: id }, data: { lineStatus: "RETURNED" } });
      // Restore inventory items to STOCKED
      const lineItemIds = (await tx.platformShipmentLine.findMany({ where: { batchId: id }, select: { inventoryItemId: true } })).map(l => l.inventoryItemId);
      await tx.inventoryItem.updateMany({
        where: { id: { in: lineItemIds } },
        data: { itemStatus: "STOCKED" },
      });
    });
    return this.get(ownerId, id);
  }

  // Line-level operations
  async updateLine(ownerId: string, lineId: string, input: { lineStatus: string; rejectedReason?: string; returnCarrierCode?: string; returnTrackingNo?: string; returnedStorageLocation?: string }) {
    const line = await db.platformShipmentLine.findFirst({
      where: { id: lineId, ownerId },
      include: { batch: true },
    });
    if (!line) throw new ServiceError("LINE_NOT_FOUND", "寄送明细不存在。", 404);

    const newStatus = input.lineStatus;
    const statusMap: Record<string, string> = {
      RECEIVED: "PLATFORM_RECEIVED",
      IN_WAREHOUSE: "PLATFORM_IN_WAREHOUSE",
      LISTED: "PLATFORM_LISTED",
      REJECTED: "PLATFORM_REJECTED",
      RETURNING: "RETURNING",
      RETURNED: "RETURNED",
    };
    const invStatus = statusMap[newStatus];

    await db.$transaction(async (tx) => {
      const lineData: Record<string, unknown> = { lineStatus: newStatus };
      if (input.rejectedReason) lineData.rejectedReason = input.rejectedReason.trim();
      if (input.returnCarrierCode) lineData.returnCarrierCode = input.returnCarrierCode.trim();
      if (input.returnTrackingNo) lineData.returnTrackingNo = input.returnTrackingNo.trim();
      if (input.returnedStorageLocation) lineData.returnedStorageLocation = input.returnedStorageLocation.trim();
      if (newStatus === "RETURNED") lineData.returnedAt = new Date();

      await tx.platformShipmentLine.update({ where: { id: lineId }, data: lineData });

      if (invStatus && line.inventoryItemId) {
        await tx.inventoryItem.update({ where: { id: line.inventoryItemId }, data: { itemStatus: invStatus as "PLATFORM_RECEIVED" | "PLATFORM_IN_WAREHOUSE" | "PLATFORM_LISTED" | "PLATFORM_REJECTED" | "RETURNING" | "RETURNED" } });
      }

      // Update batch status based on line statuses
      const allLines = await tx.platformShipmentLine.findMany({ where: { batchId: line.batchId }, select: { lineStatus: true } });
      const statuses = allLines.map(l => l.lineStatus);

      let batchStatus = "SHIPPED";
      if (statuses.every(s => s === "LISTED")) batchStatus = "LISTED";
      else if (statuses.some(s => s === "LISTED")) batchStatus = "PARTIALLY_LISTED";
      else if (statuses.every(s => s === "RECEIVED" || s === "IN_WAREHOUSE")) batchStatus = "RECEIVED";
      else if (statuses.some(s => s === "RECEIVED" || s === "IN_WAREHOUSE")) batchStatus = "PARTIALLY_RECEIVED";
      else if (statuses.some(s => s === "REJECTED")) batchStatus = "PARTIALLY_REJECTED";

      await tx.platformShipmentBatch.update({ where: { id: line.batchId }, data: { status: batchStatus as "SHIPPED" | "RECEIVED" | "PARTIALLY_RECEIVED" | "LISTED" | "PARTIALLY_LISTED" | "PARTIALLY_REJECTED" } });
    });

    return db.platformShipmentLine.findUniqueOrThrow({ where: { id: lineId }, include: { inventoryItem: true, batch: true } });
  }
}

export const shipmentService = new ShipmentService();
