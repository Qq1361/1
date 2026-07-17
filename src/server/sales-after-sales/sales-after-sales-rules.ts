import { Prisma } from "@/generated/prisma/client";

export const ACTIVE_SALES_AFTER_SALE_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "RETURN_PENDING",
  "RETURNING",
  "RETURN_RECEIVED",
  "INSPECTED",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

export const CANCELLABLE_SALES_AFTER_SALE_STATUSES = [
  "DRAFT",
  "REQUESTED",
  "APPROVED",
  "RETURN_PENDING",
] as const;

export const REFUNDABLE_SALES_AFTER_SALE_STATUSES = [
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
] as const;

export function isActiveSalesAfterSaleStatus(status: string) {
  return (ACTIVE_SALES_AFTER_SALE_STATUSES as readonly string[]).includes(status);
}

export function isReturnAfterSaleType(type: string) {
  return type === "RETURN_AND_REFUND";
}

export function isFinalInspectionResult(result: string) {
  return result === "RESTOCKED" || result === "PROBLEM";
}

export function canTransition(type: string, from: string, to: string) {
  if (from === "DRAFT" && to === "REQUESTED") return true;
  if (from === "REQUESTED" && (to === "APPROVED" || to === "REJECTED")) return true;
  if (from === "APPROVED" && to === "REFUND_PENDING") return type === "REFUND_ONLY";
  if (from === "APPROVED" && to === "RETURN_PENDING") return type === "RETURN_AND_REFUND";
  if (from === "RETURN_PENDING" && to === "RETURNING") return type === "RETURN_AND_REFUND";
  if (from === "RETURNING" && to === "RETURN_RECEIVED") return type === "RETURN_AND_REFUND";
  if (from === "RETURN_RECEIVED" && to === "INSPECTED") return type === "RETURN_AND_REFUND";
  if (from === "INSPECTED" && to === "REFUND_PENDING") return type === "RETURN_AND_REFUND";
  if ((from === "REFUND_PENDING" || from === "PARTIALLY_REFUNDED") && (to === "PARTIALLY_REFUNDED" || to === "REFUNDED")) return true;
  if (from === "REFUNDED" && to === "COMPLETED") return true;
  return false;
}

export function assertTransition(type: string, from: string, to: string) {
  if (!canTransition(type, from, to)) {
    throw new Error(`INVALID_AFTER_SALE_TRANSITION:${from}->${to}`);
  }
}

export function getAvailableActions(type: string, status: string) {
  if (status === "DRAFT") return ["update", "submit", "cancel"];
  if (status === "REQUESTED") return ["approve", "reject", "cancel"];
  if (status === "APPROVED") return type === "RETURN_AND_REFUND" ? ["prepareReturn", "cancel"] : ["markRefundPending", "cancel"];
  if (status === "RETURN_PENDING") return ["markReturnShipped", "cancel"];
  if (status === "RETURNING") return ["markReturnReceived"];
  if (status === "RETURN_RECEIVED") return ["inspectReturn"];
  if (status === "INSPECTED") return ["markRefundPending"];
  if (status === "REFUND_PENDING" || status === "PARTIALLY_REFUNDED") return ["recordRefund"];
  if (status === "REFUNDED") return ["complete"];
  return [];
}

export function sumDecimals(values: (Prisma.Decimal | null | undefined)[]) {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(value ?? 0), new Prisma.Decimal(0));
}

export function outstandingApprovedAmount(
  approvedAmount: Prisma.Decimal | null | undefined,
  refundedAmounts: (Prisma.Decimal | null | undefined)[],
) {
  const value = (approvedAmount ?? new Prisma.Decimal(0)).minus(sumDecimals(refundedAmounts));
  return value.isNegative() ? new Prisma.Decimal(0) : value;
}

export function calculateMinimumRequiredActualReceived(
  refundedAmount: Prisma.Decimal,
  lockedApprovedAmount: Prisma.Decimal,
) {
  return refundedAmount.plus(lockedApprovedAmount);
}

export function sameRefundAllocationPayload(
  existing: { afterSaleLineId: string; amount: Prisma.Decimal }[],
  requested: { afterSaleLineId: string; amount: Prisma.Decimal }[],
) {
  if (existing.length !== requested.length) return false;
  const left = [...existing].sort((a, b) => a.afterSaleLineId.localeCompare(b.afterSaleLineId));
  const right = [...requested].sort((a, b) => a.afterSaleLineId.localeCompare(b.afterSaleLineId));
  return left.every((item, index) => item.afterSaleLineId === right[index].afterSaleLineId && item.amount.equals(right[index].amount));
}

export function sameRefundRequest(
  existing: {
    ownerId: string;
    afterSaleCaseId: string;
    saleOrderId: string;
    refundAmount: Prisma.Decimal;
    refundMethod: string | null;
    externalRefundNo: string | null;
    note: string | null;
    allocations: { afterSaleLineId: string; amount: Prisma.Decimal }[];
  },
  requested: {
    ownerId: string;
    afterSaleCaseId: string;
    saleOrderId: string;
    refundAmount: Prisma.Decimal;
    refundMethod: string | null;
    externalRefundNo: string | null;
    note: string | null;
    allocations: { afterSaleLineId: string; amount: Prisma.Decimal }[];
  },
) {
  return existing.ownerId === requested.ownerId
    && existing.afterSaleCaseId === requested.afterSaleCaseId
    && existing.saleOrderId === requested.saleOrderId
    && existing.refundAmount.equals(requested.refundAmount)
    && existing.refundMethod === requested.refundMethod
    && existing.externalRefundNo === requested.externalRefundNo
    && existing.note === requested.note
    && sameRefundAllocationPayload(existing.allocations, requested.allocations);
}
