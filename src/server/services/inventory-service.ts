import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { getReminderType } from "@/server/services/todo-service";
import { normalizeSku } from "@/lib/normalize-sku";
import {
  isLegacyInventoryItemStatus,
  isSupportedInventoryItemStatus,
  LEGACY_INVENTORY_STATUS_MESSAGE,
} from "@/lib/inventory-item-status-contract";

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2).toFixed(2);
}

const locationInclude = {
  warehouse: { select: { name: true } },
  warehouseLocation: { select: { name: true } },
} satisfies Prisma.InventoryItemInclude;

function withDisplayStorageLocation<T extends {
  storageLocation: string | null;
  warehouse?: { name: string } | null;
  warehouseLocation?: { name: string } | null;
}>(item: T) {
  const structuredLocation = item.warehouse && item.warehouseLocation
    ? `${item.warehouse.name} / ${item.warehouseLocation.name}`
    : item.warehouse?.name ?? item.warehouseLocation?.name;
  return { ...item, displayStorageLocation: structuredLocation ?? item.storageLocation ?? "未设置" };
}

export class InventoryService {
  async list(
    ownerId: string,
    query: {
      query?: string;
      itemStatus?: Prisma.EnumItemStatusFilter["equals"];
      saleMode?: Prisma.EnumSaleModeFilter["equals"];
      locationStatus?: Prisma.EnumLocationStatusFilter["equals"];
      reminder?: string;
      productNameExact?: string;
      skuExact?: string;
      skuEmpty?: boolean;
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
      ...(query.productNameExact ? { name: query.productNameExact } : {}),
      ...(query.query
        ? {
            OR: [
              { name: { contains: query.query, mode: "insensitive" } },
              { skuText: { contains: query.query, mode: "insensitive" } },
              { inventoryCode: { contains: query.query, mode: "insensitive" } },
              { storageLocation: { contains: query.query, mode: "insensitive" } },
              { warehouse: { name: { contains: query.query, mode: "insensitive" } } },
              { warehouseLocation: { name: { contains: query.query, mode: "insensitive" } } },
              { purchaseOrderItem: { purchaseOrder: { orderNo: { contains: query.query, mode: "insensitive" } } } },
              { purchaseOrderItem: { purchaseOrder: { sellerNickname: { contains: query.query, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };
    const hasExactSkuFilter = Boolean(query.skuExact) || query.skuEmpty === true;
    if (hasExactSkuFilter && !query.reminder) {
      const requestedSku = normalizeSku(query.skuExact);
      const exactItems = await db.inventoryItem.findMany({
        where,
        orderBy: { stockedAt: "desc" },
        include: locationInclude,
      });
      const data = exactItems.filter((item) =>
        query.skuEmpty ? normalizeSku(item.skuText) === null : normalizeSku(item.skuText) === requestedSku,
      );
      const total = data.length;
      const start = (query.page - 1) * query.pageSize;
      return {
        data: data.slice(start, start + query.pageSize).map(withDisplayStorageLocation),
        total,
        page: query.page,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      };
    }
    // Reminder filter: fetch all, then filter in-memory using the shared getReminderType
    // to ensure exact consistency with /api/todos counts
    if (query.reminder) {
      // Use a broader DB filter first to limit data, then refine in code
      if (query.reminder === "STOCKED_OVER_3_DAYS") {
        where.itemStatus = "STOCKED";
        where.ownershipStatus = "OWNED";
        where.stockedAt = { lte: new Date(now.getTime() - 72 * 60 * 60 * 1000) };
      } else {
        // For expiry reminders, fetch STOCKED items with any expiry
        where.itemStatus = "STOCKED";
        where.ownershipStatus = "OWNED";
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
        include: locationInclude,
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
          ownershipStatus: item.ownershipStatus,
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
      const data = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map(withDisplayStorageLocation);
      return { data, total, page: query.page, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
    }

    const [data, total] = await db.$transaction([
      db.inventoryItem.findMany({
        where,
        orderBy: { stockedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: locationInclude,
      }),
      db.inventoryItem.count({ where }),
    ]);
    return { data: data.map(withDisplayStorageLocation), total, page: query.page, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  async skuSummary(
    ownerId: string,
    query: {
      query?: string;
      filter?: "ALL" | "LOCAL_AVAILABLE" | "PLATFORM" | "SOLD" | "UNAVAILABLE";
    },
  ) {
    const items = await db.inventoryItem.findMany({
      where: {
        ownerId,
        ...(query.query
          ? {
              OR: [
                { name: { contains: query.query, mode: "insensitive" } },
                { skuText: { contains: query.query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        name: true,
        skuText: true,
        itemStatus: true,
        ownershipStatus: true,
        unitCost: true,
      },
      orderBy: [{ name: "asc" }, { skuText: "asc" }],
    });

    const buckets = new Map<string, {
      productName: string; skuText: string | null;
      unsoldCount: number; immediatelySellableCount: number; localStockedCount: number;
      platformListedCount: number; platformTransitCount: number; platformWarehouseCount: number;
      exceptionCount: number; soldCount: number; historicalTotalCount: number;
      returningToUpstreamSellerCount: number; returnedToUpstreamSellerCount: number;
      unsoldCostTotal: Prisma.Decimal; minUnsoldCost: Prisma.Decimal | null; maxUnsoldCost: Prisma.Decimal | null;
    }>();

    for (const item of items) {
      const itemStatus = item.itemStatus as string;
      const skuText = normalizeSku(item.skuText);
      const key = `${item.name}\u0000${skuText ?? ""}`;
      const bucket = buckets.get(key) ?? {
        productName: item.name,
        skuText,
        unsoldCount: 0,
        immediatelySellableCount: 0,
        localStockedCount: 0,
        platformListedCount: 0,
        platformTransitCount: 0,
        platformWarehouseCount: 0,
        exceptionCount: 0,
        soldCount: 0,
        historicalTotalCount: 0,
        returningToUpstreamSellerCount: 0,
        returnedToUpstreamSellerCount: 0,
        unsoldCostTotal: new Prisma.Decimal(0),
        minUnsoldCost: null,
        maxUnsoldCost: null,
      };

      bucket.historicalTotalCount += 1;
      if (item.ownershipStatus === "RETURNING_TO_UPSTREAM_SELLER") bucket.returningToUpstreamSellerCount += 1;
      if (item.ownershipStatus === "RETURNED_TO_UPSTREAM_SELLER") bucket.returnedToUpstreamSellerCount += 1;
      if (item.ownershipStatus !== "OWNED") { buckets.set(key, bucket); continue; }
      if (isLegacyInventoryItemStatus(itemStatus)) {
        buckets.set(key, bucket);
        continue;
      }
      if (itemStatus === "STOCKED") {
        bucket.localStockedCount += 1;
        bucket.immediatelySellableCount += 1;
      } else if (itemStatus === "PLATFORM_LISTED") {
        bucket.platformListedCount += 1;
        bucket.immediatelySellableCount += 1;
      } else if (["PLATFORM_SHIPPED", "PLATFORM_RECEIVED"].includes(itemStatus)) {
        bucket.platformTransitCount += 1;
      } else if (itemStatus === "PLATFORM_IN_WAREHOUSE") {
        bucket.platformWarehouseCount += 1;
      } else if (["PLATFORM_REJECTED", "RETURNING", "RETURNED", "PROBLEM"].includes(itemStatus)) {
        bucket.exceptionCount += 1;
      } else if (itemStatus === "SOLD") {
        bucket.soldCount += 1;
      }
      if (isSupportedInventoryItemStatus(itemStatus) && itemStatus !== "SOLD") {
        bucket.unsoldCount += 1;
        bucket.unsoldCostTotal = bucket.unsoldCostTotal.plus(item.unitCost);
        bucket.minUnsoldCost = bucket.minUnsoldCost == null || item.unitCost.lessThan(bucket.minUnsoldCost)
          ? item.unitCost : bucket.minUnsoldCost;
        bucket.maxUnsoldCost = bucket.maxUnsoldCost == null || item.unitCost.greaterThan(bucket.maxUnsoldCost)
          ? item.unitCost : bucket.maxUnsoldCost;
      }
      buckets.set(key, bucket);
    }

    const filter = query.filter ?? "ALL";
    const filtered = [...buckets.values()].filter((bucket) => {
      if (filter === "LOCAL_AVAILABLE") return bucket.localStockedCount > 0;
      if (filter === "PLATFORM") return bucket.platformListedCount + bucket.platformTransitCount + bucket.platformWarehouseCount > 0;
      if (filter === "SOLD") return bucket.soldCount > 0;
      if (filter === "UNAVAILABLE") return bucket.exceptionCount > 0;
      return true;
    });

    const data = filtered.map((bucket) => ({
      productName: bucket.productName,
      skuText: bucket.skuText,
      sku: bucket.skuText,
      unsoldCount: bucket.unsoldCount,
      immediatelySellableCount: bucket.immediatelySellableCount,
      localStockedCount: bucket.localStockedCount,
      platformListedCount: bucket.platformListedCount,
      platformTransitCount: bucket.platformTransitCount,
      platformWarehouseCount: bucket.platformWarehouseCount,
      exceptionCount: bucket.exceptionCount,
      soldCount: bucket.soldCount,
      historicalTotalCount: bucket.historicalTotalCount,
      returningToUpstreamSellerCount: bucket.returningToUpstreamSellerCount,
      returnedToUpstreamSellerCount: bucket.returnedToUpstreamSellerCount,
      averageUnsoldCost: bucket.unsoldCount ? money(bucket.unsoldCostTotal.div(bucket.unsoldCount)) : null,
      minUnsoldCost: bucket.minUnsoldCost ? money(bucket.minUnsoldCost) : null,
      maxUnsoldCost: bucket.maxUnsoldCost ? money(bucket.maxUnsoldCost) : null,
      unsoldCostTotal: money(bucket.unsoldCostTotal),
      // Backward-compatible aliases for existing callers.
      localAvailableCount: bucket.localStockedCount,
      platformCount: bucket.platformListedCount + bucket.platformTransitCount + bucket.platformWarehouseCount,
      unavailableCount: bucket.exceptionCount,
      totalCount: bucket.historicalTotalCount,
      averageCost: bucket.unsoldCount ? money(bucket.unsoldCostTotal.div(bucket.unsoldCount)) : null,
      minCost: bucket.minUnsoldCost ? money(bucket.minUnsoldCost) : null,
      maxCost: bucket.maxUnsoldCost ? money(bucket.maxUnsoldCost) : null,
      totalCost: money(bucket.unsoldCostTotal),
    }));

    return { items: data, total: data.length };
  }

  async update(
    ownerId: string,
    id: string,
    data: { saleMode?: string; storageLocation?: string | null },
  ) {
    const item = await db.inventoryItem.findFirst({
      where: { id, ownerId },
    });
    if (!item)
      throw new ServiceError("INVENTORY_NOT_FOUND", "库存商品不存在。", 404);
    if (item.itemStatus === "SOLD") {
      throw new ServiceError(
        "ITEM_FINALIZED",
        "该库存已售出或已移除，不允许修改。",
        409,
      );
    }
    if (isLegacyInventoryItemStatus(item.itemStatus)) {
      throw new ServiceError("LEGACY_INVENTORY_STATUS", LEGACY_INVENTORY_STATUS_MESSAGE, 409);
    }
    const updateData: Record<string, unknown> = {};
    if (data.saleMode !== undefined) updateData.saleMode = data.saleMode as Prisma.EnumSaleModeFieldUpdateOperationsInput["set"];
    if (data.storageLocation !== undefined) updateData.storageLocation = data.storageLocation?.trim() || null;
    return db.inventoryItem.update({ where: { id }, data: updateData });
  }

  async updateSkuOnly(ownerId: string, id: string, skuText: string | null | undefined) {
    return db.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({ where: { id, ownerId } });
      if (!item) throw new ServiceError("INVENTORY_NOT_FOUND", "库存商品不存在。", 404);
      if (isLegacyInventoryItemStatus(item.itemStatus)) {
        throw new ServiceError("LEGACY_INVENTORY_STATUS", LEGACY_INVENTORY_STATUS_MESSAGE, 409);
      }
      const nextSku = normalizeSku(skuText);
      const updated = await tx.inventoryItem.update({ where: { id }, data: { skuText: nextSku } });
      await tx.inventoryActionLog.create({
        data: {
          ownerId,
          inventoryItemId: id,
          actionType: "UPDATED_SKU",
          note: `来源：库存详情；旧 SKU：${normalizeSku(item.skuText) ?? "未填写"}；新 SKU：${nextSku ?? "未填写"}`,
          oldSaleMode: item.saleMode,
          newSaleMode: item.saleMode,
          oldItemStatus: item.itemStatus,
          newItemStatus: item.itemStatus,
          oldStorageLocation: item.storageLocation,
          newStorageLocation: item.storageLocation,
          oldExpiryDate: item.expiryDate,
          newExpiryDate: item.expiryDate,
        },
      });
      return updated;
    });
  }

  async bulkUpdateSku(
    ownerId: string,
    input: {
      inventoryItemIds: string[];
      skuText?: string | null | undefined;
      overwriteExisting?: boolean;
      allowMixedProducts?: boolean;
      includeHistorical?: boolean;
    },
  ) {
    const ids = [...new Set(input.inventoryItemIds)];
    if (!ids.length || ids.length > 500) {
      throw new ServiceError("INVALID_INVENTORY_SELECTION", "请选择 1 至 500 件库存。", 422);
    }
    const nextSku = normalizeSku(input.skuText);
    return db.$transaction(async (tx) => {
      const items = await tx.inventoryItem.findMany({ where: { id: { in: ids }, ownerId } });
      if (items.length !== ids.length) {
        throw new ServiceError("INVENTORY_NOT_FOUND", "部分库存不存在或无权访问。", 404);
      }
      const productNames = new Set(items.map((item) => item.name));
      if (productNames.size > 1 && !input.allowMixedProducts) {
        throw new ServiceError("MIXED_PRODUCTS", "已选择多个不同商品，请明确确认后再批量设置 SKU。", 409);
      }
      const skipped: { inventoryItemId: string; reason: string }[] = [];
      const updates = items.filter((item) => {
        if (isLegacyInventoryItemStatus(item.itemStatus)) {
          skipped.push({ inventoryItemId: item.id, reason: "LEGACY_STATUS_EXCLUDED" });
          return false;
        }
        if (item.itemStatus === "SOLD" && !input.includeHistorical) {
          skipped.push({ inventoryItemId: item.id, reason: "HISTORICAL_ITEM_EXCLUDED" });
          return false;
        }
        if (normalizeSku(item.skuText) !== null && !input.overwriteExisting) {
          skipped.push({ inventoryItemId: item.id, reason: "SKU_ALREADY_EXISTS" });
          return false;
        }
        return true;
      });
      for (const item of updates) {
        await tx.inventoryItem.update({ where: { id: item.id }, data: { skuText: nextSku } });
      }
      if (updates.length) {
        await tx.inventoryActionLog.createMany({
          data: updates.map((item) => ({
            ownerId,
            inventoryItemId: item.id,
            actionType: "BULK_UPDATED_SKU",
            note: `来源：库存批量补录；旧 SKU：${normalizeSku(item.skuText) ?? "未填写"}；新 SKU：${nextSku ?? "未填写"}`,
            oldSaleMode: item.saleMode,
            newSaleMode: item.saleMode,
            oldItemStatus: item.itemStatus,
            newItemStatus: item.itemStatus,
            oldStorageLocation: item.storageLocation,
            newStorageLocation: item.storageLocation,
            oldExpiryDate: item.expiryDate,
            newExpiryDate: item.expiryDate,
          })),
        });
      }
      return { updatedCount: updates.length, skippedCount: skipped.length, skipped };
    });
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
            returnInspection: {
              select: {
                result: true,
                storageLocation: true,
                problemReason: true,
                note: true,
                inspectedAt: true,
                updatedAt: true,
              },
            },
          },
        },
        saleLines: {
          orderBy: { createdAt: "desc" },
          include: {
            saleOrder: {
              include: {
                feeLines: true,
              },
            },
          },
        },
        purchaseAfterSaleLines: {
          orderBy: { createdAt: "desc" },
          include: {
            afterSaleCase: {
              select: {
                id: true,
                caseNo: true,
                type: true,
                status: true,
                purchaseOrderId: true,
              },
            },
            refundAllocations: { select: { amount: true } },
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
    const { purchaseAfterSaleLines, ...inventory } = item;
    return {
      ...inventory,
      attachments,
      purchaseAfterSales: purchaseAfterSaleLines.map((line) => {
        const allocatedRefundAmount = line.refundAllocations.reduce(
          (total, allocation) => total.plus(allocation.amount),
          new Prisma.Decimal(0),
        );
        return {
          id: line.id,
          afterSaleCase: line.afterSaleCase,
          requestedRefundAmount: money(line.requestedRefundAmount),
          approvedRefundAmount: line.approvedRefundAmount ? money(line.approvedRefundAmount) : null,
          allocatedRefundAmount: money(allocatedRefundAmount),
          costAmountSnapshot: money(line.costAmountSnapshot),
          netCashCost: money(line.costAmountSnapshot.minus(allocatedRefundAmount)),
          returnRequired: line.returnRequired,
          returnedToSeller: line.returnedToSeller,
        };
      }),
    };
  }
}

export const inventoryService = new InventoryService();
