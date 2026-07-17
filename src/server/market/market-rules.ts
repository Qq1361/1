import { normalizeSku } from "@/lib/normalize-sku";

export type MarketQuoteLifecycleStatus = "UNCONFIRMED" | "CURRENT" | "EXPIRED" | "INVALIDATED" | "SUPERSEDED";
export type MarketQuoteAvailabilityReason = "NO_QUOTES" | "ONLY_UNCONFIRMED" | "ALL_INVALIDATED" | "ALL_EXPIRED" | "NO_EFFECTIVE_QUOTE";

export type MarketQuoteRuleInput = {
  id: string;
  confirmedAt: Date | null;
  invalidatedAt: Date | null;
  expiresAt: Date | null;
  recordedAt: Date;
  createdAt: Date;
};

export function normalizeMarketItemName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return normalized || null;
}

export function normalizeDisplayName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized || null;
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function normalizeMarketItemInput(input: {
  displayName?: string | null;
  skuText?: string | null;
  versionText?: string | null;
  conditionText?: string | null;
  packageVariant?: string | null;
  accessoryVariant?: string | null;
  note?: string | null;
}) {
  const displayName = normalizeDisplayName(input.displayName);
  return {
    displayName,
    normalizedName: normalizeMarketItemName(displayName),
    skuText: normalizeOptionalText(input.skuText),
    normalizedSku: normalizeSku(input.skuText),
    versionText: normalizeOptionalText(input.versionText),
    conditionText: normalizeOptionalText(input.conditionText),
    packageVariant: normalizeOptionalText(input.packageVariant),
    accessoryVariant: normalizeOptionalText(input.accessoryVariant),
    note: normalizeOptionalText(input.note),
  };
}

export function isQuoteCurrentlyEffective(quote: MarketQuoteRuleInput, asOf: Date): boolean {
  return quote.confirmedAt !== null
    && quote.invalidatedAt === null
    && quote.recordedAt <= asOf
    && (quote.expiresAt === null || quote.expiresAt > asOf);
}

/** Sorts newest first using the frozen recordedAt, createdAt, id tie-breakers. */
export function compareCurrentMarketQuotes(left: MarketQuoteRuleInput, right: MarketQuoteRuleInput): number {
  const recordedDiff = right.recordedAt.getTime() - left.recordedAt.getTime();
  if (recordedDiff !== 0) return recordedDiff;
  const createdDiff = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdDiff !== 0) return createdDiff;
  return right.id.localeCompare(left.id);
}

export function selectCurrentQuote<T extends MarketQuoteRuleInput>(quotes: T[], asOf: Date): T | null {
  return quotes.filter((quote) => isQuoteCurrentlyEffective(quote, asOf)).sort(compareCurrentMarketQuotes)[0] ?? null;
}

export function deriveQuoteLifecycleStatus(quote: MarketQuoteRuleInput, currentQuoteId: string | null, asOf: Date): MarketQuoteLifecycleStatus {
  if (quote.invalidatedAt) return "INVALIDATED";
  if (!quote.confirmedAt) return "UNCONFIRMED";
  if (quote.expiresAt && quote.expiresAt <= asOf) return "EXPIRED";
  if (quote.id === currentQuoteId) return "CURRENT";
  return "SUPERSEDED";
}

export function deriveAvailabilityReason(quotes: MarketQuoteRuleInput[], asOf: Date): MarketQuoteAvailabilityReason {
  if (!quotes.length) return "NO_QUOTES";
  if (quotes.every((quote) => quote.invalidatedAt !== null)) return "ALL_INVALIDATED";
  if (quotes.every((quote) => quote.confirmedAt === null || quote.invalidatedAt !== null)) return "ONLY_UNCONFIRMED";
  if (quotes.some((quote) => quote.confirmedAt && !quote.invalidatedAt && quote.expiresAt && quote.expiresAt <= asOf)) return "ALL_EXPIRED";
  return "NO_EFFECTIVE_QUOTE";
}

export function getMarketItemAvailableActions(isActive: boolean) {
  return { update: true, activate: !isActive, deactivate: isActive, createQuote: isActive };
}

export function getMarketQuoteAvailableActions(quote: Pick<MarketQuoteRuleInput, "confirmedAt" | "invalidatedAt">, marketItemIsActive: boolean) {
  const invalidated = quote.invalidatedAt !== null;
  return {
    confirm: marketItemIsActive && !invalidated && quote.confirmedAt === null,
    invalidate: !invalidated,
    correct: marketItemIsActive && !invalidated,
  };
}
