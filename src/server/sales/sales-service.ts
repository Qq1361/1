import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { calculateSaleProfit } from "./calculateSaleProfit";
import { normalizeSku } from "@/lib/normalize-sku";
import {
  isLegacyInventoryItemStatus,
  isSellableInventoryItemStatus,
  LEGACY_INVENTORY_STATUS_MESSAGE,
  LEGACY_PRE_SALE_STATUS_MESSAGE,
} from "@/lib/inventory-item-status-contract";
import {
  ACTIVE_SALES_AFTER_SALE_STATUSES,
  calculateMinimumRequiredActualReceived,
  outstandingApprovedAmount,
  sumDecimals,
} from "@/server/sales-after-sales/sales-after-sales-rules";
type SettlementStatus = "ALL" | "SETTLED" | "UNSETTLED";
type SettleInput = { actualReceivedAmount: string; settledAt?: string; note?: string };
type SettlementFilters = {
  platform?: string;
  settlementStatus?: SettlementStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
};

function saleNo() {
  const d = new Date();
  const day = d.toISOString().slice(0, 10).replaceAll("-", "");
  const seq = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SALE-${day}-${seq}`;
}

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2).toFixed(2);
}

function decimalToCents(value: Prisma.Decimal) {
  return value.mul(100).toDecimalPlaces(0).toNumber();
}

function centsToDecimal(cents: number) {
  return new Prisma.Decimal(cents).div(100);
}

function allocateProfitByLines(
  totalProfit: Prisma.Decimal,
  lines: { id: string; saleAmount: Prisma.Decimal }[],
) {
  if (lines.length === 0) return [];
  const totalCents = decimalToCents(totalProfit);
  if (lines.length === 1) return [{ lineId: lines[0].id, profitAmount: centsToDecimal(totalCents) }];

  const saleAmountCents = lines.map((line) => Math.max(0, decimalToCents(line.saleAmount)));
  const totalSaleAmountCents = saleAmountCents.reduce((sum, value) => sum + value, 0);
  const weights = totalSaleAmountCents > 0 ? saleAmountCents : lines.map(() => 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  let allocated = 0;
  return lines.map((line, index) => {
    const isLast = index === lines.length - 1;
    const lineCents = isLast ? totalCents - allocated : Math.trunc((totalCents * weights[index]) / totalWeight);
    allocated += lineCents;
    return { lineId: line.id, profitAmount: centsToDecimal(lineCents) };
  });
}

function serializeSettlement(order: Prisma.SaleOrderGetPayload<{
  include: { lines: true; feeLines: true; _count: { select: { lines: true } } };
}>) {
  const feeTotal = order.feeLines.reduce((sum, fee) => sum.plus(fee.amount), new Prisma.Decimal(0));
  const profitTotal = order.lines.reduce((sum, line) => sum.plus(line.profitAmount), new Prisma.Decimal(0));

  return {
    id: order.id,
    saleNo: order.saleNo,
    platform: order.platform,
    platformOrderNo: order.platformOrderNo,
    platformTradeNo: order.platformTradeNo,
    buyerName: order.buyerName,
    soldAt: order.soldAt.toISOString(),
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    settledAt: order.settledAt?.toISOString() ?? null,
    grossAmount: money(order.grossAmount),
    expectedIncome: order.expectedIncome ? money(order.expectedIncome) : null,
    actualReceivedAmount: order.actualReceivedAmount ? money(order.actualReceivedAmount) : null,
    shippingCost: money(order.shippingCost),
    otherCost: money(order.otherCost),
    feeTotal: money(feeTotal),
    profitTotal: money(profitTotal),
    status: order.status,
    lineCount: order._count.lines,
    itemsSummary: order.lines
      .map((line) => `${line.productNameSnapshot}${line.skuSnapshot ? ` ${line.skuSnapshot}` : ""}`)
      .join(" / "),
  };
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
      if (inv.ownershipStatus !== "OWNED") {
        throw new ServiceError("INVENTORY_NOT_OWNED", `库存 ${inv.inventoryCode} 已不属于当前库存资产，不能创建销售草稿。`, 409);
      }
      if (isLegacyInventoryItemStatus(inv.itemStatus)) {
        throw new ServiceError("LEGACY_INVENTORY_STATUS", LEGACY_INVENTORY_STATUS_MESSAGE, 409);
      }
      if (!isSellableInventoryItemStatus(inv.itemStatus)) {
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
        lineId: string; invId: string; skuText: string | null; preSaleItemStatus: string; preSaleSaleMode: string | null;
        preSaleStorageLocation: string | null; sourceShipmentBatchId: string | null; sourceShipmentLineId: string | null;
      }[] = [];

      for (const line of sale.lines) {
        const inv = await tx.inventoryItem.findUnique({ where: { id: line.inventoryItemId } });
        if (!inv) throw new ServiceError("ITEM_GONE", `库存 ${line.inventoryCodeSnapshot} 已不存在。`, 404);
        if (inv.ownerId !== ownerId || inv.ownershipStatus !== "OWNED") {
          throw new ServiceError("INVENTORY_NOT_OWNED", `库存 ${line.inventoryCodeSnapshot} 已不属于当前库存资产，不能确认销售。`, 409);
        }
        if (isLegacyInventoryItemStatus(inv.itemStatus)) {
          throw new ServiceError("LEGACY_INVENTORY_STATUS", LEGACY_INVENTORY_STATUS_MESSAGE, 409);
        }
        if (!isSellableInventoryItemStatus(inv.itemStatus)) {
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
          skuText: inv.skuText,
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
            skuSnapshot: normalizeSku(lu.skuText),
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
  async settle(ownerId: string, saleOrderId: string, input: SettleInput) {
    const sale = await db.saleOrder.findFirst({
      where: { id: saleOrderId, ownerId }, include: { lines: true, feeLines: true },
    });
    if (!sale) throw new ServiceError("SALE_NOT_FOUND", "销售订单不存在。", 404);
    if (!["CONFIRMED", "SETTLED"].includes(sale.status)) throw new ServiceError("NOT_CONFIRMED", "只有已确认的销售才能登记到账。", 409);

    const isResettle = sale.status === "SETTLED";
    const actualReceived = new Prisma.Decimal(input.actualReceivedAmount);
    if (actualReceived.isNegative()) {
      throw new ServiceError("INVALID_ACTUAL_RECEIVED_AMOUNT", "实际到账金额不能小于 0。", 400);
    }
    const parsedSettledAt = input.settledAt ? new Date(input.settledAt) : new Date();
    if (Number.isNaN(parsedSettledAt.getTime())) {
      throw new ServiceError("INVALID_SETTLED_AT", "到账时间格式无效。", 400);
    }

    await db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sale_orders" WHERE "id" = ${saleOrderId} AND "ownerId" = ${ownerId} FOR UPDATE`);
      const currentSale = await tx.saleOrder.findFirst({
        where: { id: saleOrderId, ownerId },
        include: { lines: true, feeLines: true },
      });
      if (!currentSale) throw new ServiceError("SALE_NOT_FOUND", "销售订单不存在。", 404);
      if (!["CONFIRMED", "SETTLED"].includes(currentSale.status)) throw new ServiceError("NOT_CONFIRMED", "只有已确认的销售才能登记到账。", 409);
      const [refunded, activeCases] = await Promise.all([
        tx.saleRefundRecord.aggregate({ where: { ownerId, saleOrderId }, _sum: { refundAmount: true } }),
        tx.saleAfterSaleCase.findMany({
          where: { ownerId, saleOrderId, status: { in: [...ACTIVE_SALES_AFTER_SALE_STATUSES] } },
          include: { lines: { include: { refundAllocations: true } } },
        }),
      ]);
      const completedRefund = refunded._sum.refundAmount ?? new Prisma.Decimal(0);
      const lockedApproved = sumDecimals(activeCases.flatMap((afterSaleCase) =>
        afterSaleCase.lines.map((line) => outstandingApprovedAmount(line.approvedRefundAmount, line.refundAllocations.map((allocation) => allocation.amount))),
      ));
      const minimumRequired = calculateMinimumRequiredActualReceived(completedRefund, lockedApproved);
      if (actualReceived.lessThan(minimumRequired)) {
        throw new ServiceError("ACTUAL_RECEIVED_BELOW_AFTER_SALE_COMMITMENTS", `实际到账不能低于已退款及已锁定售后金额 ${minimumRequired.toFixed(2)}。`, 409);
      }
      await tx.saleOrder.update({
        where: { id: saleOrderId },
        data: { status: "SETTLED", settledAt: currentSale.settledAt ?? parsedSettledAt, actualReceivedAmount: actualReceived },
      });

      // Recalculate profit with actual received
      const invCostTotal = currentSale.lines.reduce((sum, l) => sum.plus(l.unitCostSnapshot), new Prisma.Decimal(0));
      const feeLinesTotal = currentSale.feeLines.reduce((sum, fl) => sum.plus(fl.amount), new Prisma.Decimal(0));
      const result = calculateSaleProfit({
        grossAmount: currentSale.grossAmount, expectedIncome: currentSale.expectedIncome,
        actualReceivedAmount: actualReceived,
        shippingCost: currentSale.shippingCost, otherCost: currentSale.otherCost,
        inventoryCostTotal: invCostTotal, feeLinesTotal,
      });

      const allocations = allocateProfitByLines(result.profit, currentSale.lines);
      for (const allocation of allocations) {
        await tx.saleLine.update({
          where: { id: allocation.lineId },
          data: { profitAmount: allocation.profitAmount },
        });
      }
      const userNote = input.note?.trim();
      if (userNote) {
        await tx.saleActionLog.create({
          data: {
            ownerId,
            saleOrderId,
            actionType: isResettle ? "RESETTLED_NOTE" : "SETTLED_NOTE",
            note: userNote,
          },
        });
      }

      await tx.saleActionLog.create({ data: { ownerId, saleOrderId, actionType: isResettle ? "RESETTLED" : "SETTLED", note: `到账=${actualReceived}，利润=${result.profit}，口径=${result.incomeBasis}` } });
    });

    return db.saleOrder.findUniqueOrThrow({ where: { id: saleOrderId }, include: { lines: true, feeLines: true, actionLogs: { orderBy: { createdAt: "desc" }, take: 20 } } });
  }

  async listSettlements(ownerId: string, filters: SettlementFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const settlementStatus = filters.settlementStatus ?? "ALL";
    const keyword = filters.keyword?.trim();

    const where: Prisma.SaleOrderWhereInput = {
      ownerId,
      status: { in: ["CONFIRMED", "SETTLED"] },
    };
    if (filters.platform) where.platform = filters.platform;
    if (settlementStatus === "SETTLED") where.status = "SETTLED";
    if (settlementStatus === "UNSETTLED") {
      where.status = "CONFIRMED";
      where.actualReceivedAmount = null;
    }
    if (keyword) {
      where.OR = [
        { saleNo: { contains: keyword, mode: "insensitive" } },
        { platformOrderNo: { contains: keyword, mode: "insensitive" } },
        { platformTradeNo: { contains: keyword, mode: "insensitive" } },
        { buyerName: { contains: keyword, mode: "insensitive" } },
        { lines: { some: { inventoryCodeSnapshot: { contains: keyword, mode: "insensitive" } } } },
        { lines: { some: { productNameSnapshot: { contains: keyword, mode: "insensitive" } } } },
        { lines: { some: { skuSnapshot: { contains: keyword, mode: "insensitive" } } } },
      ];
    }

    const [orders, total] = await Promise.all([
      db.saleOrder.findMany({
        where,
        include: {
          lines: true,
          feeLines: true,
          _count: { select: { lines: true } },
        },
        orderBy: [{ status: "asc" }, { soldAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.saleOrder.count({ where }),
    ]);

    return {
      data: orders.map(serializeSettlement),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
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
      const legacySnapshot = sale.lines.find((line) => isLegacyInventoryItemStatus(line.preSaleItemStatus));
      if (legacySnapshot) {
        throw new ServiceError("LEGACY_PRE_SALE_STATUS", LEGACY_PRE_SALE_STATUS_MESSAGE, 409);
      }
      for (const line of sale.lines) {
        const inv = await tx.inventoryItem.findUnique({ where: { id: line.inventoryItemId } });
        if (!inv || inv.itemStatus !== "SOLD") continue;

        const restoreStatus = line.preSaleItemStatus || "STOCKED";
        const restoreSaleMode = line.preSaleSaleMode || "NONE";
        const restoreLocation = line.preSaleStorageLocation || inv.storageLocation;

        await tx.inventoryItem.update({
          where: { id: line.inventoryItemId },
          data: {
            itemStatus: restoreStatus as "PENDING_INSPECTION" | "STOCKED" | "PLATFORM_SHIPPED" | "PLATFORM_RECEIVED" | "PLATFORM_IN_WAREHOUSE" | "PLATFORM_LISTED" | "PLATFORM_REJECTED" | "RETURNING" | "RETURNED" | "SOLD" | "PROBLEM",
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
