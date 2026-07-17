-- CreateEnum
CREATE TYPE "InventoryOwnershipStatus" AS ENUM ('OWNED', 'RETURNING_TO_UPSTREAM_SELLER', 'RETURNED_TO_UPSTREAM_SELLER');

-- CreateEnum
CREATE TYPE "PurchaseAfterSaleType" AS ENUM ('REFUND_ONLY', 'RETURN_AND_REFUND');

-- CreateEnum
CREATE TYPE "PurchaseAfterSaleStatus" AS ENUM ('DRAFT', 'REQUESTED', 'SELLER_APPROVED', 'SELLER_REJECTED', 'RETURN_PENDING', 'RETURNING_TO_SELLER', 'SELLER_RECEIVED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "ownershipStatus" "InventoryOwnershipStatus" NOT NULL DEFAULT 'OWNED';

-- CreateTable
CREATE TABLE "purchase_after_sale_cases" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "caseNo" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "type" "PurchaseAfterSaleType" NOT NULL,
    "status" "PurchaseAfterSaleStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "returnCarrierCode" TEXT,
    "returnTrackingNo" TEXT,
    "returnShippedAt" TIMESTAMP(3),
    "sellerReceivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_after_sale_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_after_sale_lines" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "afterSaleCaseId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "requestedRefundAmount" DECIMAL(12,2) NOT NULL,
    "approvedRefundAmount" DECIMAL(12,2),
    "returnRequired" BOOLEAN NOT NULL,
    "returnedToSeller" BOOLEAN NOT NULL DEFAULT false,
    "productNameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "inventoryCodeSnapshot" TEXT NOT NULL,
    "costAmountSnapshot" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_after_sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_refund_records" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "afterSaleCaseId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "refundAmount" DECIMAL(12,2) NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL,
    "refundMethod" TEXT,
    "externalRefundNo" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_refund_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_refund_allocations" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "refundRecordId" TEXT NOT NULL,
    "afterSaleLineId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_refund_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_after_sale_action_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "afterSaleCaseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_after_sale_action_logs_pkey" PRIMARY KEY ("id")
);

-- Enforce monetary invariants at the database boundary. Allocation totals and
-- case state transitions intentionally remain future service responsibilities.
ALTER TABLE "purchase_after_sale_lines"
  ADD CONSTRAINT "purchase_after_sale_lines_requested_refund_positive"
  CHECK ("requestedRefundAmount" > 0),
  ADD CONSTRAINT "purchase_after_sale_lines_approved_refund_non_negative"
  CHECK ("approvedRefundAmount" IS NULL OR "approvedRefundAmount" >= 0);

ALTER TABLE "purchase_refund_records"
  ADD CONSTRAINT "purchase_refund_records_refund_amount_positive"
  CHECK ("refundAmount" > 0);

ALTER TABLE "purchase_refund_allocations"
  ADD CONSTRAINT "purchase_refund_allocations_amount_positive"
  CHECK ("amount" > 0);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_after_sale_cases_caseNo_key" ON "purchase_after_sale_cases"("caseNo");

-- CreateIndex
CREATE INDEX "purchase_after_sale_cases_ownerId_status_idx" ON "purchase_after_sale_cases"("ownerId", "status");

-- CreateIndex
CREATE INDEX "purchase_after_sale_cases_ownerId_type_idx" ON "purchase_after_sale_cases"("ownerId", "type");

-- CreateIndex
CREATE INDEX "purchase_after_sale_cases_ownerId_createdAt_idx" ON "purchase_after_sale_cases"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "purchase_after_sale_cases_purchaseOrderId_idx" ON "purchase_after_sale_cases"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_after_sale_lines_ownerId_afterSaleCaseId_idx" ON "purchase_after_sale_lines"("ownerId", "afterSaleCaseId");

-- CreateIndex
CREATE INDEX "purchase_after_sale_lines_ownerId_purchaseOrderItemId_idx" ON "purchase_after_sale_lines"("ownerId", "purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "purchase_after_sale_lines_ownerId_inspectionId_idx" ON "purchase_after_sale_lines"("ownerId", "inspectionId");

-- CreateIndex
CREATE INDEX "purchase_after_sale_lines_ownerId_inventoryItemId_idx" ON "purchase_after_sale_lines"("ownerId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_after_sale_lines_afterSaleCaseId_inspectionId_key" ON "purchase_after_sale_lines"("afterSaleCaseId", "inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_after_sale_lines_afterSaleCaseId_inventoryItemId_key" ON "purchase_after_sale_lines"("afterSaleCaseId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_refund_records_idempotencyKey_key" ON "purchase_refund_records"("idempotencyKey");

-- CreateIndex
CREATE INDEX "purchase_refund_records_ownerId_afterSaleCaseId_idx" ON "purchase_refund_records"("ownerId", "afterSaleCaseId");

-- CreateIndex
CREATE INDEX "purchase_refund_records_ownerId_purchaseOrderId_idx" ON "purchase_refund_records"("ownerId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_refund_records_ownerId_refundedAt_idx" ON "purchase_refund_records"("ownerId", "refundedAt");

-- CreateIndex
CREATE INDEX "purchase_refund_records_ownerId_externalRefundNo_idx" ON "purchase_refund_records"("ownerId", "externalRefundNo");

-- CreateIndex
CREATE INDEX "purchase_refund_allocations_ownerId_refundRecordId_idx" ON "purchase_refund_allocations"("ownerId", "refundRecordId");

-- CreateIndex
CREATE INDEX "purchase_refund_allocations_ownerId_afterSaleLineId_idx" ON "purchase_refund_allocations"("ownerId", "afterSaleLineId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_refund_allocations_refundRecordId_afterSaleLineId_key" ON "purchase_refund_allocations"("refundRecordId", "afterSaleLineId");

-- CreateIndex
CREATE INDEX "purchase_after_sale_action_logs_ownerId_afterSaleCaseId_cre_idx" ON "purchase_after_sale_action_logs"("ownerId", "afterSaleCaseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "inventory_items_ownerId_ownershipStatus_idx" ON "inventory_items"("ownerId", "ownershipStatus");

-- AddForeignKey
ALTER TABLE "purchase_after_sale_cases" ADD CONSTRAINT "purchase_after_sale_cases_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_after_sale_cases" ADD CONSTRAINT "purchase_after_sale_cases_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_after_sale_lines" ADD CONSTRAINT "purchase_after_sale_lines_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_after_sale_lines" ADD CONSTRAINT "purchase_after_sale_lines_afterSaleCaseId_fkey" FOREIGN KEY ("afterSaleCaseId") REFERENCES "purchase_after_sale_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_after_sale_lines" ADD CONSTRAINT "purchase_after_sale_lines_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_after_sale_lines" ADD CONSTRAINT "purchase_after_sale_lines_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_after_sale_lines" ADD CONSTRAINT "purchase_after_sale_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_refund_records" ADD CONSTRAINT "purchase_refund_records_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_refund_records" ADD CONSTRAINT "purchase_refund_records_afterSaleCaseId_fkey" FOREIGN KEY ("afterSaleCaseId") REFERENCES "purchase_after_sale_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_refund_records" ADD CONSTRAINT "purchase_refund_records_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_refund_allocations" ADD CONSTRAINT "purchase_refund_allocations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_refund_allocations" ADD CONSTRAINT "purchase_refund_allocations_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "purchase_refund_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_refund_allocations" ADD CONSTRAINT "purchase_refund_allocations_afterSaleLineId_fkey" FOREIGN KEY ("afterSaleLineId") REFERENCES "purchase_after_sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_after_sale_action_logs" ADD CONSTRAINT "purchase_after_sale_action_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_after_sale_action_logs" ADD CONSTRAINT "purchase_after_sale_action_logs_afterSaleCaseId_fkey" FOREIGN KEY ("afterSaleCaseId") REFERENCES "purchase_after_sale_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
