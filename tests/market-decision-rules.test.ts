import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { comparePlatformDecisionResults, evaluatePurchaseDecision } from "@/server/market/market-decision-rules";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("market decision rules", () => {
  it("calculates fixed-profit purchase thresholds without rounding away a negative maximum", () => {
    const result = evaluatePurchaseDecision({ expectedIncome: decimal("300.00"), proposedPurchasePrice: decimal("210.00"), additionalCostAmount: decimal("10.00"), targetProfitAmount: decimal("80.00") });
    expect(result.expectedProfit.toFixed(2)).toBe("80.00");
    expect(result.profitGap.toFixed(2)).toBe("0.00");
    expect(result.maxPurchasePrice.toFixed(2)).toBe("210.00");
    expect(result.meetsTarget).toBe(true);

    const negative = evaluatePurchaseDecision({ expectedIncome: decimal("50.00"), proposedPurchasePrice: decimal("0.00"), additionalCostAmount: decimal("10.00"), targetProfitAmount: decimal("80.00") });
    expect(negative.maxPurchasePrice.toFixed(2)).toBe("-40.00");
    expect(negative.meetsTarget).toBe(false);
  });

  it("sorts only comparable platform results by frozen numeric order", () => {
    const ordered = comparePlatformDecisionResults([
      { platform: "XIANYU", calculationStatus: "READY" as const, maxPurchasePrice: decimal("100.00"), expectedProfit: decimal("80.00") },
      { platform: "DEWU", calculationStatus: "READY" as const, maxPurchasePrice: decimal("100.00"), expectedProfit: decimal("90.00") },
      { platform: "NINETY_FIVE", calculationStatus: "READY" as const, maxPurchasePrice: decimal("90.00"), expectedProfit: decimal("120.00") },
    ], ["DEWU", "NINETY_FIVE", "XIANYU", "OTHER"]);
    expect(ordered.map((entry) => entry.platform)).toEqual(["DEWU", "XIANYU", "NINETY_FIVE"]);
  });
});
