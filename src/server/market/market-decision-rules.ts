export type DecisionDecimal<T> = {
  minus(value: T): T;
  comparedTo(value: T): number;
};

export type ComputablePlatformDecision<T extends DecisionDecimal<T>> = {
  platform: string;
  calculationStatus: "READY";
  expectedProfit: T;
  maxPurchasePrice: T;
};

export function calculateExpectedProfit<T extends DecisionDecimal<T>>(expectedIncome: T, proposedPurchasePrice: T, additionalCostAmount: T): T {
  return expectedIncome.minus(proposedPurchasePrice).minus(additionalCostAmount) as T;
}

export function calculateProfitGap<T extends DecisionDecimal<T>>(expectedProfit: T, targetProfitAmount: T): T {
  return expectedProfit.minus(targetProfitAmount) as T;
}

export function calculateMaxPurchasePrice<T extends DecisionDecimal<T>>(expectedIncome: T, additionalCostAmount: T, targetProfitAmount: T): T {
  return expectedIncome.minus(additionalCostAmount).minus(targetProfitAmount) as T;
}

export function evaluatePurchaseDecision<T extends DecisionDecimal<T>>(input: {
  expectedIncome: T;
  proposedPurchasePrice: T;
  additionalCostAmount: T;
  targetProfitAmount: T;
}) {
  const expectedProfit = calculateExpectedProfit(input.expectedIncome, input.proposedPurchasePrice, input.additionalCostAmount);
  const profitGap = calculateProfitGap(expectedProfit, input.targetProfitAmount);
  const maxPurchasePrice = calculateMaxPurchasePrice(input.expectedIncome, input.additionalCostAmount, input.targetProfitAmount);
  return { expectedProfit, profitGap, maxPurchasePrice, meetsTarget: input.proposedPurchasePrice.comparedTo(maxPurchasePrice) <= 0 };
}

export function comparePlatformDecisionResults<T extends DecisionDecimal<T>>(results: ComputablePlatformDecision<T>[], platformOrder: readonly string[]) {
  return [...results].sort((left, right) => {
    const maxPurchasePrice = right.maxPurchasePrice.comparedTo(left.maxPurchasePrice);
    if (maxPurchasePrice !== 0) return maxPurchasePrice;
    const expectedProfit = right.expectedProfit.comparedTo(left.expectedProfit);
    if (expectedProfit !== 0) return expectedProfit;
    return platformOrder.indexOf(left.platform) - platformOrder.indexOf(right.platform);
  });
}
