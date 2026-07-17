import { Prisma } from "@/generated/prisma/client";
import { MarketPlatform, MarketQuoteType } from "@/generated/prisma/enums";
import { marketNotFoundError } from "./market-errors";
import { marketQuery } from "./market-query";
import { comparePlatformDecisionResults, evaluatePurchaseDecision } from "./market-decision-rules";

const PLATFORMS = Object.values(MarketPlatform);
const money = (value: Prisma.Decimal | null) => value?.toDecimalPlaces(2).toFixed(2) ?? null;
const iso = (value: string | null) => value;

export type MarketPurchaseDecisionInput = {
  marketItemId: string;
  proposedPurchasePrice: string;
  targetProfitAmount: string;
  additionalCostAmount: string;
  platform?: MarketPlatform;
};

type QuoteDto = { id: string; platform: MarketPlatform; quoteType: MarketQuoteType; amount: string; recordedAt: string; expiresAt: string | null; sourceType: string; confirmedAt: string | null };

function decisionUnavailable(platform: MarketPlatform, reason: "MARKET_ITEM_INACTIVE" | "NO_CURRENT_QUOTE" | "NO_EXPECTED_INCOME" | "MISSING_FEE_RULE") {
  return {
    platform,
    calculationStatus: reason === "MARKET_ITEM_INACTIVE" ? "UNAVAILABLE" : reason,
    unavailableReason: reason,
    selectedQuote: null,
    expectedIncome: null,
    expectedProfit: null,
    profitGap: null,
    maxPurchasePrice: null,
    meetsTarget: null,
  };
}

export class MarketDecisionService {
  async calculatePurchaseDecision(ownerId: string, input: MarketPurchaseDecisionInput) {
    const now = new Date();
    const detail = await marketQuery.getMarketItemDetail(ownerId, input.marketItemId, { asOf: now });
    if (!detail.marketItem) throw marketNotFoundError("MARKET_ITEM_NOT_FOUND");

    const proposedPurchasePrice = new Prisma.Decimal(input.proposedPurchasePrice);
    const targetProfitAmount = new Prisma.Decimal(input.targetProfitAmount);
    const additionalCostAmount = new Prisma.Decimal(input.additionalCostAmount);
    const platforms = input.platform ? [input.platform] : PLATFORMS;
    if (!detail.marketItem.isActive) {
      return {
        marketItem: { id: detail.marketItem.id, displayName: detail.marketItem.displayName, isActive: false },
        proposedPurchasePrice: money(proposedPurchasePrice), targetProfitAmount: money(targetProfitAmount), additionalCostAmount: money(additionalCostAmount),
        calculatedAt: now.toISOString(), results: platforms.map((platform) => decisionUnavailable(platform, "MARKET_ITEM_INACTIVE")), comparablePlatformOrder: [],
      };
    }
    const results = platforms.map((platform) => {
      const bucket = detail.currentQuotesByPlatform.find((entry) => entry.platform === platform);
      const expectedIncome = bucket?.quoteTypes.find((entry) => entry.quoteType === MarketQuoteType.EXPECTED_INCOME)?.currentQuote as QuoteDto | null | undefined;
      if (!expectedIncome) {
        const listingPrice = bucket?.quoteTypes.find((entry) => entry.quoteType === MarketQuoteType.LISTING_PRICE)?.currentQuote;
        return decisionUnavailable(platform, listingPrice ? "MISSING_FEE_RULE" : "NO_EXPECTED_INCOME");
      }
      const values = evaluatePurchaseDecision({
        expectedIncome: new Prisma.Decimal(expectedIncome.amount), proposedPurchasePrice, targetProfitAmount, additionalCostAmount,
      });
      return {
        platform,
        calculationStatus: "READY" as const,
        unavailableReason: null,
        selectedQuote: { id: expectedIncome.id, platform: expectedIncome.platform, quoteType: expectedIncome.quoteType, recordedAt: iso(expectedIncome.recordedAt), expiresAt: iso(expectedIncome.expiresAt), sourceType: expectedIncome.sourceType, confirmedAt: iso(expectedIncome.confirmedAt) },
        expectedIncome: money(new Prisma.Decimal(expectedIncome.amount)),
        expectedProfit: money(values.expectedProfit),
        profitGap: money(values.profitGap),
        maxPurchasePrice: money(values.maxPurchasePrice),
        meetsTarget: values.meetsTarget,
      };
    });
    const comparablePlatformOrder = comparePlatformDecisionResults(
      results.filter((result): result is Extract<typeof result, { calculationStatus: "READY" }> => result.calculationStatus === "READY").map((result) => ({ platform: result.platform, calculationStatus: "READY" as const, expectedProfit: new Prisma.Decimal(result.expectedProfit!), maxPurchasePrice: new Prisma.Decimal(result.maxPurchasePrice!) })),
      PLATFORMS,
    ).map((result) => result.platform);
    return {
      marketItem: { id: detail.marketItem.id, displayName: detail.marketItem.displayName, isActive: detail.marketItem.isActive },
      proposedPurchasePrice: money(proposedPurchasePrice), targetProfitAmount: money(targetProfitAmount), additionalCostAmount: money(additionalCostAmount),
      calculatedAt: now.toISOString(), results, comparablePlatformOrder,
    };
  }
}

export const marketDecisionService = new MarketDecisionService();
