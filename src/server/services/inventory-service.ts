import { createHash } from "node:crypto";
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

type BulkSkuInput = {
  inventoryItemIds: string[];
  skuText?: string | null | undefined;
  overwriteExisting?: boolean;
  allowMixedProducts?: boolean;
  includeHistorical?: boolean;
  selectionFingerprint?: string;
};

type BulkSkuItem = Pick<Prisma.InventoryItemGetPayload<Record<string, never>>, "id" | "inventoryCode" | "name" | "skuText" | "itemStatus" | "updatedAt" | "saleMode" | "storageLocation" | "expiryDate">;

function assertBulkSkuIds(ids: string[]) {
  if (!ids.length || ids.length > 500) {
    throw new ServiceError("INVALID_INVENTORY_SELECTION", "Please select between 1 and 500 inventory items.", 422);
  }
  if (new Set(ids).size !== ids.length) {
    throw new ServiceError("INVENTORY_BULK_DUPLICATE_ID", "Duplicate inventory items are not allowed for a bulk SKU change.", 422);
  }
}

function normalizeBulkSkuInput(input: BulkSkuInput) {
  return {
    inventoryItemIds: input.inventoryItemIds,
    skuText: normalizeSku(input.skuText),
    overwriteExisting: input.overwriteExisting ?? false,
    allowMixedProducts: input.allowMixedProducts ?? false,
    includeHistorical: input.includeHistorical ?? false,
  };
}

function bulkSkuFingerprint(items: BulkSkuItem[], input: ReturnType<typeof normalizeBulkSkuInput>) {
  const source = items
    .map((item) => ({
      id: item.id,
      skuText: normalizeSku(item.skuText),
      itemStatus: item.itemStatus,
      name: item.name,
      updatedAt: item.updatedAt.toISOString(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256")
    .update(JSON.stringify({ input, source }))
    .digest("hex");
}

function getBulkSkuChanges(items: BulkSkuItem[], input: ReturnType<typeof normalizeBulkSkuInput>) {
  return items
    .slice()
    .sort((left, right) => left.inventoryCode.localeCompare(right.inventoryCode))
    .map((item) => {
      const oldSku = normalizeSku(item.skuText);
      let result = "WILL_UPDATE";
      if (isLegacyInventoryItemStatus(item.itemStatus)) result = "LEGACY_STATUS_EXCLUDED";
      else if (item.itemStatus === "SOLD" && !input.includeHistorical) result = "HISTORICAL_ITEM_EXCLUDED";
      else if (oldSku !== null && !input.overwriteExisting) result = "SKU_ALREADY_EXISTS";
      else if (oldSku === input.skuText) result = "NO_CHANGE";
      return {
        inventoryItemId: item.id,
        inventoryCode: item.inventoryCode,
        name: item.name,
        itemStatus: item.itemStatus,
        oldSku,
        newSku: input.skuText,
        result,
        willUpdate: result === "WILL_UPDATE",
        updatedAt: item.updatedAt,
      };
    });
}

export class InventoryService {
  async selectAllMatching(
    ownerId: string,
    query: Parameters<InventoryService["list"]>[1],
  ) {
    const first = await this.list(ownerId, { ...query, page: 1, pageSize: 100 });
    if (first.total > 200) {
      throw new ServiceError(
        "INVENTORY_BULK_TOO_MANY",
        "当前筛选结果超过 200 件，请缩小筛选范围后再批量操作。",
        422,
      );
    }
    const toSelectionItem = (item: (typeof first.data)[number]) => ({
      id: item.id,
      name: item.name,
      skuText: item.skuText,
      warehouseId: item.warehouseId,
      itemStatus: item.itemStatus,
    });
    if (first.total <= first.data.length) {
      return {
        inventoryItemIds: first.data.map((item) => item.id),
        items: first.data.map(toSelectionItem),
        total: first.total,
      };
    }
    const second = await this.list(ownerId, { ...query, page: 2, pageSize: 100 });
    const items = [...first.data, ...second.data];
    return {
      inventoryItemIds: items.map((item) => item.id),
      items: items.map(toSelectionItem),
      total: first.total,
    };
  }

  async list(
    ownerId: string,
    query: {
      query?: string;
      itemStatus?: Prisma.EnumItemStatusFilter["equals"];
      saleMode?: Prisma.EnumSaleModeFilter["equals"];
      warehouseId?: string;
      condition?: Prisma.EnumInventoryConditionNullableFilter["equals"];
      shelfLife?: "HAS_EXPIRY" | "NO_EXPIRY" | "EXPIRED";
      sort?: "STOCKED_AT_DESC" | "STOCKED_AT_ASC" | "EXPIRY_DATE_ASC";
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
      warehouseId: query.warehouseId,
      condition: query.condition,
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
    if (query.shelfLife === "HAS_EXPIRY") where.expiryDate = { not: null };
    if (query.shelfLife === "NO_EXPIRY") where.expiryDate = null;
    if (query.shelfLife === "EXPIRED") where.expiryDate = { lte: now };
    const orderBy: Prisma.InventoryItemOrderByWithRelationInput[] = query.sort === "STOCKED_AT_ASC"
      ? [{ stockedAt: "asc" }, { id: "asc" }]
      : query.sort === "EXPIRY_DATE_ASC"
        ? [{ expiryDate: "asc" }, { id: "asc" }]
        : [{ stockedAt: "desc" }, { id: "desc" }];
    const hasExactSkuFilter = Boolean(query.skuExact) || query.skuEmpty === true;
    if (hasExactSkuFilter && !query.reminder) {
      const requestedSku = normalizeSku(query.skuExact);
      const exactItems = await db.inventoryItem.findMany({
        where,
        orderBy,
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
        orderBy,
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
        orderBy,
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

  async previewBulkSku(ownerId: string, input: BulkSkuInput) {
    assertBulkSkuIds(input.inventoryItemIds);
    const normalizedInput = normalizeBulkSkuInput(input);
    const items = await db.inventoryItem.findMany({ where: { id: { in: normalizedInput.inventoryItemIds }, ownerId } });
    if (items.length !== normalizedInput.inventoryItemIds.length) {
      throw new ServiceError("INVENTORY_NOT_FOUND", "部分库存不存在或无权访问。", 404);
    }
    const productNames = new Set(items.map((item) => item.name));
    if (productNames.size > 1 && !normalizedInput.allowMixedProducts) {
      throw new ServiceError("MIXED_PRODUCTS", "已选择多个不同商品，请明确确认后再批量设置 SKU。", 409);
    }
    const changes = getBulkSkuChanges(items, normalizedInput);
    return {
      selectedCount: items.length,
      updateCount: changes.filter((change) => change.willUpdate).length,
      skippedCount: changes.filter((change) => !change.willUpdate).length,
      selectionFingerprint: bulkSkuFingerprint(items, normalizedInput),
      changes: changes.map((change) => {
        const { updatedAt, ...dto } = change;
        void updatedAt;
        return dto;
      }),
    };
  }

  async bulkUpdateSku(ownerId: string, input: BulkSkuInput) {
    assertBulkSkuIds(input.inventoryItemIds);
    if (!input.selectionFingerprint) {
      throw new ServiceError("INVENTORY_BULK_SELECTION_CHANGED", "请先重新预览 SKU 变更后再确认。", 409);
    }
    const normalizedInput = normalizeBulkSkuInput(input);
    return db.$transaction(async (tx) => {
      const items = await tx.inventoryItem.findMany({ where: { id: { in: normalizedInput.inventoryItemIds }, ownerId } });
      if (items.length !== normalizedInput.inventoryItemIds.length) {
        throw new ServiceError("INVENTORY_NOT_FOUND", "部分库存不存在或无权访问。", 404);
      }
      const productNames = new Set(items.map((item) => item.name));
      if (productNames.size > 1 && !normalizedInput.allowMixedProducts) {
        throw new ServiceError("MIXED_PRODUCTS", "已选择多个不同商品，请明确确认后再批量设置 SKU。", 409);
      }
      const currentFingerprint = bulkSkuFingerprint(items, normalizedInput);
      if (currentFingerprint !== input.selectionFingerprint) {
        throw new ServiceError("INVENTORY_BULK_SELECTION_CHANGED", "库存资料已在预览后发生变化，请重新预览。", 409);
      }
      const changes = getBulkSkuChanges(items, normalizedInput);
      const updates = changes.filter((change) => change.willUpdate);
      for (const change of updates) {
        const result = await tx.inventoryItem.updateMany({
          where: { id: change.inventoryItemId, ownerId, updatedAt: change.updatedAt },
          data: { skuText: change.newSku },
        });
        if (result.count !== 1) {
          throw new ServiceError("INVENTORY_BULK_SELECTION_CHANGED", "确认期间库存资料发生变化，整批 SKU 修改未保存。", 409);
        }
      }
      if (updates.length) {
        await tx.inventoryActionLog.createMany({
          data: updates.map((change) => {
            const item = items.find((candidate) => candidate.id === change.inventoryItemId)!;
            return {
              ownerId,
              inventoryItemId: item.id,
              actionType: "BULK_UPDATED_SKU",
              note: `来源：库存批量 SKU 纠错；旧 SKU：${change.oldSku ?? "未填写"}；新 SKU：${change.newSku ?? "未填写"}`,
              oldSaleMode: item.saleMode,
              newSaleMode: item.saleMode,
              oldItemStatus: item.itemStatus,
              newItemStatus: item.itemStatus,
              oldStorageLocation: item.storageLocation,
              newStorageLocation: item.storageLocation,
              oldExpiryDate: item.expiryDate,
              newExpiryDate: item.expiryDate,
            };
          }),
        });
      }
      return {
        updatedCount: updates.length,
        skippedCount: changes.length - updates.length,
        selectionFingerprint: currentFingerprint,
        changes: changes.map((change) => {
          const { updatedAt, ...dto } = change;
          void updatedAt;
          return dto;
        }),
      };
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
