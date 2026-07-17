import { describe, expect, it } from "vitest";
import {
  compareCurrentMarketQuotes,
  deriveAvailabilityReason,
  deriveQuoteLifecycleStatus,
  getMarketItemAvailableActions,
  getMarketQuoteAvailableActions,
  isQuoteCurrentlyEffective,
  normalizeMarketItemInput,
  normalizeMarketItemName,
  selectCurrentQuote,
} from "@/server/market/market-rules";

const now = new Date("2026-07-16T12:00:00.000Z");
const quote = (id: string, overrides: Partial<{
  confirmedAt: Date | null; invalidatedAt: Date | null; expiresAt: Date | null; recordedAt: Date; createdAt: Date;
}> = {}) => ({
  id, confirmedAt: new Date("2026-07-16T10:00:00.000Z"), invalidatedAt: null, expiresAt: null,
  recordedAt: new Date("2026-07-16T09:00:00.000Z"), createdAt: new Date("2026-07-16T09:01:00.000Z"), ...overrides,
});

describe("M4 market rules", () => {
  it("normalizes names, optional text, and SKU through the existing SKU rule", () => {
    expect(normalizeMarketItemName("  DW　 Foundation   2C0  ")).toBe("dw foundation 2c0");
    expect(normalizeMarketItemInput({ displayName: "  DW   Foundation ", skuText: " 2c0 ", versionText: "  ", note: "  note  " })).toMatchObject({
      displayName: "DW Foundation", normalizedName: "dw foundation", skuText: "2c0", normalizedSku: "2C0", versionText: null, note: "note",
    });
  });

  it("selects only confirmed, unexpired, uninvalidated, nonfuture quotes with deterministic ordering", () => {
    const current = quote("b", { recordedAt: new Date("2026-07-16T10:00:00.000Z") });
    const earlier = quote("a", { recordedAt: new Date("2026-07-16T09:00:00.000Z") });
    expect(isQuoteCurrentlyEffective(quote("unconfirmed", { confirmedAt: null }), now)).toBe(false);
    expect(isQuoteCurrentlyEffective(quote("invalid", { invalidatedAt: now }), now)).toBe(false);
    expect(isQuoteCurrentlyEffective(quote("expired", { expiresAt: now }), now)).toBe(false);
    expect(isQuoteCurrentlyEffective(quote("future", { recordedAt: new Date("2026-07-16T13:00:00.000Z") }), now)).toBe(false);
    expect(selectCurrentQuote([earlier, current], now)?.id).toBe("b");
    expect(compareCurrentMarketQuotes(quote("a"), quote("b"))).toBeGreaterThan(0);
  });

  it("uses createdAt and id after recordedAt for deterministic current quote ordering", () => {
    const sameRecorded = new Date("2026-07-16T09:00:00.000Z");
    const newerCreated = quote("a", { recordedAt: sameRecorded, createdAt: new Date("2026-07-16T10:00:00.000Z") });
    const olderCreated = quote("z", { recordedAt: sameRecorded, createdAt: new Date("2026-07-16T09:30:00.000Z") });
    expect(selectCurrentQuote([olderCreated, newerCreated], now)?.id).toBe("a");
    const equalDatesA = quote("a", { recordedAt: sameRecorded, createdAt: sameRecorded });
    const equalDatesZ = quote("z", { recordedAt: sameRecorded, createdAt: sameRecorded });
    expect(selectCurrentQuote([equalDatesA, equalDatesZ], now)?.id).toBe("z");
  });

  it("derives lifecycle, availability, and action guards without database writes", () => {
    const current = quote("current");
    expect(deriveQuoteLifecycleStatus(quote("pending", { confirmedAt: null }), current.id, now)).toBe("UNCONFIRMED");
    expect(deriveQuoteLifecycleStatus(quote("invalid", { invalidatedAt: now }), current.id, now)).toBe("INVALIDATED");
    expect(deriveQuoteLifecycleStatus(quote("expired", { expiresAt: now }), current.id, now)).toBe("EXPIRED");
    expect(deriveQuoteLifecycleStatus(current, current.id, now)).toBe("CURRENT");
    expect(deriveQuoteLifecycleStatus(quote("old"), current.id, now)).toBe("SUPERSEDED");
    expect(deriveAvailabilityReason([], now)).toBe("NO_QUOTES");
    expect(deriveAvailabilityReason([quote("pending", { confirmedAt: null })], now)).toBe("ONLY_UNCONFIRMED");
    expect(deriveAvailabilityReason([quote("invalid", { invalidatedAt: now })], now)).toBe("ALL_INVALIDATED");
    expect(deriveAvailabilityReason([quote("expired", { expiresAt: now })], now)).toBe("ALL_EXPIRED");
    expect(getMarketItemAvailableActions(false)).toMatchObject({ activate: true, createQuote: false });
    expect(getMarketQuoteAvailableActions(quote("pending", { confirmedAt: null }), false)).toMatchObject({ confirm: false, invalidate: true, correct: false });
  });
});
