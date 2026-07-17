import { Prisma } from "@/generated/prisma/client";
import { MarketPlatform, MarketQuoteType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { marketNotFoundError } from "./market-errors";
import {
  deriveAvailabilityReason,
  deriveQuoteLifecycleStatus,
  getMarketItemAvailableActions,
  getMarketQuoteAvailableActions,
  selectCurrentQuote,
} from "./market-rules";

const PLATFORMS = Object.values(MarketPlatform);
const QUOTE_TYPES = Object.values(MarketQuoteType);
const MAX_PAGE_SIZE = 100;

type QuoteWithItem = Prisma.MarketQuoteGetPayload<{ include: { marketItem: true } }>;
type MarketItemWithQuotes = Prisma.MarketItemGetPayload<{ include: { quotes: true } }>;

const money = (value: Prisma.Decimal | null | undefined) => value == null ? null : value.toDecimalPlaces(2).toFixed(2);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

function pageInput(page?: number, pageSize?: number) {
  const safePage = Number.isInteger(page) && page && page > 0 ? page : 1;
  const safePageSize = Number.isInteger(pageSize) && pageSize && pageSize > 0 ? Math.min(pageSize, MAX_PAGE_SIZE) : 20;
  return { page: safePage, pageSize: safePageSize };
}

function quoteDto(quote: QuoteWithItem | Prisma.MarketQuoteGetPayload<Record<string, never>>, currentQuoteId: string | null, asOf: Date) {
  return {
    id: quote.id,
    platform: quote.platform,
    quoteType: quote.quoteType,
    amount: quote.amount.toDecimalPlaces(2).toFixed(2),
    recordedAt: iso(quote.recordedAt),
    expiresAt: iso(quote.expiresAt),
    sourceType: quote.sourceType,
    sourceReference: quote.sourceReference,
    confirmedAt: iso(quote.confirmedAt),
    invalidatedAt: iso(quote.invalidatedAt),
    invalidationReason: quote.invalidationReason,
    note: quote.note,
    lifecycleStatus: deriveQuoteLifecycleStatus(quote, currentQuoteId, asOf),
    createdAt: iso(quote.createdAt),
    updatedAt: iso(quote.updatedAt),
  };
}

function latestQuote<T extends { id: string; recordedAt: Date; createdAt: Date }>(quotes: T[]) {
  return [...quotes].sort((left, right) => {
    const recorded = right.recordedAt.getTime() - left.recordedAt.getTime();
    if (recorded) return recorded;
    const created = right.createdAt.getTime() - left.createdAt.getTime();
    if (created) return created;
    return right.id.localeCompare(left.id);
  })[0] ?? null;
}

function currentQuoteIdFor(quotes: Prisma.MarketQuoteGetPayload<Record<string, never>>[], quote: Prisma.MarketQuoteGetPayload<Record<string, never>>, asOf: Date) {
  return selectCurrentQuote(quotes.filter((candidate) => candidate.marketItemId === quote.marketItemId && candidate.platform === quote.platform && candidate.quoteType === quote.quoteType), asOf)?.id ?? null;
}

function quoteBucket(quotes: Prisma.MarketQuoteGetPayload<Record<string, never>>[], asOf: Date) {
  const currentQuote = selectCurrentQuote(quotes, asOf);
  const latest = latestQuote(quotes);
  return {
    currentQuote: currentQuote ? quoteDto(currentQuote, currentQuote.id, asOf) : null,
    latestQuote: latest ? quoteDto(latest, currentQuote?.id ?? null, asOf) : null,
    availabilityReason: currentQuote ? null : deriveAvailabilityReason(quotes, asOf),
  };
}

function itemDto(item: MarketItemWithQuotes, asOf: Date) {
  const quoteSummary = PLATFORMS.map((platform) => {
    const platformQuotes = item.quotes.filter((quote) => quote.platform === platform);
    const currentByType = (quoteType: MarketQuoteType) => selectCurrentQuote(platformQuotes.filter((quote) => quote.quoteType === quoteType), asOf);
    return {
      platform,
      expectedIncomeCurrentQuote: money(currentByType(MarketQuoteType.EXPECTED_INCOME)?.amount),
      listingPriceCurrentQuote: money(currentByType(MarketQuoteType.LISTING_PRICE)?.amount),
      manualReferenceCurrentQuote: money(currentByType(MarketQuoteType.MANUAL_REFERENCE)?.amount),
      latestRecordedAt: iso(latestQuote(platformQuotes)?.recordedAt),
    };
  });
  return {
    id: item.id,
    displayName: item.displayName,
    normalizedName: item.normalizedName,
    skuText: item.skuText,
    normalizedSku: item.normalizedSku,
    versionText: item.versionText,
    conditionText: item.conditionText,
    packageVariant: item.packageVariant,
    accessoryVariant: item.accessoryVariant,
    defaultTargetProfitAmount: money(item.defaultTargetProfitAmount),
    note: item.note,
    isActive: item.isActive,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
    quoteSummary,
    availableActions: getMarketItemAvailableActions(item.isActive),
  };
}

function itemDetailDto(item: MarketItemWithQuotes, asOf: Date, history: ReturnType<typeof historyDto>) {
  const currentQuotesByPlatform = PLATFORMS.map((platform) => ({
    platform,
    quoteTypes: QUOTE_TYPES.map((quoteType) => {
      const quotes = item.quotes.filter((quote) => quote.platform === platform && quote.quoteType === quoteType);
      return { quoteType, ...quoteBucket(quotes, asOf) };
    }),
  }));
  return {
    marketItem: itemDto(item, asOf),
    currentQuotesByPlatform,
    history,
    availableActions: getMarketItemAvailableActions(item.isActive),
  };
}

function historyDto(quotes: Prisma.MarketQuoteGetPayload<Record<string, never>>[], marketItemIsActive: boolean, asOf: Date, filters: MarketQuoteHistoryFilters) {
  const { page, pageSize } = pageInput(filters.page, filters.pageSize);
  const filtered = quotes.filter((quote) => {
    if (filters.platform && quote.platform !== filters.platform) return false;
    if (filters.quoteType && quote.quoteType !== filters.quoteType) return false;
    if (filters.lifecycleStatus && deriveQuoteLifecycleStatus(quote, currentQuoteIdFor(quotes, quote, asOf), asOf) !== filters.lifecycleStatus) return false;
    if (filters.dateFrom && quote.recordedAt < filters.dateFrom) return false;
    if (filters.dateTo && quote.recordedAt > filters.dateTo) return false;
    return true;
  }).sort((left, right) => {
    const recorded = right.recordedAt.getTime() - left.recordedAt.getTime();
    if (recorded) return recorded;
    const created = right.createdAt.getTime() - left.createdAt.getTime();
    if (created) return created;
    return right.id.localeCompare(left.id);
  });
  return {
    page,
    pageSize,
    total: filtered.length,
    items: filtered.slice((page - 1) * pageSize, page * pageSize).map((quote) => ({
      ...quoteDto(quote, currentQuoteIdFor(quotes, quote, asOf), asOf),
      marketItem: { id: quote.marketItemId },
      availableActions: getMarketQuoteAvailableActions(quote, marketItemIsActive),
    })),
  };
}

export type MarketQuoteHistoryFilters = {
  platform?: MarketPlatform;
  quoteType?: MarketQuoteType;
  lifecycleStatus?: "UNCONFIRMED" | "CURRENT" | "EXPIRED" | "INVALIDATED" | "SUPERSEDED";
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
};

export class MarketQuery {
  async getMarketQuote(ownerId: string, id: string, asOf = new Date()) {
    const quote = await db.marketQuote.findFirst({ where: { id, ownerId }, include: { marketItem: true } });
    if (!quote) throw marketNotFoundError("MARKET_QUOTE_NOT_FOUND");
    const bucket = await db.marketQuote.findMany({
      where: { ownerId, marketItemId: quote.marketItemId, platform: quote.platform, quoteType: quote.quoteType },
    });
    const currentQuoteId = selectCurrentQuote(bucket, asOf)?.id ?? null;
    return {
      ...quoteDto(quote, currentQuoteId, asOf),
      marketItem: { id: quote.marketItem.id, displayName: quote.marketItem.displayName, skuText: quote.marketItem.skuText, isActive: quote.marketItem.isActive },
      availableActions: getMarketQuoteAvailableActions(quote, quote.marketItem.isActive),
    };
  }

  async listMarketItems(ownerId: string, filters: {
    keyword?: string;
    platform?: MarketPlatform;
    quoteType?: MarketQuoteType;
    active?: boolean;
    hasCurrentQuote?: boolean;
    page?: number;
    pageSize?: number;
    asOf?: Date;
  }) {
    const asOf = filters.asOf ?? new Date();
    const { page, pageSize } = pageInput(filters.page, filters.pageSize);
    const keyword = filters.keyword?.trim();
    const quoteWhere = { ...(filters.platform ? { platform: filters.platform } : {}), ...(filters.quoteType ? { quoteType: filters.quoteType } : {}) };
    const items = await db.marketItem.findMany({
      where: {
        ownerId,
        ...(filters.active === undefined ? {} : { isActive: filters.active }),
        ...(keyword ? { OR: [
          { displayName: { contains: keyword, mode: "insensitive" } }, { normalizedName: { contains: keyword.toLocaleLowerCase("en-US"), mode: "insensitive" } },
          { skuText: { contains: keyword, mode: "insensitive" } }, { normalizedSku: { contains: keyword.toUpperCase(), mode: "insensitive" } },
          { versionText: { contains: keyword, mode: "insensitive" } }, { packageVariant: { contains: keyword, mode: "insensitive" } }, { accessoryVariant: { contains: keyword, mode: "insensitive" } },
        ] } : {}),
        ...(filters.platform || filters.quoteType ? { quotes: { some: quoteWhere } } : {}),
      },
      include: { quotes: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    const filtered = filters.hasCurrentQuote === undefined ? items : items.filter((item) => {
      const candidates = item.quotes.filter((quote) => (!filters.platform || quote.platform === filters.platform) && (!filters.quoteType || quote.quoteType === filters.quoteType));
      return Boolean(selectCurrentQuote(candidates, asOf)) === filters.hasCurrentQuote;
    });
    return { page, pageSize, total: filtered.length, items: filtered.slice((page - 1) * pageSize, page * pageSize).map((item) => itemDto(item, asOf)) };
  }

  async getMarketItemDetail(ownerId: string, id: string, filters: MarketQuoteHistoryFilters & { asOf?: Date } = {}) {
    const asOf = filters.asOf ?? new Date();
    const item = await db.marketItem.findFirst({ where: { id, ownerId }, include: { quotes: true } });
    if (!item) throw marketNotFoundError("MARKET_ITEM_NOT_FOUND");
    return itemDetailDto(item, asOf, historyDto(item.quotes, item.isActive, asOf, filters));
  }

  async listMarketQuotes(ownerId: string, filters: {
    marketItemId?: string;
    platform?: MarketPlatform;
    quoteType?: MarketQuoteType;
    confirmed?: boolean;
    invalidated?: boolean;
    effectiveAt?: Date;
    recordedFrom?: Date;
    recordedTo?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const asOf = filters.effectiveAt ?? new Date();
    const { page, pageSize } = pageInput(filters.page, filters.pageSize);
    const quotes = await db.marketQuote.findMany({
      where: {
        ownerId,
        ...(filters.marketItemId ? { marketItemId: filters.marketItemId } : {}), ...(filters.platform ? { platform: filters.platform } : {}), ...(filters.quoteType ? { quoteType: filters.quoteType } : {}),
        ...(filters.confirmed === undefined ? {} : { confirmedAt: filters.confirmed ? { not: null } : null }),
        ...(filters.invalidated === undefined ? {} : { invalidatedAt: filters.invalidated ? { not: null } : null }),
        ...(filters.recordedFrom || filters.recordedTo ? { recordedAt: { ...(filters.recordedFrom ? { gte: filters.recordedFrom } : {}), ...(filters.recordedTo ? { lte: filters.recordedTo } : {}) } } : {}),
      },
      include: { marketItem: true }, orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    const effective = filters.effectiveAt ? quotes.filter((quote) => Boolean(selectCurrentQuote([quote], asOf))) : quotes;
    return {
      page, pageSize, total: effective.length,
      items: effective.slice((page - 1) * pageSize, page * pageSize).map((quote) => ({
        ...quoteDto(quote, currentQuoteIdFor(quotes, quote, asOf), asOf),
        marketItem: { id: quote.marketItem.id, displayName: quote.marketItem.displayName, skuText: quote.marketItem.skuText, isActive: quote.marketItem.isActive },
        availableActions: getMarketQuoteAvailableActions(quote, quote.marketItem.isActive),
      })),
    };
  }
}

export const marketQuery = new MarketQuery();
