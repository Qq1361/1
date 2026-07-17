import { describe, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client";
import {
  isActivePurchaseAfterSaleStatus,
  isOwnedProblemInventory,
  outstandingApprovedAmount,
  sameRefundAllocationPayload,
} from "../src/server/purchase-after-sales/purchase-after-sales-rules";

describe("purchase after-sales rules", () => {
  it("defines the active occupancy states without locking drafts or terminal cases", () => {
    expect(isActivePurchaseAfterSaleStatus("REQUESTED")).toBe(true);
    expect(isActivePurchaseAfterSaleStatus("REFUNDED")).toBe(true);
    expect(isActivePurchaseAfterSaleStatus("DRAFT")).toBe(false);
    expect(isActivePurchaseAfterSaleStatus("SELLER_REJECTED")).toBe(false);
    expect(isActivePurchaseAfterSaleStatus("COMPLETED")).toBe(false);
  });

  it("calculates outstanding approved Decimal value without going below zero", () => {
    expect(outstandingApprovedAmount(new Prisma.Decimal("10.00"), [new Prisma.Decimal("3.20")]).toFixed(2)).toBe("6.80");
    expect(outstandingApprovedAmount(new Prisma.Decimal("10.00"), [new Prisma.Decimal("12.00")]).toFixed(2)).toBe("0.00");
  });

  it("compares idempotency allocations independently of input order", () => {
    const existing = [
      { afterSaleLineId: "line-b", amount: new Prisma.Decimal("4.00") },
      { afterSaleLineId: "line-a", amount: new Prisma.Decimal("6.00") },
    ];
    expect(sameRefundAllocationPayload(existing, [
      { afterSaleLineId: "line-a", amount: new Prisma.Decimal("6.00") },
      { afterSaleLineId: "line-b", amount: new Prisma.Decimal("4.00") },
    ])).toBe(true);
    expect(sameRefundAllocationPayload(existing, [
      { afterSaleLineId: "line-a", amount: new Prisma.Decimal("5.99") },
      { afterSaleLineId: "line-b", amount: new Prisma.Decimal("4.01") },
    ])).toBe(false);
  });

  it("only treats owned problem inventory as eligible for upstream after-sales", () => {
    expect(isOwnedProblemInventory({ itemStatus: "PROBLEM", ownershipStatus: "OWNED" })).toBe(true);
    expect(isOwnedProblemInventory({ itemStatus: "PROBLEM", ownershipStatus: "RETURNING_TO_UPSTREAM_SELLER" })).toBe(false);
    expect(isOwnedProblemInventory({ itemStatus: "STOCKED", ownershipStatus: "OWNED" })).toBe(false);
  });
});
