-- CreateEnum
CREATE TYPE "SaleAfterSaleType" AS ENUM ('REFUND_ONLY', 'RETURN_AND_REFUND');

-- CreateEnum
CREATE TYPE "SaleAfterSaleStatus" AS ENUM ('DRAFT', 'REQUESTED', 'APPROVED', 'REJECTED', 'RETURN_PENDING', 'RETURNING', 'RETURN_RECEIVED', 'INSPECTED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleAfterSaleInspectionResult" AS ENUM ('RESTOCKED', 'PROBLEM', 'PENDING_DECISION');

-- CreateTable
CREATE TABLE "sale_after_sale_cases" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "caseNo" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "type" "SaleAfterSaleType" NOT NULL,
    "status" "SaleAfterSaleStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "returnCarrierCode" TEXT,
    "returnTrackingNo" TEXT,
    "returnShippedAt" TIMESTAMP(3),
    "returnReceivedAt" TIMESTAMP(3),
    "inspectedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_after_sale_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_after_sale_lines" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "afterSaleCaseId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "requestedRefundAmount" DECIMAL(12,2) NOT NULL,
    "approvedRefundAmount" DECIMAL(12,2),
    "returnRequired" BOOLEAN NOT NULL,
    "returnReceived" BOOLEAN NOT NULL DEFAULT false,
    "productNameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "inventoryCodeSnapshot" TEXT NOT NULL,
    "saleAmountSnapshot" DECIMAL(12,2),
    "costAmountSnapshot" DECIMAL(12,2) NOT NULL,
    "profitAmountSnapshot" DECIMAL(12,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_after_sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_refund_records" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "afterSaleCaseId" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "refundAmount" DECIMAL(12,2) NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL,
    "refundMethod" TEXT,
    "externalRefundNo" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_refund_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_refund_allocations" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "refundRecordId" TEXT NOT NULL,
    "afterSaleLineId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_refund_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_after_sale_inspections" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "afterSaleCaseId" TEXT NOT NULL,
    "afterSaleLineId" TEXT NOT NULL,
    "result" "SaleAfterSaleInspectionResult" NOT NULL,
    "storageLocation" TEXT,
    "problemReason" TEXT,
    "note" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_after_sale_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_after_sale_action_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "afterSaleCaseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_after_sale_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_after_sale_cases_caseNo_key" ON "sale_after_sale_cases"("caseNo");

-- CreateIndex
CREATE INDEX "sale_after_sale_cases_ownerId_status_idx" ON "sale_after_sale_cases"("ownerId", "status");

-- CreateIndex
CREATE INDEX "sale_after_sale_cases_ownerId_type_idx" ON "sale_after_sale_cases"("ownerId", "type");

-- CreateIndex
CREATE INDEX "sale_after_sale_cases_ownerId_createdAt_idx" ON "sale_after_sale_cases"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "sale_after_sale_cases_saleOrderId_idx" ON "sale_after_sale_cases"("saleOrderId");

-- CreateIndex
CREATE INDEX "sale_after_sale_lines_ownerId_afterSaleCaseId_idx" ON "sale_after_sale_lines"("ownerId", "afterSaleCaseId");

-- CreateIndex
CREATE INDEX "sale_after_sale_lines_ownerId_saleLineId_idx" ON "sale_after_sale_lines"("ownerId", "saleLineId");

-- CreateIndex
CREATE INDEX "sale_after_sale_lines_ownerId_inventoryItemId_idx" ON "sale_after_sale_lines"("ownerId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_after_sale_lines_afterSaleCaseId_saleLineId_key" ON "sale_after_sale_lines"("afterSaleCaseId", "saleLineId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_after_sale_lines_afterSaleCaseId_inventoryItemId_key" ON "sale_after_sale_lines"("afterSaleCaseId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_refund_records_idempotencyKey_key" ON "sale_refund_records"("idempotencyKey");

-- CreateIndex
CREATE INDEX "sale_refund_records_ownerId_afterSaleCaseId_idx" ON "sale_refund_records"("ownerId", "afterSaleCaseId");

-- CreateIndex
CREATE INDEX "sale_refund_records_ownerId_saleOrderId_idx" ON "sale_refund_records"("ownerId", "saleOrderId");

-- CreateIndex
CREATE INDEX "sale_refund_records_ownerId_refundedAt_idx" ON "sale_refund_records"("ownerId", "refundedAt");

-- CreateIndex
CREATE INDEX "sale_refund_records_ownerId_externalRefundNo_idx" ON "sale_refund_records"("ownerId", "externalRefundNo");

-- CreateIndex
CREATE INDEX "sale_refund_allocations_ownerId_refundRecordId_idx" ON "sale_refund_allocations"("ownerId", "refundRecordId");

-- CreateIndex
CREATE INDEX "sale_refund_allocations_ownerId_afterSaleLineId_idx" ON "sale_refund_allocations"("ownerId", "afterSaleLineId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_refund_allocations_refundRecordId_afterSaleLineId_key" ON "sale_refund_allocations"("refundRecordId", "afterSaleLineId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_after_sale_inspections_afterSaleLineId_key" ON "sale_after_sale_inspections"("afterSaleLineId");

-- CreateIndex
CREATE INDEX "sale_after_sale_inspections_ownerId_afterSaleCaseId_idx" ON "sale_after_sale_inspections"("ownerId", "afterSaleCaseId");

-- CreateIndex
CREATE INDEX "sale_after_sale_inspections_ownerId_inspectedAt_idx" ON "sale_after_sale_inspections"("ownerId", "inspectedAt");

-- CreateIndex
CREATE INDEX "sale_after_sale_action_logs_ownerId_afterSaleCaseId_created_idx" ON "sale_after_sale_action_logs"("ownerId", "afterSaleCaseId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "sale_after_sale_cases" ADD CONSTRAINT "sale_after_sale_cases_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_cases" ADD CONSTRAINT "sale_after_sale_cases_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_lines" ADD CONSTRAINT "sale_after_sale_lines_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_lines" ADD CONSTRAINT "sale_after_sale_lines_afterSaleCaseId_fkey" FOREIGN KEY ("afterSaleCaseId") REFERENCES "sale_after_sale_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_lines" ADD CONSTRAINT "sale_after_sale_lines_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_lines" ADD CONSTRAINT "sale_after_sale_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refund_records" ADD CONSTRAINT "sale_refund_records_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refund_records" ADD CONSTRAINT "sale_refund_records_afterSaleCaseId_fkey" FOREIGN KEY ("afterSaleCaseId") REFERENCES "sale_after_sale_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refund_records" ADD CONSTRAINT "sale_refund_records_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refund_allocations" ADD CONSTRAINT "sale_refund_allocations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refund_allocations" ADD CONSTRAINT "sale_refund_allocations_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "sale_refund_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refund_allocations" ADD CONSTRAINT "sale_refund_allocations_afterSaleLineId_fkey" FOREIGN KEY ("afterSaleLineId") REFERENCES "sale_after_sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_inspections" ADD CONSTRAINT "sale_after_sale_inspections_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_inspections" ADD CONSTRAINT "sale_after_sale_inspections_afterSaleCaseId_fkey" FOREIGN KEY ("afterSaleCaseId") REFERENCES "sale_after_sale_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_inspections" ADD CONSTRAINT "sale_after_sale_inspections_afterSaleLineId_fkey" FOREIGN KEY ("afterSaleLineId") REFERENCES "sale_after_sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_action_logs" ADD CONSTRAINT "sale_after_sale_action_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_after_sale_action_logs" ADD CONSTRAINT "sale_after_sale_action_logs_afterSaleCaseId_fkey" FOREIGN KEY ("afterSaleCaseId") REFERENCES "sale_after_sale_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
