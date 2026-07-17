import { Prisma } from "@/generated/prisma/client";
import { MarketPlatform, MarketQuoteSourceType, MarketQuoteType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { marketItemService } from "./market-item-service";
import { marketConflictError, marketNotFoundError, marketValidationError } from "./market-errors";
import { deriveQuoteLifecycleStatus, getMarketQuoteAvailableActions, normalizeOptionalText, selectCurrentQuote } from "./market-rules";

type QuoteCreateInput = {
  marketItemId: string;
  platform: MarketPlatform;
  quoteType: MarketQuoteType;
  amount: string | number | Prisma.Decimal;
  recordedAt: string | Date;
  expiresAt?: string | Date | null;
  sourceReference?: string | null;
  note?: string | null;
  confirmImmediately?: boolean;
  now?: Date;
};

function parseAmount(value: QuoteCreateInput["amount"]) {
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(value);
  } catch {
    throw marketValidationError("MARKET_QUOTE_AMOUNT_INVALID", "行情金额无效。");
  }
  if (!amount.isFinite() || amount.isNegative()) throw marketValidationError("MARKET_QUOTE_AMOUNT_INVALID", "行情金额不能小于 0。");
  return amount.toDecimalPlaces(2);
}

function parseDate(value: string | Date, code: string, label: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw marketValidationError(code, `${label}无效。`);
  return date;
}

function normalizeQuoteCreateInput(input: Pick<QuoteCreateInput, "amount" | "recordedAt" | "expiresAt" | "sourceReference" | "note" | "now">) {
  const now = input.now ?? new Date();
  const recordedAt = parseDate(input.recordedAt, "MARKET_QUOTE_TIME_INVALID", "行情记录时间");
  if (recordedAt > now) throw marketValidationError("MARKET_QUOTE_TIME_INVALID", "行情记录时间不能晚于当前时间。");
  const expiresAt = input.expiresAt == null || input.expiresAt === "" ? null : parseDate(input.expiresAt, "MARKET_QUOTE_TIME_INVALID", "行情有效期");
  if (expiresAt && expiresAt <= recordedAt) throw marketValidationError("MARKET_QUOTE_TIME_INVALID", "行情有效期必须晚于记录时间。");
  return {
    amount: parseAmount(input.amount), recordedAt, expiresAt, now,
    sourceReference: normalizeOptionalText(input.sourceReference), note: normalizeOptionalText(input.note),
  };
}

async function getOwnedQuote(tx: Prisma.TransactionClient, ownerId: string, id: string) {
  const quote = await tx.marketQuote.findFirst({ where: { id, ownerId }, include: { marketItem: true } });
  if (!quote) throw marketNotFoundError("MARKET_QUOTE_NOT_FOUND");
  return quote;
}

function quoteResult(quote: Awaited<ReturnType<typeof getOwnedQuote>>, asOf: Date) {
  return {
    quote,
    marketItem: { id: quote.marketItem.id, displayName: quote.marketItem.displayName, isActive: quote.marketItem.isActive },
    lifecycleStatus: deriveQuoteLifecycleStatus(quote, null, asOf),
    availableActions: getMarketQuoteAvailableActions(quote, quote.marketItem.isActive),
  };
}

export class MarketQuoteService {
  async createMarketQuote(ownerId: string, input: QuoteCreateInput) {
    const normalized = normalizeQuoteCreateInput(input);
    return db.$transaction(async (tx) => {
      await marketItemService.assertActiveOwnedMarketItem(tx, ownerId, input.marketItemId);
      const quote = await tx.marketQuote.create({
        data: {
          ownerId, marketItemId: input.marketItemId, platform: input.platform, quoteType: input.quoteType,
          amount: normalized.amount, recordedAt: normalized.recordedAt, expiresAt: normalized.expiresAt,
          sourceType: MarketQuoteSourceType.MANUAL, sourceReference: normalized.sourceReference, note: normalized.note,
          confirmedAt: input.confirmImmediately ? normalized.now : null,
        },
        include: { marketItem: true },
      });
      return quoteResult(quote, normalized.now);
    });
  }

  async confirmMarketQuote(ownerId: string, quoteId: string, now = new Date()) {
    return db.$transaction(async (tx) => {
      const quote = await getOwnedQuote(tx, ownerId, quoteId);
      if (quote.invalidatedAt) throw marketConflictError("MARKET_QUOTE_INVALIDATED", "已失效的行情报价不能确认。");
      if (!quote.marketItem.isActive) throw marketConflictError("MARKET_ITEM_INACTIVE", "已停用的行情商品不能确认报价。");
      if (quote.confirmedAt) return quoteResult(quote, now);
      const updated = await tx.marketQuote.updateMany({ where: { id: quoteId, ownerId, confirmedAt: null, invalidatedAt: null }, data: { confirmedAt: now } });
      if (updated.count !== 1) {
        const latest = await getOwnedQuote(tx, ownerId, quoteId);
        if (latest.invalidatedAt) throw marketConflictError("MARKET_QUOTE_INVALIDATED", "已失效的行情报价不能确认。");
        return quoteResult(latest, now);
      }
      return quoteResult(await getOwnedQuote(tx, ownerId, quoteId), now);
    });
  }

  async invalidateMarketQuote(ownerId: string, quoteId: string, reason: string, now = new Date()) {
    const normalizedReason = normalizeOptionalText(reason);
    if (!normalizedReason) throw marketValidationError("MARKET_QUOTE_INVALIDATION_REASON_REQUIRED", "失效原因不能为空。");
    return db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "market_quotes" WHERE "id" = ${quoteId} AND "ownerId" = ${ownerId} FOR UPDATE`);
      const quote = await getOwnedQuote(tx, ownerId, quoteId);
      if (quote.invalidatedAt) {
        if (quote.invalidationReason === normalizedReason) return quoteResult(quote, now);
        throw marketConflictError("MARKET_QUOTE_ALREADY_FINALIZED", "行情报价已按其他原因失效，不能覆盖原失效原因。");
      }
      await tx.marketQuote.update({ where: { id: quoteId }, data: { invalidatedAt: now, invalidationReason: normalizedReason } });
      return quoteResult(await getOwnedQuote(tx, ownerId, quoteId), now);
    });
  }

  async correctMarketQuote(ownerId: string, originalQuoteId: string, input: Omit<QuoteCreateInput, "marketItemId"> & { invalidationReason: string; now?: Date }) {
    const normalized = normalizeQuoteCreateInput(input);
    const reason = normalizeOptionalText(input.invalidationReason);
    if (!reason) throw marketValidationError("MARKET_QUOTE_INVALIDATION_REASON_REQUIRED", "修正原因不能为空。");
    return db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "market_quotes" WHERE "id" = ${originalQuoteId} AND "ownerId" = ${ownerId} FOR UPDATE`);
      const originalQuote = await getOwnedQuote(tx, ownerId, originalQuoteId);
      if (originalQuote.invalidatedAt) throw marketConflictError("MARKET_QUOTE_CORRECTION_CONFLICT", "行情报价已失效，不能再次修正。");
      if (!originalQuote.marketItem.isActive) throw marketConflictError("MARKET_ITEM_INACTIVE", "已停用的行情商品不能创建修正报价。");
      await tx.marketQuote.update({ where: { id: originalQuoteId }, data: { invalidatedAt: normalized.now, invalidationReason: reason } });
      const replacementQuote = await tx.marketQuote.create({
        data: {
          ownerId, marketItemId: originalQuote.marketItemId, platform: input.platform, quoteType: input.quoteType,
          amount: normalized.amount, recordedAt: normalized.recordedAt, expiresAt: normalized.expiresAt,
          sourceType: MarketQuoteSourceType.MANUAL, sourceReference: normalized.sourceReference, note: normalized.note,
          confirmedAt: input.confirmImmediately ? normalized.now : null,
        }, include: { marketItem: true },
      });
      return { originalQuote: quoteResult(await getOwnedQuote(tx, ownerId, originalQuoteId), normalized.now), replacementQuote: quoteResult(replacementQuote, normalized.now) };
    }, { isolationLevel: "Serializable" });
  }

  async selectCurrentMarketQuote(ownerId: string, input: { marketItemId: string; platform: MarketPlatform; quoteType: MarketQuoteType; asOf?: Date }) {
    const asOf = input.asOf ?? new Date();
    const item = await db.marketItem.findFirst({ where: { id: input.marketItemId, ownerId }, select: { id: true } });
    if (!item) throw marketNotFoundError("MARKET_ITEM_NOT_FOUND");
    const quotes = await db.marketQuote.findMany({ where: { ownerId, marketItemId: input.marketItemId, platform: input.platform, quoteType: input.quoteType }, orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] });
    return selectCurrentQuote(quotes, asOf);
  }
}

export const marketQuoteService = new MarketQuoteService();
