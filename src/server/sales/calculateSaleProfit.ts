import { Prisma } from "@/generated/prisma/client";

export type ProfitResult = {
  profit: Prisma.Decimal;
  incomeBasis: "ACTUAL_RECEIVED" | "EXPECTED_INCOME" | "GROSS_MINUS_FEES";
  inventoryCostTotal: Prisma.Decimal;
  feeLinesTotal: Prisma.Decimal;
};

/**
 * M3-A V1 profit calculation.
 * Three mutually exclusive paths, priority order:
 * 1. actualReceivedAmount (no feeLines deduction)
 * 2. expectedIncome (no feeLines deduction)
 * 3. grossAmount - feeLines
 * shippingCost and otherCost always deducted once.
 */
export function calculateSaleProfit(params: {
  grossAmount: Prisma.Decimal;
  expectedIncome?: Prisma.Decimal | null;
  actualReceivedAmount?: Prisma.Decimal | null;
  shippingCost: Prisma.Decimal;
  otherCost: Prisma.Decimal;
  inventoryCostTotal: Prisma.Decimal;
  feeLinesTotal?: Prisma.Decimal;
}): ProfitResult {
  const zero = new Prisma.Decimal(0);
  const fees = params.feeLinesTotal ?? zero;
  const shipping = params.shippingCost;
  const other = params.otherCost;
  const invCost = params.inventoryCostTotal;

  // Path 1: actualReceivedAmount
  if (params.actualReceivedAmount && !params.actualReceivedAmount.equals(0)) {
    const profit = params.actualReceivedAmount.minus(invCost).minus(shipping).minus(other);
    return { profit, incomeBasis: "ACTUAL_RECEIVED", inventoryCostTotal: invCost, feeLinesTotal: zero };
  }

  // Path 2: expectedIncome
  if (params.expectedIncome && !params.expectedIncome.equals(0)) {
    const profit = params.expectedIncome.minus(invCost).minus(shipping).minus(other);
    return { profit, incomeBasis: "EXPECTED_INCOME", inventoryCostTotal: invCost, feeLinesTotal: zero };
  }

  // Path 3: grossAmount - feeLines
  const profit = params.grossAmount.minus(fees).minus(invCost).minus(shipping).minus(other);
  return { profit, incomeBasis: "GROSS_MINUS_FEES", inventoryCostTotal: invCost, feeLinesTotal: fees };
}
