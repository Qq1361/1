import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { normalizeSku } from "@/lib/normalize-sku";

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

  async list(ownerId: string, query?: string) {
    const inspections = await db.inspection.findMany({
      where: {
        ownerId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        purchaseOrderItem: {
          purchaseOrder: { status: "PENDING_INSPECTION" },
          ...(query
            ? {
                OR: [
                  { name: { contains: query, mode: "insensitive" } },
                  { skuText: { contains: query, mode: "insensitive" } },
                  {
                    purchaseOrder: {
                      orderNo: { contains: query, mode: "insensitive" },
                    },
                  },
                ],
              }
            : {}),
        },
      },
      include: { purchaseOrderItem: { include: { purchaseOrder: true } } },
      orderBy: { createdAt: "asc" },
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
    return { data: inspections, missingCount };
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

    if (isCompleted && inspection.inventoryItem && (storageLoc !== undefined || skuText !== undefined || inspectionData.expiryDate !== undefined || resultChange)) {
      // Sync changes to InventoryItem in a transaction
      return db.$transaction(async (tx) => {
        const invUpdate: Record<string, unknown> = {};
        if (storageLoc !== undefined) invUpdate.storageLocation = storageLoc.trim() || null;
        if (skuText !== undefined) invUpdate.skuText = normalizeSku(skuText);
        if (inspectionData.expiryDate !== undefined) invUpdate.expiryDate = inspectionData.expiryDate;
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
              expiryDate: updatedInspection.expiryDate,
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
