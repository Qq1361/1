import { describe, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client";
import {
  ACTIVE_SALES_AFTER_SALE_STATUSES,
  CANCELLABLE_SALES_AFTER_SALE_STATUSES,
  REFUNDABLE_SALES_AFTER_SALE_STATUSES,
  calculateMinimumRequiredActualReceived,
  canTransition,
  getAvailableActions,
  isFinalInspectionResult,
  outstandingApprovedAmount,
  sameRefundAllocationPayload,
  sameRefundRequest,
  sumDecimals,
} from "../src/server/sales-after-sales/sales-after-sales-rules";

describe("sales after-sales rules", () => {
  it("allows refund-only and return-and-refund transitions", () => {
    expect(canTransition("REFUND_ONLY", "APPROVED", "REFUND_PENDING")).toBe(true);
    expect(canTransition("RETURN_AND_REFUND", "APPROVED", "RETURN_PENDING")).toBe(true);
    expect(canTransition("RETURN_AND_REFUND", "RETURN_RECEIVED", "INSPECTED")).toBe(true);
    expect(canTransition("REFUND_ONLY", "APPROVED", "RETURN_PENDING")).toBe(false);
  });

  it("rejects transitions that skip approval or inspection", () => {
    expect(canTransition("RETURN_AND_REFUND", "REQUESTED", "REFUND_PENDING")).toBe(false);
    expect(canTransition("RETURN_AND_REFUND", "RETURN_RECEIVED", "REFUND_PENDING")).toBe(false);
    expect(canTransition("REFUND_ONLY", "REFUNDED", "COMPLETED")).toBe(true);
    expect(canTransition("REFUND_ONLY", "COMPLETED", "REFUND_PENDING")).toBe(false);
  });

  it("keeps active, cancellable, and refundable status sets explicit", () => {
    expect(ACTIVE_SALES_AFTER_SALE_STATUSES).toContain("REFUNDED");
    expect(CANCELLABLE_SALES_AFTER_SALE_STATUSES).toEqual(["DRAFT", "REQUESTED", "APPROVED", "RETURN_PENDING"]);
    expect(REFUNDABLE_SALES_AFTER_SALE_STATUSES).toEqual(["REFUND_PENDING", "PARTIALLY_REFUNDED"]);
    expect(getAvailableActions("RETURN_AND_REFUND", "RETURNING")).toEqual(["markReturnReceived"]);
    expect(getAvailableActions("REFUND_ONLY", "REFUND_PENDING")).toEqual(["recordRefund"]);
  });

  it("calculates the actual-received lower bound with Decimal", () => {
    const refunded = new Prisma.Decimal("18.33");
    const locked = new Prisma.Decimal("21.67");
    expect(calculateMinimumRequiredActualReceived(refunded, locked).toFixed(2)).toBe("40.00");
    expect(sumDecimals([new Prisma.Decimal("1.10"), null, new Prisma.Decimal("2.22")]).toFixed(2)).toBe("3.32");
    expect(outstandingApprovedAmount(new Prisma.Decimal("20.00"), [new Prisma.Decimal("7.50")]).toFixed(2)).toBe("12.50");
    expect(outstandingApprovedAmount(new Prisma.Decimal("2.00"), [new Prisma.Decimal("3.00")]).toFixed(2)).toBe("0.00");
  });

  it("recognizes only final return inspection results", () => {
    expect(isFinalInspectionResult("RESTOCKED")).toBe(true);
    expect(isFinalInspectionResult("PROBLEM")).toBe(true);
    expect(isFinalInspectionResult("PENDING_DECISION")).toBe(false);
  });

  it("compares refund allocations independent of row order", () => {
    const existing = [
      { afterSaleLineId: "b", amount: new Prisma.Decimal("2.00") },
      { afterSaleLineId: "a", amount: new Prisma.Decimal("1.00") },
    ];
    const requested = [
      { afterSaleLineId: "a", amount: new Prisma.Decimal("1.00") },
      { afterSaleLineId: "b", amount: new Prisma.Decimal("2.00") },
    ];
    expect(sameRefundAllocationPayload(existing, requested)).toBe(true);
    expect(sameRefundAllocationPayload(existing, [{ afterSaleLineId: "a", amount: new Prisma.Decimal("3.00") }, { afterSaleLineId: "b", amount: new Prisma.Decimal("0.00") }])).toBe(false);
  });

  it("makes idempotent refund requests strict", () => {
    const base = {
      ownerId: "owner",
      afterSaleCaseId: "case",
      saleOrderId: "sale",
      refundAmount: new Prisma.Decimal("3.00"),
      refundMethod: "manual",
      externalRefundNo: null,
      note: "ok",
      allocations: [{ afterSaleLineId: "line", amount: new Prisma.Decimal("3.00") }],
    };
    expect(sameRefundRequest(base, { ...base, allocations: [...base.allocations] })).toBe(true);
    expect(sameRefundRequest(base, { ...base, note: "changed", allocations: [...base.allocations] })).toBe(false);
    expect(sameRefundRequest(base, { ...base, afterSaleCaseId: "other", allocations: [...base.allocations] })).toBe(false);
  });
});
