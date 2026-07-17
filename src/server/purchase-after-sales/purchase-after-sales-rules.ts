import { Prisma } from "@/generated/prisma/client";

export const ACTIVE_PURCHASE_AFTER_SALE_STATUSES = [
  "REQUESTED",
  "SELLER_APPROVED",
  "RETURN_PENDING",
  "RETURNING_TO_SELLER",
  "SELLER_RECEIVED",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

export function isActivePurchaseAfterSaleStatus(status: string) {
  return (ACTIVE_PURCHASE_AFTER_SALE_STATUSES as readonly string[]).includes(status);
}

export function getPurchaseAfterSaleAvailableActions(type: string, status: string) {
  if (status === "DRAFT") return ["update", "submit", "cancel"];
  if (status === "REQUESTED") return ["sellerApprove", "sellerReject", "cancel"];
  if (status === "SELLER_APPROVED") {
    return type === "RETURN_AND_REFUND" ? ["prepareReturn", "cancel"] : ["markRefundPending", "cancel"];
  }
  if (status === "RETURN_PENDING") return ["markReturnShipped", "cancel"];
  if (status === "RETURNING_TO_SELLER") return ["markSellerReceived"];
  if (status === "SELLER_RECEIVED") return ["markRefundPending"];
  if (status === "REFUND_PENDING" || status === "PARTIALLY_REFUNDED") return ["recordRefund"];
  if (status === "REFUNDED") return ["complete"];
  return [];
}

export function sumDecimals(values: (Prisma.Decimal | null | undefined)[]) {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(value ?? 0), new Prisma.Decimal(0));
}

export function outstandingApprovedAmount(
  approvedAmount: Prisma.Decimal | null,
  refundedAmounts: (Prisma.Decimal | null | undefined)[],
) {
  const outstanding = (approvedAmount ?? new Prisma.Decimal(0)).minus(sumDecimals(refundedAmounts));
  return outstanding.isNegative() ? new Prisma.Decimal(0) : outstanding;
}

export function isOwnedProblemInventory(item: {
  itemStatus: string;
  ownershipStatus: string;
}) {
  return item.itemStatus === "PROBLEM" && item.ownershipStatus === "OWNED";
}

export function sameRefundAllocationPayload(
  existing: { afterSaleLineId: string; amount: Prisma.Decimal }[],
  input: { afterSaleLineId: string; amount: Prisma.Decimal }[],
) {
  if (existing.length !== input.length) return false;
  const current = [...existing].sort((a, b) => a.afterSaleLineId.localeCompare(b.afterSaleLineId));
  const requested = [...input].sort((a, b) => a.afterSaleLineId.localeCompare(b.afterSaleLineId));
  return current.every((allocation, index) =>
    allocation.afterSaleLineId === requested[index].afterSaleLineId && allocation.amount.equals(requested[index].amount),
  );
}
