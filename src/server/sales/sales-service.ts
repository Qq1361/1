import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { calculateSaleProfit } from "./calculateSaleProfit";

const ALLOWED_ITEM_STATUSES = ["STOCKED", "PLATFORM_SHIPPED", "PLATFORM_RECEIVED", "PLATFORM_IN_WAREHOUSE", "PLATFORM_LISTED"];
const BLOCKED_ITEM_STATUSES = ["SOLD", "PROBLEM", "REMOVED", "RETURNING", "RETURNED", "PLATFORM_REJECTED"];

function saleNo() {
  const d = new Date();
  const day = d.toISOString().slice(0, 10).replaceAll("-", "");
  const seq = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SALE-${day}-${seq}`;
}

export class SalesService {

  // ===================== CREATE DRAFT =====================
  async createDraft(
    ownerId: string,
    input: {
      platform: string;
      platformOrderNo?: string; platformTradeNo?: string; buyerName?: string;
      soldAt: string; grossAmount: string;
      expectedIncome?: string; actualReceivedAmount?: string;
      shippingCost?: string; otherCost?: string; note?: string;
      items: { inventoryItemId: string; saleAmount?: string }[];
      feeLines?: { feeType: string; amount: string; note?: string }[];
    },
  ) {
    if (!input.items.length) throw new ServiceError("NO_ITEMS", "请至少选择一件库存。", 422);

    // Validate items exist and are selectable
    const itemIds = input.items.map(i => i.inventoryItemId);
    const inventoryItems = await db.inventoryItem.findMany({ where: { id: { in: itemIds }, ownerId } });
    if (inventoryItems.length !== itemIds.length) throw new ServiceError("ITEMS_NOT_FOUND", "部分库存不存在。", 404);

    for (const inv of inventoryItems) {
      if (BLOCKED_ITEM_STATUSES.includes(inv.itemStatus)) {
        throw new ServiceError("ITEM_NOT_SELECTABLE", `库存 ${inv.inventoryCode} 状态为 ${inv.itemStatus}，不能销售。`, 409);
      }
    }

    const sNo = saleNo();
    const zero = new Prisma.Decimal(0);

    const sale = await db.$transaction(async (tx) => {
      const s = await tx.saleOrder.create({
        data: {
          ownerId, saleNo: sNo, platform: input.platform,
          platformOrderNo: input.platformOrderNo?.trim() || null,
          platformTradeNo: input.platformTradeNo?.trim() || null,
          buyerName: input.buyerName?.trim() || null,
          soldAt: new Date(input.soldAt),
          grossAmount: new Prisma.Decimal(input.grossAmount),
          expectedIncome: input.expectedIncome ? new Prisma.Decimal(input.expectedIncome) : null,
          actualReceivedAmount: input.actualReceivedAmount ? new Prisma.Decimal(input.actualReceivedAmount) : null,
          shippingCost: input.shippingCost ? new Prisma.Decimal(input.shippingCost) : zero,
          otherCost: input.otherCost ? new Prisma.Decimal(input.otherCost) : zero,
          note: input.note?.trim() || null,
        },
      });

      // Create lines
      for (const item of input.items) {
        const inv = inventoryItems.find(i => i.id === item.inventoryItemId)!;
        await tx.saleLine.create({
          data: {
            ownerId, saleOrderId: s.id, inventoryItemId: inv.id,
            inventoryCodeSnapshot: inv.inventoryCode,
            productNameSnapshot: inv.name,
            skuSnapshot: inv.skuText,
            unitCostSnapshot: inv.unitCost,
            saleAmount: item.saleAmount ? new Prisma.Decimal(item.saleAmount) : zero,
            costAmount: inv.unitCost,
            profitAmount: zero,
            sourcePurchaseOrderId: inv.purchaseOrderItemId,
            sourceShipmentBatchId: null, sourceShipmentLineId: null,
            preSaleItemStatus: inv.itemStatus,
            preSaleSaleMode: inv.saleMode,
            preSaleStorageLocation: inv.storageLocation,
          },
        });
      }

      // Create fee lines
      if (input.feeLines?.length) {
        for (const fl of input.feeLines) {
          await tx.saleFeeLine.create({
            data: {
              ownerId, saleOrderId: s.id,
              feeType: fl.feeType as "PLATFORM_COMMISSION" | "AUTHENTICATION" | "SHIPPING" | "PACKAGING" | "OTHER",
              amount: new Prisma.Decimal(fl.amount),
              note: fl.note?.trim() || null,
            },
          });
        }
      }

      await tx.saleActionLog.create({ data: { ownerId, saleOrderId: s.id, actionType: "CREATED_DRAFT", note: `创建销售草稿，${input.items.length} 件库存` } });
      return s;
    });

    return { ...sale, lines: await db.saleLine.findMany({ where: { saleOrderId: sale.id } }), feeLines: await db.saleFeeLine.findMany({ where: { saleOrderId: sale.id } }) };
  }

  // ===================== CONFIRM =====================
  async confirm(ownerId: string, saleOrderId: string) {
    const sale = await db.saleOrder.findFirst({
      where: { id: saleOrderId, ownerId },
      include: { lines: true, feeLines: true },
    });
    if (!sale) throw new ServiceError("SALE_NOT_FOUND", "销售订单不存在。", 404);
    if (sale.status !== "DRAFT") throw new ServiceError("NOT_DRAFT", "只有草稿销售订单才能确认。", 409);

    await db.$transaction(async (tx) => {
      // Re-read each inventory item's current state
      const lineUpdates: {
        lineId: string; invId: string; preSaleItemStatus: string; preSaleSaleMode: string | null;
        preSaleStorageLocation: string | null; sourceShipmentBatchId: string | null; sourceShipmentLineId: string | null;
      }[] = [];

      for (const line of sale.lines) {
        const inv = await tx.inventoryItem.findUnique({ where: { id: line.inventoryItemId } });
        if (!inv) throw new ServiceError("ITEM_GONE", `库存 ${line.inventoryCodeSnapshot} 已不存在。`, 404);
        if (BLOCKED_ITEM_STATUSES.includes(inv.itemStatus)) {
          throw new ServiceError("ITEM_BLOCKED", `库存 ${inv.inventoryCode} 当前状态为 ${inv.itemStatus}，不能确认销售。`, 409);
        }
        // Anti-duplicate: check no other CONFIRMED/SETTLED sale line for this item
        const dup = await tx.saleLine.findFirst({
          where: {
            inventoryItemId: inv.id,
            saleOrderId: { not: saleOrderId },
            saleOrder: { status: { in: ["CONFIRMED", "SETTLED"] } },
          },
        });
        if (dup) throw new ServiceError("DUPLICATE_SALE", `库存 ${inv.inventoryCode} 已被其他销售订单占用。`, 409);

        // Find current shipment info
        const activeShipLine = await tx.platformShipmentLine.findFirst({
          where: { inventoryItemId: inv.id, lineStatus: { notIn: ["RETURNED", "CANCELLED"] } },
          orderBy: { createdAt: "desc" },
        });

        lineUpdates.push({
          lineId: line.id, invId: inv.id,
          preSaleItemStatus: inv.itemStatus,
          preSaleSaleMode: inv.saleMode,
          preSaleStorageLocation: inv.storageLocation,
          sourceShipmentBatchId: activeShipLine?.batchId ?? null,
          sourceShipmentLineId: activeShipLine?.id ?? null,
        });
      }

      // Refresh snapshot + set SOLD
      for (const lu of lineUpdates) {
        await tx.saleLine.update({
          where: { id: lu.lineId },
          data: {
            preSaleItemStatus: lu.preSaleItemStatus,
            preSaleSaleMode: lu.preSaleSaleMode,
            preSaleStorageLocation: lu.preSaleStorageLocation,
            sourceShipmentBatchId: lu.sourceShipmentBatchId,
            sourceShipmentLineId: lu.sourceShipmentLineId,
          },
        });
        await tx.inventoryItem.update({ where: { id: lu.invId }, data: { itemStatus: "SOLD" } });
      }

      // Recalculate profit
      const updatedLines = await tx.saleLine.findMany({ where: { saleOrderId } });
      const invCostTotal = updatedLines.reduce((sum, l) => sum.plus(l.unitCostSnapshot), new Prisma.Decimal(0));
      const feeLinesTotal = sale.feeLines.reduce((sum, fl) => sum.plus(fl.amount), new Prisma.Decimal(0));
      const result = calculateSaleProfit({
        grossAmount: sale.grossAmount,
        expectedIncome: sale.expectedIncome,
        actualReceivedAmount: sale.actualReceivedAmount,
        shippingCost: sale.shippingCost,
        otherCost: sale.otherCost,
        inventoryCostTotal: invCostTotal,
        feeLinesTotal,
      });

      await tx.saleOrder.update({
        where: { id: saleOrderId },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });
      await tx.saleActionLog.create({ data: { ownerId, saleOrderId, actionType: "CONFIRMED", note: `确认销售，利润=${result.profit}，口径=${result.incomeBasis}` } });
    });

    return db.saleOrder.findUniqueOrThrow({ where: { id: saleOrderId }, include: { lines: true, feeLines: true, actionLogs: { orderBy: { createdAt: "desc" }, take: 20 } } });
  }

  // ===================== SETTLE =====================
  async settle(ownerId: string, saleOrderId: string, input: { actualReceivedAmount: string }) {
    const sale = await db.saleOrder.findFirst({
      where: { id: saleOrderId, ownerId }, include: { lines: true, feeLines: true },
    });
    if (!sale) throw new ServiceError("SALE_NOT_FOUND", "销售订单不存在。", 404);
    if (!["CONFIRMED", "SETTLED"].includes(sale.status)) throw new ServiceError("NOT_CONFIRMED", "只有已确认的销售才能登记到账。", 409);

    const isResettle = sale.status === "SETTLED";

    await db.$transaction(async (tx) => {
      const actualReceived = new Prisma.Decimal(input.actualReceivedAmount);
      await tx.saleOrder.update({
        where: { id: saleOrderId },
        data: { status: "SETTLED", settledAt: sale.settledAt ?? new Date(), actualReceivedAmount: actualReceived },
      });

      // Recalculate profit with actual received
      const invCostTotal = sale.lines.reduce((sum, l) => sum.plus(l.unitCostSnapshot), new Prisma.Decimal(0));
      const feeLinesTotal = sale.feeLines.reduce((sum, fl) => sum.plus(fl.amount), new Prisma.Decimal(0));
      const result = calculateSaleProfit({
        grossAmount: sale.grossAmount, expectedIncome: sale.expectedIncome,
        actualReceivedAmount: actualReceived,
        shippingCost: sale.shippingCost, otherCost: sale.otherCost,
        inventoryCostTotal: invCostTotal, feeLinesTotal,
      });

      await tx.saleActionLog.create({ data: { ownerId, saleOrderId, actionType: isResettle ? "RESETTLED" : "SETTLED", note: `到账=${actualReceived}，利润=${result.profit}，口径=${result.incomeBasis}` } });
    });

    return db.saleOrder.findUniqueOrThrow({ where: { id: saleOrderId }, include: { lines: true, feeLines: true, actionLogs: { orderBy: { createdAt: "desc" }, take: 20 } } });
  }

  // ===================== CANCEL =====================
  async cancel(ownerId: string, saleOrderId: string) {
    const sale = await db.saleOrder.findFirst({
      where: { id: saleOrderId, ownerId }, include: { lines: true },
    });
    if (!sale) throw new ServiceError("SALE_NOT_FOUND", "销售订单不存在。", 404);
    if (sale.status === "CANCELLED") throw new ServiceError("ALREADY_CANCELLED", "销售订单已被取消。", 409);
    if (sale.status === "SETTLED") throw new ServiceError("SETTLED_CANNOT_CANCEL", "已到账销售暂不支持直接取消，请后续走退款/退货流程。", 409);

    await db.$transaction(async (tx) => {
      if (sale.status === "DRAFT") {
        // Just cancel, no inventory change
        await tx.saleOrder.update({ where: { id: saleOrderId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
        await tx.saleActionLog.create({ data: { ownerId, saleOrderId, actionType: "CANCELLED", note: "草稿取消" } });
        return;
      }

      // CONFIRMED: restore inventory to pre-sale state
      for (const line of sale.lines) {
        const inv = await tx.inventoryItem.findUnique({ where: { id: line.inventoryItemId } });
        if (!inv || inv.itemStatus !== "SOLD") continue;

        const restoreStatus = line.preSaleItemStatus || "STOCKED";
        const restoreSaleMode = line.preSaleSaleMode || "NONE";
        const restoreLocation = line.preSaleStorageLocation || inv.storageLocation;

        await tx.inventoryItem.update({
          where: { id: line.inventoryItemId },
          data: {
            itemStatus: restoreStatus as "STOCKED" | "PLATFORM_SHIPPED" | "PLATFORM_RECEIVED" | "PLATFORM_IN_WAREHOUSE" | "PLATFORM_LISTED" | "PLATFORM_REJECTED" | "RETURNING" | "RETURNED" | "SOLD" | "PROBLEM",
            saleMode: restoreSaleMode as "NONE" | "DEWU_LIGHTNING" | "DEWU_STANDARD" | "NINETY_FIVE" | "XIANYU" | "OTHER",
            storageLocation: restoreLocation || null,
          },
        });
      }

      await tx.saleOrder.update({ where: { id: saleOrderId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      await tx.saleActionLog.create({ data: { ownerId, saleOrderId, actionType: "CANCELLED", note: `已确认销售取消，恢复 ${sale.lines.length} 件库存` } });
    });

    return db.saleOrder.findUniqueOrThrow({ where: { id: saleOrderId }, include: { lines: true, actionLogs: { orderBy: { createdAt: "desc" }, take: 20 } } });
  }
}

export const salesService = new SalesService();
