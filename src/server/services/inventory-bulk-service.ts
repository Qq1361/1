import { createHash, randomUUID } from "node:crypto";
import { ItemStatus, Prisma } from "@/generated/prisma/client";
import { addCalendarMonthsClamped, formatDateOnly, parseDateOnly } from "@/lib/date-only";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import type { InventoryBulkOperationInput } from "@/server/validation/inventory";

const inventoryInclude = {
  warehouse: { select: { id: true, name: true, isActive: true } },
  warehouseLocation: { select: { id: true, name: true, warehouseId: true, isActive: true } },
  saleLines: { select: { id: true } },
  shipmentLines: { select: { id: true } },
  platformReturnInspections: { select: { id: true } },
  saleAfterSaleLines: { select: { id: true } },
  purchaseAfterSaleLines: { select: { id: true } },
} satisfies Prisma.InventoryItemInclude;

type InventoryForBulk = Prisma.InventoryItemGetPayload<{ include: typeof inventoryInclude }>;
type DatabaseClient = Prisma.TransactionClient | typeof db;
type BulkChange = { before: Record<string, unknown>; after: Record<string, unknown>; update: Prisma.InventoryItemUpdateInput };

const allowedStatuses = new Set<ItemStatus>(["STOCKED"]);

function snapshot(item: InventoryForBulk) {
  return {
    inventoryCode: item.inventoryCode,
    name: item.name,
    skuText: item.skuText,
    warehouseId: item.warehouseId,
    warehouseName: item.warehouse?.name ?? null,
    storageLocationId: item.storageLocationId,
    storageLocationName: item.warehouseLocation?.name ?? null,
    condition: item.condition,
    saleMode: item.saleMode,
    productionDate: formatDateOnly(item.productionDate),
    shelfLifeMonths: item.shelfLifeMonths,
    expiryDate: formatDateOnly(item.expiryDate),
    itemStatus: item.itemStatus,
    ownershipStatus: item.ownershipStatus,
  };
}

function fingerprint(items: InventoryForBulk[], input: InventoryBulkOperationInput) {
  const payload = {
    operation: input.operation,
    payload: input.payload,
    ids: [...input.inventoryItemIds].sort(),
    items: [...items]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({ id: item.id, updatedAt: item.updatedAt.toISOString(), ...snapshot(item) })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function assertIds(ids: string[]) {
  if (!ids.length) throw new ServiceError("INVENTORY_BULK_EMPTY", "请至少选择一件库存。", 422);
  if (ids.length > 200) throw new ServiceError("INVENTORY_BULK_TOO_MANY", "单次最多选择 200 件库存。", 422);
  if (new Set(ids).size !== ids.length) throw new ServiceError("INVENTORY_BULK_DUPLICATE_ID", "批量操作中不能包含重复库存。", 422);
}

function lockReason(item: InventoryForBulk): string | null {
  if (!allowedStatuses.has(item.itemStatus)) {
    return item.itemStatus === "SOLD"
      ? `库存 ${item.inventoryCode} 已经售出，不能批量维护。`
      : `库存 ${item.inventoryCode} 已进入 ${item.itemStatus} 流程，不能批量维护。`;
  }
  if (item.ownershipStatus !== "OWNED") return `库存 ${item.inventoryCode} 已不属于可维护在库资产。`;
  if (item.saleLines.length) return `库存 ${item.inventoryCode} 已关联销售明细，不能批量维护。`;
  if (item.shipmentLines.length || item.platformReturnInspections.length) return `库存 ${item.inventoryCode} 已进入平台寄送或退回流程，不能批量维护。`;
  if (item.saleAfterSaleLines.length || item.purchaseAfterSaleLines.length) return `库存 ${item.inventoryCode} 已进入售后流程，不能批量维护。`;
  return null;
}

async function assertLocationTarget(client: DatabaseClient, ownerId: string, warehouseId: string, storageLocationId: string) {
  const [warehouse, location] = await Promise.all([
    client.warehouse.findFirst({ where: { id: warehouseId }, select: { id: true, ownerId: true, isActive: true } }),
    client.warehouseLocation.findFirst({ where: { id: storageLocationId }, select: { id: true, ownerId: true, warehouseId: true, isActive: true } }),
  ]);
  if (!warehouse || warehouse.ownerId !== ownerId) throw new ServiceError("WAREHOUSE_NOT_FOUND", "目标仓库不存在或无权访问。", 404);
  if (!warehouse.isActive) throw new ServiceError("WAREHOUSE_INACTIVE", "目标仓库已停用。", 409);
  if (!location || location.ownerId !== ownerId) throw new ServiceError("WAREHOUSE_LOCATION_NOT_FOUND", "目标库位不存在或无权访问。", 404);
  if (!location.isActive) throw new ServiceError("WAREHOUSE_LOCATION_INACTIVE", "目标库位已停用。", 409);
  if (location.warehouseId !== warehouse.id) throw new ServiceError("WAREHOUSE_LOCATION_MISMATCH", "所选库位不属于目标仓库。", 409);
}

function dateForMode(current: Date | null, mode: { mode: "KEEP" | "CLEAR" | "SET"; value?: string }, label: string) {
  if (mode.mode === "KEEP") return current;
  if (mode.mode === "CLEAR") return null;
  return parseDateOnly(mode.value!, label);
}

function monthsForMode(current: number | null, mode: { mode: "KEEP" | "CLEAR" | "SET"; value?: number }) {
  if (mode.mode === "KEEP") return current;
  if (mode.mode === "CLEAR") return null;
  return mode.value!;
}

function calculateChange(item: InventoryForBulk, input: InventoryBulkOperationInput): BulkChange {
  const before = snapshot(item);
  if (input.operation === "MOVE_LOCATION") {
    const after = { ...before, warehouseId: input.payload.warehouseId, storageLocationId: input.payload.storageLocationId };
    return {
      before,
      after,
      update: {
        warehouse: { connect: { id: input.payload.warehouseId } },
        warehouseLocation: { connect: { id: input.payload.storageLocationId } },
      },
    };
  }
  if (input.operation === "SET_CONDITION") {
    const after = { ...before, condition: input.payload.condition };
    return { before, after, update: { condition: input.payload.condition } };
  }
  if (input.operation === "SET_SALE_MODE") {
    const after = { ...before, saleMode: input.payload.saleMode };
    return { before, after, update: { saleMode: input.payload.saleMode } };
  }

  const productionDate = dateForMode(item.productionDate, input.payload.productionDate, "生产日期");
  const shelfLifeMonths = monthsForMode(item.shelfLifeMonths, input.payload.shelfLifeMonths);
  let expiryDate: Date | null;
  if (input.payload.expiryDate.mode === "AUTO") {
    if (!productionDate || !shelfLifeMonths) {
      throw new ServiceError("SHELF_LIFE_DATE_INVALID", "自动计算到期日期需要生产日期和保质期月数。", 422);
    }
    expiryDate = addCalendarMonthsClamped(productionDate, shelfLifeMonths);
  } else {
    expiryDate = dateForMode(item.expiryDate, input.payload.expiryDate, "到期日期");
  }
  if (productionDate && expiryDate && expiryDate < productionDate) {
    throw new ServiceError("SHELF_LIFE_DATE_INVALID", "到期日期不能早于生产日期。", 422);
  }
  const after = {
    ...before,
    productionDate: formatDateOnly(productionDate),
    shelfLifeMonths,
    expiryDate: formatDateOnly(expiryDate),
  };
  return { before, after, update: { productionDate, shelfLifeMonths, expiryDate } };
}

function didChange(change: BulkChange) {
  return JSON.stringify(change.before) !== JSON.stringify(change.after);
}

async function loadSelection(client: DatabaseClient, ownerId: string, ids: string[]) {
  const items = await client.inventoryItem.findMany({ where: { id: { in: ids } }, include: inventoryInclude });
  if (items.length !== ids.length) {
    const found = new Set(items.map((item) => item.id));
    const missingIds = ids.filter((id) => !found.has(id));
    const crossOwner = await client.inventoryItem.count({ where: { id: { in: missingIds }, ownerId: { not: ownerId } } });
    if (crossOwner) throw new ServiceError("INVENTORY_BULK_CROSS_OWNER", "不能操作其他 owner 的库存。", 403);
    throw new ServiceError("INVENTORY_BULK_ITEM_NOT_FOUND", "部分库存不存在。", 404);
  }
  if (items.some((item) => item.ownerId !== ownerId)) throw new ServiceError("INVENTORY_BULK_CROSS_OWNER", "不能操作其他 owner 的库存。", 403);
  return items;
}

function mixedProductCount(items: InventoryForBulk[]) {
  return new Set(items.map((item) => `${item.name}\u0000${item.skuText ?? ""}`)).size;
}

function blockedItems(items: InventoryForBulk[]) {
  return items.flatMap((item) => {
    const reason = lockReason(item);
    return reason ? [{ inventoryItemId: item.id, inventoryCode: item.inventoryCode, reason }] : [];
  });
}

async function validateOperation(client: DatabaseClient, ownerId: string, input: InventoryBulkOperationInput) {
  if (input.operation === "MOVE_LOCATION") {
    await assertLocationTarget(client, ownerId, input.payload.warehouseId, input.payload.storageLocationId);
  }
}

export class InventoryBulkService {
  async preview(ownerId: string, input: InventoryBulkOperationInput) {
    assertIds(input.inventoryItemIds);
    await validateOperation(db, ownerId, input);
    const items = await loadSelection(db, ownerId, input.inventoryItemIds);
    const blocked = blockedItems(items);
    const changes = items.map((item) => ({ item, change: calculateChange(item, input) }));
    const changed = changes.filter(({ change }) => didChange(change));
    const products = new Set(items.map((item) => item.name));
    const warehouses = new Set(items.map((item) => item.warehouseId).filter(Boolean));
    return {
      selectedCount: items.length,
      editableCount: items.length - blocked.length,
      blockedCount: blocked.length,
      blockedItems: blocked,
      productCount: products.size,
      productSkuCount: mixedProductCount(items),
      warehouseCount: warehouses.size,
      changedCount: changed.length,
      requiresMixedProductConfirmation: (input.operation === "SET_CONDITION" || input.operation === "SET_SHELF_LIFE") && mixedProductCount(items) > 1,
      requiresReason: input.operation === "SET_SHELF_LIFE",
      selectionFingerprint: fingerprint(items, input),
      changes: changes.map(({ item, change }) => ({
        inventoryItemId: item.id,
        inventoryCode: item.inventoryCode,
        name: item.name,
        skuText: item.skuText,
        changed: didChange(change),
        before: change.before,
        after: change.after,
      })),
    };
  }

  async update(ownerId: string, input: InventoryBulkOperationInput) {
    assertIds(input.inventoryItemIds);
    if (!input.selectionFingerprint) throw new ServiceError("INVENTORY_BULK_SELECTION_CHANGED", "请先重新预览库存变更。", 409);
    if (input.operation === "SET_SHELF_LIFE" && !input.reason?.trim()) {
      throw new ServiceError("SHELF_LIFE_REASON_REQUIRED", "请填写根据实物包装修正保质期的原因。", 422);
    }
    try {
      return await db.$transaction(async (tx) => {
        await validateOperation(tx, ownerId, input);
        const items = await loadSelection(tx, ownerId, input.inventoryItemIds);
        const currentFingerprint = fingerprint(items, input);
        if (currentFingerprint !== input.selectionFingerprint) {
          throw new ServiceError("INVENTORY_BULK_SELECTION_CHANGED", "库存资料已发生变化，请重新预览。", 409);
        }
        const blocked = blockedItems(items);
        if (blocked.length) throw new ServiceError("INVENTORY_BULK_ITEM_LOCKED", blocked[0].reason, 409);
        const productSkuCount = mixedProductCount(items);
        if ((input.operation === "SET_CONDITION" || input.operation === "SET_SHELF_LIFE") && productSkuCount > 1 && !input.confirmMixedProducts) {
          throw new ServiceError("INVENTORY_BULK_MIXED_PRODUCTS_CONFIRMATION_REQUIRED", "当前选择涉及多个商品或 SKU，请确认后再提交。", 422);
        }
        const changes = items.map((item) => ({ item, change: calculateChange(item, input) })).filter(({ change }) => didChange(change));
        if (!changes.length) throw new ServiceError("INVENTORY_BULK_NO_CHANGES", "新值与当前库存资料完全相同，无需更新。", 409);
        const batchId = randomUUID();
        for (const { item, change } of changes) {
          await tx.inventoryItem.update({ where: { id: item.id }, data: change.update });
          await tx.inventoryItemActionLog.create({
            data: {
              ownerId,
              inventoryItemId: item.id,
              batchId,
              actionType: input.operation,
              beforeData: change.before as Prisma.InputJsonObject,
              afterData: change.after as Prisma.InputJsonObject,
              reason: input.reason?.trim() || null,
            },
          });
        }
        return { updatedCount: changes.length, batchId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "P2034" || code === "P2002") {
        throw new ServiceError("INVENTORY_BULK_CONFLICT", "库存资料发生并发变化，请重新预览后再提交。", 409);
      }
      throw error;
    }
  }
}

export const inventoryBulkService = new InventoryBulkService();
