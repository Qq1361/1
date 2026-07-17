import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { isLegacyInventoryItemStatus, LEGACY_INVENTORY_STATUS_MESSAGE } from "@/lib/inventory-item-status-contract";
import { ServiceError } from "@/server/errors";
import { platformReturnInspectionService } from "@/server/platform-return-inspection/platform-return-inspection-service";

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

function computeBatchStatus(statuses: string[]): string {
  if (statuses.every(s => s === "DRAFT")) return "DRAFT";
  if (statuses.every(s => s === "SHIPPED")) return "SHIPPED";
  if (statuses.every(s => s === "LISTED" || s === "SOLD" || s === "RETURNED" || s === "CANCELLED")) return "LISTED";
  if (statuses.some(s => s === "LISTED")) return "PARTIALLY_LISTED";
  if (statuses.every(s => s === "IN_WAREHOUSE" || s === "LISTED" || s === "SOLD")) return "IN_WAREHOUSE";
  if (statuses.some(s => s === "IN_WAREHOUSE")) return "PARTIALLY_IN_WAREHOUSE";
  if (statuses.every(s => s === "RECEIVED" || s === "IN_WAREHOUSE" || s === "LISTED" || s === "SOLD")) return "RECEIVED";
  if (statuses.some(s => s === "RECEIVED")) return "PARTIALLY_RECEIVED";
  if (statuses.some(s => s === "REJECTED")) return "PARTIALLY_REJECTED";
  // Terminal states
  const terminal = new Set(["LISTED", "RETURNED", "REJECTED", "SOLD", "CANCELLED"]);
  if (statuses.every(s => terminal.has(s))) return "COMPLETED";
  return "SHIPPED";
}

function assertNoLegacyShipmentInventory(item: { itemStatus: string; inventoryCode?: string } | null | undefined) {
  if (item && isLegacyInventoryItemStatus(item.itemStatus)) {
    throw new ServiceError("LEGACY_INVENTORY_STATUS", LEGACY_INVENTORY_STATUS_MESSAGE, 409);
  }
}

function assertOwnedShipmentInventory(item: { ownershipStatus: string; inventoryCode?: string } | null | undefined) {
  if (!item || item.ownershipStatus !== "OWNED") {
    throw new ServiceError("INVENTORY_NOT_OWNED", "非自有库存不能进入平台寄送流程。", 409);
  }
}

async function logAction(
  tx: Prisma.TransactionClient,
  ownerId: string,
  batchId: string,
  action: {
    actionType: string; lineId?: string; inventoryItemId?: string;
    oldStatus?: string; newStatus?: string; oldItemStatus?: string; newItemStatus?: string; note?: string;
  },
) {
  await tx.platformShipmentActionLog.create({
    data: {
      ownerId, batchId, lineId: action.lineId ?? null, inventoryItemId: action.inventoryItemId ?? null,
      actionType: action.actionType,
      oldStatus: action.oldStatus ?? null, newStatus: action.newStatus ?? null,
      oldItemStatus: action.oldItemStatus ?? null, newItemStatus: action.newItemStatus ?? null,
      note: action.note ?? null,
    },
  });
}

export class ShipmentService {
  async list(ownerId: string, query?: string, filters?: { platform?: string; status?: string }) {
    const where: Prisma.PlatformShipmentBatchWhereInput = { ownerId };
    if (query) {
      where.OR = [
        { batchNo: { contains: query, mode: "insensitive" } },
        { trackingNo: { contains: query, mode: "insensitive" } },
        { lines: { some: { inventoryCodeSnapshot: { contains: query, mode: "insensitive" } } } },
        { lines: { some: { productNameSnapshot: { contains: query, mode: "insensitive" } } } },
        { lines: { some: { skuSnapshot: { contains: query, mode: "insensitive" } } } },
        { groups: { some: { platformOrderNo: { contains: query, mode: "insensitive" } } } },
        { groups: { some: { platformTradeNo: { contains: query, mode: "insensitive" } } } },
        { lines: { some: { returnTrackingNo: { contains: query, mode: "insensitive" } } } },
      ];
    }
    if (filters?.platform) where.platform = filters.platform as "DEWU" | "NINETY_FIVE" | "OTHER";
    if (filters?.status) where.status = filters.status as "DRAFT" | "SHIPPED" | "RECEIVED";

    const [data, total] = await Promise.all([
      db.platformShipmentBatch.findMany({
        where, orderBy: { createdAt: "desc" },
        include: { _count: { select: { lines: true, groups: true } } },
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
            inventoryItem: { select: { id: true, inventoryCode: true, name: true, skuText: true, unitCost: true, expiryDate: true, itemStatus: true, saleMode: true, storageLocation: true, purchaseOrderItem: { select: { purchaseOrder: { select: { id: true, orderNo: true } } } } } },
            group: true,
            returnInspection: { select: { result: true, storageLocation: true, problemReason: true, note: true, inspectedAt: true } },
          },
        },
        attachments: { orderBy: { createdAt: "desc" } },
        actionLogs: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!batch) throw new ServiceError("BATCH_NOT_FOUND", "寄送批次不存在。", 404);
    return batch;
  }

  async createDraft(
    ownerId: string,
    input: {
      platform: string; defaultPurpose: string;
      carrierCode?: string; trackingNo?: string; shippedAt?: string;
      outboundShippingCost?: string; packagingCost?: string; otherShipmentCost?: string;
      note?: string; itemIds: string[];
      groupAssignments?: { itemId: string; groupName?: string; platformOrderNo?: string; platformTradeNo?: string }[];
    },
  ) {
    // Validate items: must be STOCKED and not in another active batch
    const activeStatuses = ["DRAFT", "SHIPPED", "RECEIVED", "IN_WAREHOUSE", "LISTED"] as const;
    const items = await db.inventoryItem.findMany({
      where: { id: { in: input.itemIds }, ownerId },
      include: { shipmentLines: { where: { lineStatus: { in: [...activeStatuses] as ("DRAFT" | "SHIPPED" | "RECEIVED" | "IN_WAREHOUSE" | "LISTED")[] } }, select: { id: true, batchId: true } } },
    });
    if (items.length !== input.itemIds.length) throw new ServiceError("ITEMS_NOT_FOUND", "部分库存不存在。", 404);
    for (const item of items) {
      assertOwnedShipmentInventory(item);
      if (isLegacyInventoryItemStatus(item.itemStatus)) {
        throw new ServiceError("LEGACY_INVENTORY_STATUS", LEGACY_INVENTORY_STATUS_MESSAGE, 409);
      }
      if (item.itemStatus !== "STOCKED")
        throw new ServiceError("ITEM_NOT_AVAILABLE", `库存 ${item.inventoryCode} 状态为 ${item.itemStatus}，不能加入寄送批次。`, 409);
      if (item.shipmentLines.length > 0)
        throw new ServiceError("ITEM_IN_ACTIVE_BATCH", `库存 ${item.inventoryCode} 已在其他未结束寄送批次中。`, 409);
    }

    const bNo = batchNo();
    const batch = await db.$transaction(async (tx) => {
      const b = await tx.platformShipmentBatch.create({
        data: {
          ownerId, batchNo: bNo,
          platform: input.platform as "DEWU" | "NINETY_FIVE" | "OTHER",
          defaultPurpose: input.defaultPurpose as "DEWU_LIGHTNING_INBOUND" | "DEWU_STANDARD_FULFILLMENT" | "NINETY_FIVE_INBOUND" | "OTHER",
          status: "DRAFT",
          carrierCode: input.carrierCode?.trim() || null,
          trackingNo: input.trackingNo?.trim() || null,
          outboundShippingCost: input.outboundShippingCost ? new Prisma.Decimal(input.outboundShippingCost) : null,
          packagingCost: input.packagingCost ? new Prisma.Decimal(input.packagingCost) : null,
          otherShipmentCost: input.otherShipmentCost ? new Prisma.Decimal(input.otherShipmentCost) : null,
          note: input.note?.trim() || null,
        },
      });

      // Create groups and assign items
      const groupMap = new Map<string, string>(); // itemId -> groupId
      const assignedItems = new Set<string>();
      if (input.groupAssignments?.length) {
        for (const ga of input.groupAssignments) {
          if (assignedItems.has(ga.itemId)) continue;
          if (!ga.groupName && !ga.platformOrderNo) continue;
          // Find or create group
          let g = (await tx.platformShipmentGroup.findFirst({ where: { batchId: b.id, ownerId, groupName: ga.groupName?.trim() || null, platformOrderNo: ga.platformOrderNo?.trim() || null } }));
          if (!g) {
            g = await tx.platformShipmentGroup.create({ data: { ownerId, batchId: b.id, groupName: ga.groupName?.trim() || null, platformOrderNo: ga.platformOrderNo?.trim() || null, platformTradeNo: ga.platformTradeNo?.trim() || null } });
          }
          for (const a of input.groupAssignments!) {
            if ((a.groupName === ga.groupName && a.platformOrderNo === ga.platformOrderNo) && !assignedItems.has(a.itemId)) {
              groupMap.set(a.itemId, g.id);
              assignedItems.add(a.itemId);
            }
          }
        }
      }

      // Default group for unassigned items
      const unassigned = items.filter(i => !groupMap.has(i.id));
      if (unassigned.length > 0) {
        const dg = await tx.platformShipmentGroup.create({ data: { ownerId, batchId: b.id, groupName: "默认组" } });
        for (const item of unassigned) groupMap.set(item.id, dg.id);
      }

      // Create lines — DRAFT, items remain STOCKED
      for (const item of items) {
        await tx.platformShipmentLine.create({
          data: {
            ownerId, batchId: b.id, groupId: groupMap.get(item.id) ?? null, inventoryItemId: item.id,
            lineStatus: "DRAFT",
            inventoryCodeSnapshot: item.inventoryCode, productNameSnapshot: item.name,
            skuSnapshot: item.skuText, unitCostSnapshot: item.unitCost,
            oldSaleModeSnapshot: item.saleMode, sourcePurchaseOrderId: item.purchaseOrderItemId,
          },
        });
      }
      await logAction(tx, ownerId, b.id, { actionType: "CREATED_DRAFT", note: `创建草稿批次，${items.length} 件库存` });
      return tx.platformShipmentBatch.findUniqueOrThrow({ where: { id: b.id }, include: { groups: true, lines: true } });
    });
    return batch;
  }

  async confirmShipped(ownerId: string, id: string) {
    const batch = await db.platformShipmentBatch.findFirst({
      where: { id, ownerId }, include: { lines: { include: { inventoryItem: true, group: true } } },
    });
    if (!batch) throw new ServiceError("BATCH_NOT_FOUND", "寄送批次不存在。", 404);
    if (batch.status !== "DRAFT") throw new ServiceError("BATCH_NOT_DRAFT", "只有草稿批次才能确认发货。", 409);
    if (!batch.carrierCode || !batch.trackingNo) throw new ServiceError("LOGISTICS_REQUIRED", "请先填写快递公司和快递单号。", 422);
    const uncheckedLines = batch.lines.filter(l => !l.packedChecked);
    if (uncheckedLines.length > 0) {
      throw new ServiceError("PACKING_NOT_CHECKED", `还有 ${uncheckedLines.length} 件库存未核对装箱。`, 422);
    }
    batch.lines.forEach((line) => {
      assertNoLegacyShipmentInventory(line.inventoryItem);
      assertOwnedShipmentInventory(line.inventoryItem);
    });

    await db.$transaction(async (tx) => {
      const now = new Date();
      for (const line of batch.lines) {
        const purpose = line.group?.purpose ?? batch.defaultPurpose;
        const saleMode = purposeSaleMode[purpose] ?? "OTHER";
        await tx.platformShipmentLine.update({ where: { id: line.id }, data: { lineStatus: "SHIPPED", newSaleModeSnapshot: saleMode } });
        await tx.inventoryItem.update({ where: { id: line.inventoryItemId }, data: { itemStatus: "PLATFORM_SHIPPED", saleMode: saleMode as "DEWU_LIGHTNING" | "DEWU_STANDARD" | "NINETY_FIVE" | "OTHER" } });
        await logAction(tx, ownerId, id, { actionType: "CONFIRMED_SHIPPED", lineId: line.id, inventoryItemId: line.inventoryItemId, oldItemStatus: "STOCKED", newItemStatus: "PLATFORM_SHIPPED" });
      }
      const shippedAtVal = batch.shippedAt ?? now;
      await tx.platformShipmentBatch.update({ where: { id }, data: { status: "SHIPPED", shippedAt: shippedAtVal, updatedAt: now } });
    });
    return this.get(ownerId, id);
  }

  async update(ownerId: string, id: string, input: { carrierCode?: string; trackingNo?: string; shippedAt?: string; outboundShippingCost?: string; packagingCost?: string; otherShipmentCost?: string; note?: string }) {
    const batch = await db.platformShipmentBatch.findFirst({ where: { id, ownerId } });
    if (!batch) throw new ServiceError("BATCH_NOT_FOUND", "寄送批次不存在。", 404);
    return db.platformShipmentBatch.update({
      where: { id },
      data: {
        carrierCode: input.carrierCode?.trim() || undefined,
        trackingNo: input.trackingNo?.trim() || undefined,
        shippedAt: input.shippedAt ? new Date(input.shippedAt) : undefined,
        outboundShippingCost: input.outboundShippingCost !== undefined ? (input.outboundShippingCost ? new Prisma.Decimal(input.outboundShippingCost) : null) : undefined,
        packagingCost: input.packagingCost !== undefined ? (input.packagingCost ? new Prisma.Decimal(input.packagingCost) : null) : undefined,
        otherShipmentCost: input.otherShipmentCost !== undefined ? (input.otherShipmentCost ? new Prisma.Decimal(input.otherShipmentCost) : null) : undefined,
        note: input.note?.trim() || undefined,
      },
    });
  }

  async markReceived(ownerId: string, id: string) {
    const batch = await this.get(ownerId, id);
    if (batch.status === "CANCELLED") throw new ServiceError("BATCH_CANCELLED", "已取消的批次不能签收。", 409);
    batch.lines.forEach((line) => assertNoLegacyShipmentInventory(line.inventoryItem));
    await db.$transaction(async (tx) => {
      await tx.platformShipmentBatch.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date() } });
      for (const line of batch.lines) {
        if (line.lineStatus === "SHIPPED") {
          await tx.platformShipmentLine.update({ where: { id: line.id }, data: { lineStatus: "RECEIVED" } });
          if (line.inventoryItemId) {
            const inv = await tx.inventoryItem.findUnique({ where: { id: line.inventoryItemId }, select: { itemStatus: true } });
            if (inv && !["PLATFORM_RECEIVED", "PLATFORM_IN_WAREHOUSE", "PLATFORM_LISTED", "PLATFORM_REJECTED", "RETURNING", "RETURNED", "SOLD"].includes(inv.itemStatus)) {
              await tx.inventoryItem.update({ where: { id: line.inventoryItemId }, data: { itemStatus: "PLATFORM_RECEIVED" } });
            }
          }
          await logAction(tx, ownerId, id, { actionType: "MARKED_RECEIVED", lineId: line.id, inventoryItemId: line.inventoryItemId, oldItemStatus: "PLATFORM_SHIPPED", newItemStatus: "PLATFORM_RECEIVED" });
        }
      }
    });
    return this.get(ownerId, id);
  }

  async cancel(ownerId: string, id: string) {
    const batch = await this.get(ownerId, id);
    if (!["DRAFT", "SHIPPED"].includes(batch.status)) throw new ServiceError("BATCH_CANNOT_CANCEL", "只有未签收的批次才能取消。", 409);
    batch.lines.forEach((line) => assertNoLegacyShipmentInventory(line.inventoryItem));
    await db.$transaction(async (tx) => {
      await tx.platformShipmentBatch.update({ where: { id }, data: { status: "CANCELLED" } });
      for (const line of batch.lines) {
        const oldItemStatus = line.inventoryItem?.itemStatus ?? "STOCKED";
        await tx.platformShipmentLine.update({ where: { id: line.id }, data: { lineStatus: "CANCELLED" } });
        // Restore to STOCKED or release draft hold
        if (line.inventoryItemId) {
          const isPlatformShipped = ["PLATFORM_SHIPPED", "PLATFORM_RECEIVED"].includes(oldItemStatus);
          if (isPlatformShipped || line.lineStatus === "DRAFT") {
            const oldSaleMode = line.oldSaleModeSnapshot ?? line.inventoryItem?.saleMode ?? "NONE";
            await tx.inventoryItem.update({ where: { id: line.inventoryItemId }, data: { itemStatus: "STOCKED", saleMode: oldSaleMode as "NONE" | "DEWU_LIGHTNING" | "DEWU_STANDARD" | "NINETY_FIVE" | "XIANYU" | "OTHER" } });
          }
        }
        await logAction(tx, ownerId, id, { actionType: "BATCH_CANCELLED", lineId: line.id, inventoryItemId: line.inventoryItemId, oldItemStatus, newItemStatus: "STOCKED" });
      }
    });
    return this.get(ownerId, id);
  }

  async updateLine(ownerId: string, lineId: string, input: { lineStatus?: string; packedChecked?: boolean; rejectedReason?: string; returnCarrierCode?: string; returnTrackingNo?: string; returnedStorageLocation?: string; note?: string }) {
    const line = await db.platformShipmentLine.findFirst({ where: { id: lineId, ownerId }, include: { batch: true, inventoryItem: true } });
    if (!line) throw new ServiceError("LINE_NOT_FOUND", "寄送明细不存在。", 404);
    assertNoLegacyShipmentInventory(line.inventoryItem);

    const itemStatusMap: Record<string, string> = {
      RECEIVED: "PLATFORM_RECEIVED", IN_WAREHOUSE: "PLATFORM_IN_WAREHOUSE",
      LISTED: "PLATFORM_LISTED", REJECTED: "PLATFORM_REJECTED",
      RETURNING: "RETURNING", RETURNED: "RETURNED",
    };

    await db.$transaction(async (tx) => {
      const lineData: Record<string, unknown> = {};
      if (input.lineStatus) lineData.lineStatus = input.lineStatus;
      if (input.packedChecked !== undefined) {
        lineData.packedChecked = input.packedChecked;
        if (input.packedChecked) lineData.packedCheckedAt = new Date();
        else lineData.packedCheckedAt = null;
      }
      if (input.rejectedReason) lineData.rejectedReason = input.rejectedReason.trim();
      if (input.returnCarrierCode) lineData.returnCarrierCode = input.returnCarrierCode.trim();
      if (input.returnTrackingNo) lineData.returnTrackingNo = input.returnTrackingNo.trim();
      if (input.returnedStorageLocation !== undefined) lineData.returnedStorageLocation = input.returnedStorageLocation.trim();
      if (input.note) lineData.note = input.note.trim();
      if (input.lineStatus === "RETURNED") lineData.returnedAt = new Date();

      const oldStatus = line.lineStatus;
      await tx.platformShipmentLine.update({ where: { id: lineId }, data: lineData });

      // Update inventory item status
      if (input.lineStatus && itemStatusMap[input.lineStatus] && line.inventoryItemId) {
        const newInvStatus = itemStatusMap[input.lineStatus];
        await tx.inventoryItem.update({ where: { id: line.inventoryItemId }, data: { itemStatus: newInvStatus as "PLATFORM_RECEIVED" | "PLATFORM_IN_WAREHOUSE" | "PLATFORM_LISTED" | "PLATFORM_REJECTED" | "RETURNING" | "RETURNED" } });
        if (input.lineStatus === "RETURNED" && input.returnedStorageLocation) {
          await tx.inventoryItem.update({ where: { id: line.inventoryItemId }, data: { storageLocation: input.returnedStorageLocation.trim() } });
        }
      }

      // Recompute batch status
      const allLines = await tx.platformShipmentLine.findMany({ where: { batchId: line.batchId }, select: { lineStatus: true } });
      const batchStatus = computeBatchStatus(allLines.map(l => l.lineStatus));
      await tx.platformShipmentBatch.update({ where: { id: line.batchId }, data: { status: batchStatus as "DRAFT" | "SHIPPED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "PARTIALLY_IN_WAREHOUSE" | "IN_WAREHOUSE" | "PARTIALLY_LISTED" | "LISTED" | "COMPLETED" | "CANCELLED" } });

      await logAction(tx, ownerId, line.batchId, {
        actionType: input.lineStatus ? `LINE_${input.lineStatus}` : "LINE_UPDATED",
        lineId, inventoryItemId: line.inventoryItemId ?? undefined,
        oldStatus, newStatus: input.lineStatus, note: input.note,
      });
    });

    return db.platformShipmentLine.findUniqueOrThrow({ where: { id: lineId }, include: { inventoryItem: true, batch: true } });
  }

  async confirmRestocked(
    ownerId: string,
    lineId: string,
    input: { storageLocation?: string; note?: string } = {},
  ) {
    const result = await platformReturnInspectionService.inspectReturn({
      ownerId,
      shipmentLineId: lineId,
      result: "RESTOCKED",
      storageLocation: input.storageLocation,
      note: input.note,
    });
    return result.line;
  }

  async removeLineFromDraft(ownerId: string, lineId: string) {
    const line = await db.platformShipmentLine.findFirst({ where: { id: lineId, ownerId }, include: { batch: true } });
    if (!line) throw new ServiceError("LINE_NOT_FOUND", "寄送明细不存在。", 404);
    if (line.lineStatus !== "DRAFT" || line.batch.status !== "DRAFT") throw new ServiceError("ONLY_DRAFT", "只能从草稿批次移除库存。", 409);

    await db.$transaction(async (tx) => {
      await tx.platformShipmentLine.delete({ where: { id: lineId } });
      await logAction(tx, ownerId, line.batchId, { actionType: "LINE_REMOVED", lineId, inventoryItemId: line.inventoryItemId, note: "从草稿批次移除" });
      const remaining = await tx.platformShipmentLine.findMany({ where: { batchId: line.batchId }, select: { lineStatus: true } });
      if (remaining.length === 0) {
        await tx.platformShipmentBatch.update({ where: { id: line.batchId }, data: { status: "CANCELLED" } });
        await logAction(tx, ownerId, line.batchId, { actionType: "BATCH_AUTO_CANCELLED", note: "所有库存已移除，批次自动取消" });
      }
    });
    return { ok: true };
  }

  async selectableItems(ownerId: string, query?: string, page = 1, pageSize = 20) {
    const activeLineStatuses = ["DRAFT", "SHIPPED", "RECEIVED", "IN_WAREHOUSE", "LISTED"] as const;
    const where: Prisma.InventoryItemWhereInput = {
      ownerId,
      itemStatus: "STOCKED",
      ownershipStatus: "OWNED",
      // Exclude items with active shipment lines
      shipmentLines: { none: { lineStatus: { in: [...activeLineStatuses] as ("DRAFT" | "SHIPPED" | "RECEIVED" | "IN_WAREHOUSE" | "LISTED")[] } } },
      ...(query ? {
        OR: [
          { inventoryCode: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { skuText: { contains: query, mode: "insensitive" } },
          { storageLocation: { contains: query, mode: "insensitive" } },
          { purchaseOrderItem: { purchaseOrder: { orderNo: { contains: query, mode: "insensitive" } } } },
          { purchaseOrderItem: { purchaseOrder: { sellerNickname: { contains: query, mode: "insensitive" } } } },
          { purchaseOrderItem: { name: { contains: query, mode: "insensitive" } } },
        ],
      } : {}),
    };
    const [data, total] = await Promise.all([
      db.inventoryItem.findMany({
        where,
        select: {
          id: true, inventoryCode: true, name: true, skuText: true,
          storageLocation: true, saleMode: true, itemStatus: true,
          expiryDate: true, unitCost: true,
          purchaseOrderItem: { select: { purchaseOrder: { select: { orderNo: true, sellerNickname: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.inventoryItem.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
}

export const shipmentService = new ShipmentService();
