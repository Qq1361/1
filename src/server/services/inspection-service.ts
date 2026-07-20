import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { addCalendarMonthsClamped, formatDateOnly, parseDateOnly } from "@/lib/date-only";
import { normalizeSku } from "@/lib/normalize-sku";

const INVENTORY_CONDITIONS = new Set(["NEW", "LIKE_NEW", "LIGHTLY_USED", "USED", "FLAWED"]);
const SALE_MODES = new Set(["NONE", "DEWU_LIGHTNING", "DEWU_STANDARD", "NINETY_FIVE", "XIANYU", "OTHER"]);
const MAX_BATCH_INSPECTIONS = 50;

type BatchInspectionInput = {
  inspectionId: string;
  sku: string | null;
  warehouseId: string;
  locationMode: "MANUAL" | "STANDARD";
  storageLocation?: string | null;
  storageLocationId?: string | null;
  condition: string;
  saleMode: string | null;
  productionDate: string | null;
  shelfLifeMonths: number | null;
  expiryDate: string | null;
  note: string | null;
  shelfLifeChangeReason: string | null;
};

function normalizeManualStorageLocation(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new ServiceError("MANUAL_STORAGE_LOCATION_REQUIRED", "手动库位不能为空。", 400);
  if (normalized.length > 100 || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new ServiceError("MANUAL_STORAGE_LOCATION_INVALID", "手动库位格式无效。", 400);
  }
  return normalized;
}

function formatSnapshotDate(value: Date | null | undefined) {
  return formatDateOnly(value) ?? "—";
}

function appendAuditNote(current: string | null, blocks: string[]) {
  const additions = blocks.filter(Boolean).filter((block) => !current?.includes(block));
  if (!additions.length) return current;
  return [current?.trim(), ...additions].filter(Boolean).join("\n\n");
}

export function splitUnitCosts(total: string, quantity: number) {
  const [whole, fraction = ""] = total.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  const base = cents / BigInt(quantity);
  const remainder = cents % BigInt(quantity);
  return Array.from({ length: quantity }, (_, index) => {
    const value = index === quantity - 1 ? base + remainder : base;
    return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
  });
}

export async function ensurePendingInspectionsTx(
  tx: Prisma.TransactionClient,
  ownerId: string,
  orderId: string,
) {
  const order = await tx.purchaseOrder.findFirst({
    where: { id: orderId, ownerId, status: "PENDING_INSPECTION" },
    include: { items: true },
  });
  if (!order) return 0;
  const data = order.items.flatMap((item) =>
    Array.from({ length: item.quantity }, (_, index) => ({
      ownerId,
      purchaseOrderItemId: item.id,
      sequence: index + 1,
    })),
  );
  const result = await tx.inspection.createMany({ data, skipDuplicates: true });
  return result.count;
}

export class InspectionService {
  async ensurePendingInspections(ownerId: string, orderId?: string) {
    return db.$transaction(async (tx) => {
      const orderIds = orderId
        ? [orderId]
        : (
            await tx.purchaseOrder.findMany({
              where: { ownerId, status: "PENDING_INSPECTION" },
              select: { id: true },
            })
          ).map((order) => order.id);
      let created = 0;
      for (const id of orderIds) {
        created += await ensurePendingInspectionsTx(tx, ownerId, id);
      }
      return { created };
    });
  }

  async list(
    ownerId: string,
    filters: { query?: string; page?: number; pageSize?: number } = {},
  ) {
    const query = filters.query?.trim();
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 20));
    const where: Prisma.InspectionWhereInput = {
      ownerId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      purchaseOrderItem: {
        purchaseOrder: { ownerId, status: "PENDING_INSPECTION" },
      },
      ...(query
        ? {
            OR: [
              { purchaseOrderItem: { name: { contains: query, mode: "insensitive" } } },
              { purchaseOrderItem: { skuText: { contains: query, mode: "insensitive" } } },
              {
                purchaseOrderItem: {
                  purchaseOrder: { orderNo: { contains: query, mode: "insensitive" } },
                },
              },
              {
                purchaseOrderItem: {
                  purchaseOrder: { sellerNickname: { contains: query, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
    };
    const total = await db.inspection.count({ where });
    const totalPages = Math.ceil(total / pageSize);
    const currentPage = totalPages ? Math.min(page, totalPages) : 1;
    const inspections = await db.inspection.findMany({
      where,
      include: { purchaseOrderItem: { include: { purchaseOrder: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    });
    const pendingOrders = await db.purchaseOrder.findMany({
      where: { ownerId, status: "PENDING_INSPECTION" },
      include: { items: { include: { _count: { select: { inspections: true } } } } },
    });
    const missingCount = pendingOrders.reduce(
      (sum, order) =>
        sum +
        order.items.reduce(
          (itemSum, item) =>
            itemSum + Math.max(0, item.quantity - item._count.inspections),
          0,
        ),
      0,
    );
    return {
      data: inspections,
      missingCount,
      page: currentPage,
      pageSize,
      total,
      totalPages,
    };
  }

  async get(ownerId: string, id: string) {
    const inspection = await db.inspection.findFirst({
      where: { id, ownerId },
      include: {
        purchaseOrderItem: { include: { purchaseOrder: true } },
        inventoryItem: true,
      },
    });
    if (!inspection)
      throw new ServiceError("INSPECTION_NOT_FOUND", "验货记录不存在。", 404);
    return inspection;
  }

  async update(ownerId: string, id: string, data: Record<string, unknown>) {
    const inspection = await db.inspection.findFirst({
      where: { id, ownerId },
      include: {
        inventoryItem: true,
        purchaseOrderItem: { include: { purchaseOrder: { include: { items: true } } } },
      },
    });
    if (!inspection)
      throw new ServiceError("INSPECTION_NOT_FOUND", "验货记录不存在。", 404);

    const isCompleted = !!inspection.completedAt;
    // Strip storageLocation — it belongs to InventoryItem, not Inspection
    const inspectionData = { ...data } as Record<string, unknown>;
    const storageLoc = inspectionData.storageLocation as string | undefined;
    const skuText = inspectionData.skuText as string | null | undefined;
    const resultChange = inspectionData.result as "PASS" | "PROBLEM" | undefined;
    delete inspectionData.storageLocation;
    delete inspectionData.skuText;
    // Don't pass result to inspection update during simple save (only during completed edit)
    if (!isCompleted) {
      delete inspectionData.result;
    }

    if (isCompleted && inspection.inventoryItem && (storageLoc !== undefined || skuText !== undefined || resultChange)) {
      // Sync changes to InventoryItem in a transaction
      return db.$transaction(async (tx) => {
        const invUpdate: Record<string, unknown> = {};
        if (storageLoc !== undefined) invUpdate.storageLocation = storageLoc.trim() || null;
        if (skuText !== undefined) invUpdate.skuText = normalizeSku(skuText);
        if (resultChange) {
          if (resultChange === "PROBLEM") {
            invUpdate.itemStatus = "PROBLEM";
            invUpdate.problemReason = (inspectionData.notes as string) || (inspectionData.appearanceNotes as string) || "验货问题";
          } else {
            invUpdate.itemStatus = "STOCKED";
            invUpdate.problemReason = null;
          }
        }
        if (Object.keys(invUpdate).length > 0) {
          await tx.inventoryItem.update({
            where: { id: inspection.inventoryItem!.id },
            data: invUpdate,
          });
        }
        const inspUpdate: Record<string, unknown> = { ...inspectionData };
        if (resultChange) inspUpdate.result = resultChange;
        return tx.inspection.update({ where: { id }, data: inspUpdate });
      });
    }

    return db.inspection.update({
      where: { id },
      data: isCompleted
        ? inspectionData
        : { ...inspectionData, status: "IN_PROGRESS", startedAt: inspection.startedAt ?? new Date() },
    });
  }

  private async completeTx(
    ownerId: string,
    id: string,
    input: Record<string, unknown> & { result: "PASS" | "PROBLEM" },
    tx: Prisma.TransactionClient,
  ) {
          const inspection = await tx.inspection.findFirst({
            where: { id, ownerId },
            include: {
              inventoryItem: true,
              purchaseOrderItem: { include: { purchaseOrder: { include: { items: true } } } },
            },
          });
          if (!inspection)
            throw new ServiceError("INSPECTION_NOT_FOUND", "验货记录不存在。", 404);
          if (inspection.completedAt || inspection.inventoryItem)
            throw new ServiceError("INSPECTION_ALREADY_COMPLETED", "验货已经完成。", 409);
          const order = inspection.purchaseOrderItem.purchaseOrder;
          if (order.allocationStatus !== "CONFIRMED")
            throw new ServiceError(
              "ALLOCATION_NOT_CONFIRMED",
              "请先确认采购订单成本分摊。",
              409,
            );
          const allocated = inspection.purchaseOrderItem.allocatedTotalCost;
          if (!allocated)
            throw new ServiceError("ALLOCATION_NOT_CONFIRMED", "商品成本尚未分摊。", 409);
          const costs = splitUnitCosts(
            allocated.toFixed(2),
            inspection.purchaseOrderItem.quantity,
          );
          const now = new Date();
          // Extract storageLocation for InventoryItem; it is not an Inspection field
          const { result, storageLocation: loc, skuText, ...fields } = input;
          const updatedInspection = await tx.inspection.update({
            where: { id },
            data: {
              ...fields,
              result,
              status: result === "PASS" ? "PASSED" : "PROBLEM",
              currentStep: 6,
              startedAt: inspection.startedAt ?? now,
              completedAt: now,
            },
          });
          const inventory = await tx.inventoryItem.create({
            data: {
              ownerId,
              purchaseOrderItemId: inspection.purchaseOrderItemId,
              inspectionId: id,
              inventoryCode: `INV-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`,
              name: inspection.purchaseOrderItem.name,
              skuText: normalizeSku((skuText as string | null | undefined) ?? inspection.purchaseOrderItem.skuText),
              unitCost: new Prisma.Decimal(costs[inspection.sequence - 1]),
              productionDate: inspection.purchaseOrderItem.productionDate,
              shelfLifeMonths: inspection.purchaseOrderItem.shelfLifeMonths,
              expiryDate: inspection.purchaseOrderItem.expiryDate,
              storageLocation: (loc as string)?.trim() || null,
              itemStatus: result === "PASS" ? "STOCKED" : "PROBLEM",
              stockedAt: now,
              problemReason:
                result === "PROBLEM"
                  ? updatedInspection.notes ?? updatedInspection.appearanceNotes ?? "验货问题"
                  : null,
            },
          });
          const expected = order.items.reduce((sum, item) => sum + item.quantity, 0);
          const completed = await tx.inspection.findMany({
            where: {
              purchaseOrderItem: { purchaseOrderId: order.id },
              completedAt: { not: null },
            },
            select: { status: true },
          });
          await tx.purchaseOrder.update({
            where: { id: order.id },
            data: {
              status:
                completed.length < expected
                  ? "PENDING_INSPECTION"
                  : completed.some((item) => item.status === "PROBLEM")
                    ? "PARTIALLY_STOCKED"
                    : "STOCKED",
            },
          });
          return { inspection: updatedInspection, inventory };
  }

  async complete(
    ownerId: string,
    id: string,
    input: Record<string, unknown> & { result: "PASS" | "PROBLEM" },
  ) {
    try {
      return await db.$transaction(
        (tx) => this.completeTx(ownerId, id, input, tx),
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      )
        throw new ServiceError(
          "INSPECTION_ALREADY_COMPLETED",
          "验货已经完成，请勿重复提交。",
          409,
        );
      throw error;
    }
  }

  private validateBatchIds(inspectionIds: string[]) {
    if (inspectionIds.length === 0)
      throw new ServiceError("BATCH_INSPECTION_EMPTY", "请至少选择一件待验货商品。", 400);
    if (inspectionIds.length > MAX_BATCH_INSPECTIONS)
      throw new ServiceError("BATCH_INSPECTION_TOO_MANY", "一次最多验货通过 50 件商品。", 400);
    if (new Set(inspectionIds).size !== inspectionIds.length)
      throw new ServiceError("BATCH_INSPECTION_DUPLICATE_IDS", "不能重复选择同一件待验货商品。", 400);
  }

  async prepareBatchPass(ownerId: string, inspectionIds: string[]) {
    this.validateBatchIds(inspectionIds);
    const [inspections, warehouses] = await Promise.all([
      db.inspection.findMany({
        where: { id: { in: inspectionIds }, ownerId },
        include: {
          inventoryItem: { select: { id: true } },
          purchaseOrderItem: { include: { purchaseOrder: { select: { orderNo: true, sellerNickname: true, status: true } } } },
        },
      }),
      db.warehouse.findMany({
        where: { ownerId, isActive: true },
        include: { locations: { where: { isActive: true }, orderBy: { name: "asc" } } },
        orderBy: { name: "asc" },
      }),
    ]);
    const byId = new Map(inspections.map((inspection) => [inspection.id, inspection]));
    const selected = inspectionIds.map((id) => byId.get(id));
    if (selected.some((inspection) => !inspection))
      throw new ServiceError("INSPECTION_NOT_FOUND", "选中的待验货商品不存在或不属于当前用户。", 404);
    for (const inspection of selected) {
      if (!inspection || inspection.completedAt)
        throw new ServiceError("ALREADY_COMPLETED", "选中的商品已完成验货，请刷新列表。", 409);
      if (inspection.inventoryItem)
        throw new ServiceError("INVENTORY_ALREADY_EXISTS", "选中的商品已经生成库存，请刷新列表。", 409);
      if (!['PENDING', 'IN_PROGRESS'].includes(inspection.status) || inspection.purchaseOrderItem.purchaseOrder.status !== 'PENDING_INSPECTION')
        throw new ServiceError("BATCH_INSPECTION_CONFLICT", "选中的商品当前不能验货，请刷新列表。", 409);
    }
    return {
      items: selected.map((inspection) => ({
        inspectionId: inspection!.id,
        sequence: inspection!.sequence,
        productName: inspection!.purchaseOrderItem.name,
        sku: inspection!.purchaseOrderItem.skuText,
        purchaseOrderNo: inspection!.purchaseOrderItem.purchaseOrder.orderNo,
        sellerNickname: inspection!.purchaseOrderItem.purchaseOrder.sellerNickname,
        productionDate: formatDateOnly(inspection!.purchaseOrderItem.productionDate),
        shelfLifeMonths: inspection!.purchaseOrderItem.shelfLifeMonths,
        expiryDate: formatDateOnly(inspection!.purchaseOrderItem.expiryDate),
      })),
      warehouses,
    };
  }

  async batchPassWithDetails(ownerId: string, items: BatchInspectionInput[], commonNote?: string | null) {
    this.validateBatchIds(items.map((item) => item.inspectionId));
    try {
      return await db.$transaction(async (tx) => {
        const inspectionIds = items.map((item) => item.inspectionId);
        const [inspections, warehouses, locations] = await Promise.all([
          tx.inspection.findMany({
            where: { id: { in: inspectionIds }, ownerId },
            include: {
              inventoryItem: { select: { id: true } },
              purchaseOrderItem: { include: { purchaseOrder: { include: { items: true } } } },
            },
          }),
          tx.warehouse.findMany({ where: { id: { in: [...new Set(items.map((item) => item.warehouseId))] } } }),
          tx.warehouseLocation.findMany({ where: { id: { in: [...new Set(items.flatMap((item) => item.locationMode === "STANDARD" && item.storageLocationId ? [item.storageLocationId] : []))] } } }),
        ]);
        const inspectionById = new Map(inspections.map((inspection) => [inspection.id, inspection]));
        const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
        const locationById = new Map(locations.map((location) => [location.id, location]));
        const resolved = items.map((input) => {
          const inspection = inspectionById.get(input.inspectionId);
          if (!inspection)
            throw new ServiceError("INSPECTION_NOT_FOUND", "选中的待验货商品不存在或不属于当前用户。", 404);
          if (inspection.completedAt)
            throw new ServiceError("ALREADY_COMPLETED", "选中的商品已完成验货，请刷新列表。", 409);
          if (inspection.inventoryItem)
            throw new ServiceError("INVENTORY_ALREADY_EXISTS", "选中的商品已经生成库存，请刷新列表。", 409);
          if (!['PENDING', 'IN_PROGRESS'].includes(inspection.status) || inspection.purchaseOrderItem.purchaseOrder.status !== 'PENDING_INSPECTION')
            throw new ServiceError("BATCH_INSPECTION_CONFLICT", "选中的商品当前不能验货，请刷新列表。", 409);
          if (inspection.purchaseOrderItem.purchaseOrder.allocationStatus !== "CONFIRMED" || !inspection.purchaseOrderItem.allocatedTotalCost)
            throw new ServiceError("ALLOCATION_NOT_CONFIRMED", "请先确认采购订单成本分摊。", 409);
          const warehouse = warehouseById.get(input.warehouseId);
          if (!warehouse) throw new ServiceError("WAREHOUSE_NOT_FOUND", "仓库不存在。", 404);
          if (warehouse.ownerId !== ownerId) throw new ServiceError("WAREHOUSE_CROSS_OWNER", "不能使用其他用户的仓库。", 403);
          if (!warehouse.isActive) throw new ServiceError("WAREHOUSE_INACTIVE", "仓库已停用，不能用于入库。", 409);
          const location = input.locationMode === "STANDARD"
            ? locationById.get(input.storageLocationId ?? "")
            : null;
          const manualStorageLocation = input.locationMode === "MANUAL"
            ? normalizeManualStorageLocation(input.storageLocation)
            : null;
          if (input.locationMode === "STANDARD") {
            if (!location || location.ownerId !== ownerId)
              throw new ServiceError("WAREHOUSE_LOCATION_NOT_FOUND", "库位不存在。", 404);
            if (!location.isActive) throw new ServiceError("WAREHOUSE_LOCATION_INACTIVE", "库位已停用，不能用于入库。", 409);
            if (location.warehouseId !== warehouse.id)
              throw new ServiceError("WAREHOUSE_LOCATION_MISMATCH", "库位不属于所选仓库。", 400);
          }
          if (!INVENTORY_CONDITIONS.has(input.condition))
            throw new ServiceError("INVENTORY_CONDITION_INVALID", "请选择有效的库存成色。", 400);
          if (input.saleMode !== null && !SALE_MODES.has(input.saleMode))
            throw new ServiceError("SALE_MODE_INVALID", "请选择有效的计划出售方式。", 400);
          if (input.shelfLifeMonths !== null && (input.shelfLifeMonths < 1 || input.shelfLifeMonths > 600))
            throw new ServiceError("SHELF_LIFE_DATE_INVALID", "保质期月数必须是 1 到 600 的整数。", 400);

          const productionDate = input.productionDate ? parseDateOnly(input.productionDate, "生产日期") : null;
          let expiryDate = input.expiryDate ? parseDateOnly(input.expiryDate, "到期日期") : null;
          if (!expiryDate && productionDate && input.shelfLifeMonths) {
            expiryDate = addCalendarMonthsClamped(productionDate, input.shelfLifeMonths);
          }
          if (productionDate && expiryDate && expiryDate < productionDate)
            throw new ServiceError("SHELF_LIFE_DATE_INVALID", "到期日期不能早于生产日期。", 400);
          const source = inspection.purchaseOrderItem;
          const shelfLifeChanged =
            formatDateOnly(source.productionDate) !== formatDateOnly(productionDate) ||
            source.shelfLifeMonths !== input.shelfLifeMonths ||
            formatDateOnly(source.expiryDate) !== formatDateOnly(expiryDate);
          if (shelfLifeChanged && !input.shelfLifeChangeReason?.trim())
            throw new ServiceError("SHELF_LIFE_CHANGE_REASON_REQUIRED", "保质期资料与采购录入不一致，请说明实物修正依据。", 400);
          return { input, inspection, warehouse, location, manualStorageLocation, productionDate, expiryDate, shelfLifeChanged };
        });

        const now = new Date();
        const completed: Array<{ inspectionId: string; inventoryId: string }> = [];
        for (const entry of resolved) {
          const { input, inspection, location, manualStorageLocation, productionDate, expiryDate, shelfLifeChanged } = entry;
          const source = inspection.purchaseOrderItem;
          const costs = splitUnitCosts(source.allocatedTotalCost!.toFixed(2), source.quantity);
          const correction = shelfLifeChanged
            ? `[保质期实物修正]\n原生产日期：${formatSnapshotDate(source.productionDate)}\n新生产日期：${formatSnapshotDate(productionDate)}\n原保质期月数：${source.shelfLifeMonths ?? "—"}\n新保质期月数：${input.shelfLifeMonths ?? "—"}\n原到期日期：${formatSnapshotDate(source.expiryDate)}\n新到期日期：${formatSnapshotDate(expiryDate)}\n修改原因：${input.shelfLifeChangeReason!.trim()}`
            : "";
          const inboundNote = commonNote?.trim() || input.note?.trim()
            ? `[批量验货入库]${commonNote?.trim() ? `\n公共备注：${commonNote.trim()}` : ""}${input.note?.trim() ? `\n单件备注：${input.note.trim()}` : ""}`
            : "";
          const updatedInspection = await tx.inspection.update({
            where: { id: inspection.id },
            data: {
              result: "PASS",
              status: "PASSED",
              currentStep: 6,
              startedAt: inspection.startedAt ?? now,
              completedAt: now,
              notes: appendAuditNote(inspection.notes, [inboundNote, correction]),
            },
          });
          const inventory = await tx.inventoryItem.create({
            data: {
              ownerId,
              purchaseOrderItemId: source.id,
              inspectionId: inspection.id,
              inventoryCode: `INV-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`,
              name: source.name,
              skuText: normalizeSku(input.sku),
              unitCost: new Prisma.Decimal(costs[inspection.sequence - 1]),
              productionDate,
              shelfLifeMonths: input.shelfLifeMonths,
              expiryDate,
              warehouseId: entry.warehouse.id,
              storageLocationId: location?.id ?? null,
              storageLocation: manualStorageLocation,
              condition: input.condition as never,
              saleMode: (input.saleMode ?? "NONE") as never,
              itemStatus: "STOCKED",
              stockedAt: now,
            },
          });
          completed.push({ inspectionId: updatedInspection.id, inventoryId: inventory.id });
        }
        for (const orderId of new Set(resolved.map((entry) => entry.inspection.purchaseOrderItem.purchaseOrder.id))) {
          const order = resolved.find((entry) => entry.inspection.purchaseOrderItem.purchaseOrder.id === orderId)!.inspection.purchaseOrderItem.purchaseOrder;
          const completedInspections = await tx.inspection.findMany({
            where: { purchaseOrderItem: { purchaseOrderId: orderId }, completedAt: { not: null } },
            select: { status: true },
          });
          const expected = order.items.reduce((sum, item) => sum + item.quantity, 0);
          await tx.purchaseOrder.update({
            where: { id: orderId },
            data: {
              status: completedInspections.length < expected ? "PENDING_INSPECTION" : completedInspections.some((item) => item.status === "PROBLEM") ? "PARTIALLY_STOCKED" : "STOCKED",
            },
          });
        }
        return {
          processedCount: completed.length,
          inspectionIds: completed.map((item) => item.inspectionId),
          inventoryItemIds: completed.map((item) => item.inventoryId),
          skippedCount: 0,
        };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ServiceError("BATCH_INSPECTION_CONFLICT", "验货状态已变化，请刷新列表后重试。", 409);
      throw error;
    }
  }

  async batchPass(ownerId: string, inspectionIds: string[]) {
    if (inspectionIds.length === 0)
      throw new ServiceError("BATCH_INSPECTION_EMPTY", "请至少选择一件待验货商品。", 400);
    if (inspectionIds.length > 50)
      throw new ServiceError("BATCH_INSPECTION_TOO_MANY", "一次最多验货通过 50 件商品。", 400);
    if (new Set(inspectionIds).size !== inspectionIds.length)
      throw new ServiceError("BATCH_INSPECTION_DUPLICATE_IDS", "不能重复选择同一件待验货商品。", 400);

    try {
      return await db.$transaction(
        async (tx) => {
          const completed: Array<{
            inspection: { id: string };
            inventory: { id: string };
          }> = [];

          for (const inspectionId of inspectionIds) {
            const candidate = await tx.inspection.findFirst({
              where: { id: inspectionId, ownerId },
              select: {
                status: true,
                completedAt: true,
                inventoryItem: { select: { id: true } },
                purchaseOrderItem: { select: { purchaseOrder: { select: { status: true } } } },
              },
            });
            if (!candidate)
              throw new ServiceError("INSPECTION_NOT_FOUND", "待验货商品不存在。", 404);
            if (candidate.completedAt || candidate.inventoryItem)
              throw new ServiceError("INSPECTION_ALREADY_COMPLETED", "选中的商品已经完成验货，请刷新列表。", 409);
            if (
              !["PENDING", "IN_PROGRESS"].includes(candidate.status) ||
              candidate.purchaseOrderItem.purchaseOrder.status !== "PENDING_INSPECTION"
            )
              throw new ServiceError("INSPECTION_NOT_PENDING", "选中的商品当前不能验货，请刷新列表。", 409);

            completed.push(await this.completeTx(ownerId, inspectionId, { result: "PASS" }, tx));
          }

          return {
            processedCount: completed.length,
            inspectionIds: completed.map((item) => item.inspection.id),
            inventoryItemIds: completed.map((item) => item.inventory.id),
            skippedCount: 0,
          };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ServiceError("INSPECTION_BATCH_CONFLICT", "验货状态已变化，请刷新列表后重试。", 409);
      throw error;
    }
  }
}

export const inspectionService = new InspectionService();
