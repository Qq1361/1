import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { marketConflictError, marketNotFoundError, marketValidationError } from "./market-errors";
import { getMarketItemAvailableActions, normalizeMarketItemInput } from "./market-rules";

type MarketItemInput = {
  displayName?: string | null;
  skuText?: string | null;
  versionText?: string | null;
  conditionText?: string | null;
  packageVariant?: string | null;
  accessoryVariant?: string | null;
  defaultTargetProfitAmount?: string | number | Prisma.Decimal | null;
  note?: string | null;
};

function parseTargetProfit(value: MarketItemInput["defaultTargetProfitAmount"]) {
  if (value == null || value === "") return null;
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(value);
  } catch {
    throw marketValidationError("MARKET_TARGET_PROFIT_INVALID", "默认目标利润金额无效。");
  }
  if (!amount.isFinite() || amount.isNegative()) {
    throw marketValidationError("MARKET_TARGET_PROFIT_INVALID", "默认目标利润不能小于 0。");
  }
  return amount.toDecimalPlaces(2);
}

function requireName(input: ReturnType<typeof normalizeMarketItemInput>) {
  if (!input.displayName || !input.normalizedName) {
    throw marketValidationError("MARKET_ITEM_NAME_REQUIRED", "行情商品名称不能为空。");
  }
  return { displayName: input.displayName, normalizedName: input.normalizedName };
}

function duplicateWhere(ownerId: string, item: ReturnType<typeof normalizeMarketItemInput>) {
  return {
    ownerId,
    normalizedName: item.normalizedName!,
    normalizedSku: item.normalizedSku,
    versionText: item.versionText,
    conditionText: item.conditionText,
    packageVariant: item.packageVariant,
    accessoryVariant: item.accessoryVariant,
  };
}

async function findPotentialDuplicates(ownerId: string, item: ReturnType<typeof normalizeMarketItemInput>, excludeId?: string) {
  return db.marketItem.findMany({
    where: { ...duplicateWhere(ownerId, item), ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, displayName: true, skuText: true, versionText: true, conditionText: true, packageVariant: true, accessoryVariant: true, isActive: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 10,
  });
}

export class MarketItemService {
  async createMarketItem(ownerId: string, input: MarketItemInput) {
    const normalized = normalizeMarketItemInput(input);
    const requiredName = requireName(normalized);
    const defaultTargetProfitAmount = parseTargetProfit(input.defaultTargetProfitAmount);
    const potentialDuplicates = await findPotentialDuplicates(ownerId, normalized);
    const marketItem = await db.marketItem.create({ data: { ownerId, ...normalized, ...requiredName, defaultTargetProfitAmount } });
    return { marketItem, potentialDuplicates, warnings: potentialDuplicates.length ? ["POTENTIAL_DUPLICATE_MARKET_ITEM"] : [], availableActions: getMarketItemAvailableActions(marketItem.isActive) };
  }

  async updateMarketItem(ownerId: string, id: string, input: MarketItemInput) {
    const existing = await db.marketItem.findFirst({ where: { id, ownerId } });
    if (!existing) throw marketNotFoundError("MARKET_ITEM_NOT_FOUND");
    const normalized = normalizeMarketItemInput({
      displayName: input.displayName === undefined ? existing.displayName : input.displayName,
      skuText: input.skuText === undefined ? existing.skuText : input.skuText,
      versionText: input.versionText === undefined ? existing.versionText : input.versionText,
      conditionText: input.conditionText === undefined ? existing.conditionText : input.conditionText,
      packageVariant: input.packageVariant === undefined ? existing.packageVariant : input.packageVariant,
      accessoryVariant: input.accessoryVariant === undefined ? existing.accessoryVariant : input.accessoryVariant,
      note: input.note === undefined ? existing.note : input.note,
    });
    const requiredName = requireName(normalized);
    const defaultTargetProfitAmount = input.defaultTargetProfitAmount === undefined
      ? existing.defaultTargetProfitAmount
      : parseTargetProfit(input.defaultTargetProfitAmount);
    const marketItem = await db.marketItem.update({ where: { id }, data: { ...normalized, ...requiredName, defaultTargetProfitAmount } });
    const potentialDuplicates = await findPotentialDuplicates(ownerId, normalized, id);
    return { marketItem, potentialDuplicates, warnings: potentialDuplicates.length ? ["POTENTIAL_DUPLICATE_MARKET_ITEM"] : [], availableActions: getMarketItemAvailableActions(marketItem.isActive) };
  }

  async setMarketItemActive(ownerId: string, id: string, isActive: boolean) {
    const marketItem = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "market_items" WHERE "id" = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`);
      if (!rows.length) throw marketNotFoundError("MARKET_ITEM_NOT_FOUND");
      return tx.marketItem.update({ where: { id }, data: { isActive } });
    });
    return { marketItem, availableActions: getMarketItemAvailableActions(marketItem.isActive) };
  }

  async assertActiveOwnedMarketItem(tx: Prisma.TransactionClient, ownerId: string, id: string) {
    const rows = await tx.$queryRaw<{ id: string; isActive: boolean }[]>(Prisma.sql`SELECT "id", "isActive" FROM "market_items" WHERE "id" = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`);
    const item = rows[0];
    if (!item) throw marketNotFoundError("MARKET_ITEM_NOT_FOUND");
    if (!item.isActive) throw marketConflictError("MARKET_ITEM_INACTIVE", "已停用的行情商品不能创建或确认报价。");
    return item;
  }
}

export const marketItemService = new MarketItemService();
