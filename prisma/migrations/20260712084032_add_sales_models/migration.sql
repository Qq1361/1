-- CreateEnum
CREATE TYPE "SaleOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleFeeType" AS ENUM ('PLATFORM_COMMISSION', 'AUTHENTICATION', 'SHIPPING', 'PACKAGING', 'OTHER');

-- CreateTable
CREATE TABLE "sale_orders" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "saleNo" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformOrderNo" TEXT,
    "platformTradeNo" TEXT,
    "buyerName" TEXT,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "expectedIncome" DECIMAL(12,2),
    "actualReceivedAmount" DECIMAL(12,2),
    "shippingCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "SaleOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "inventoryCodeSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "unitCostSnapshot" DECIMAL(12,2) NOT NULL,
    "saleAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "profitAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sourcePurchaseOrderId" TEXT,
    "sourcePurchaseOrderItemId" TEXT,
    "sourceShipmentBatchId" TEXT,
    "sourceShipmentLineId" TEXT,
    "preSaleItemStatus" TEXT NOT NULL,
    "preSaleSaleMode" TEXT,
    "preSaleStorageLocation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_fee_lines" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "feeType" "SaleFeeType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_fee_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_action_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_orders_ownerId_status_idx" ON "sale_orders"("ownerId", "status");

-- CreateIndex
CREATE INDEX "sale_orders_ownerId_platform_idx" ON "sale_orders"("ownerId", "platform");

-- CreateIndex
CREATE INDEX "sale_orders_ownerId_platformOrderNo_idx" ON "sale_orders"("ownerId", "platformOrderNo");

-- CreateIndex
CREATE INDEX "sale_orders_ownerId_platformTradeNo_idx" ON "sale_orders"("ownerId", "platformTradeNo");

-- CreateIndex
CREATE INDEX "sale_orders_ownerId_soldAt_idx" ON "sale_orders"("ownerId", "soldAt");

-- CreateIndex
CREATE UNIQUE INDEX "sale_orders_ownerId_saleNo_key" ON "sale_orders"("ownerId", "saleNo");

-- CreateIndex
CREATE INDEX "sale_lines_ownerId_saleOrderId_idx" ON "sale_lines"("ownerId", "saleOrderId");

-- CreateIndex
CREATE INDEX "sale_lines_ownerId_inventoryItemId_idx" ON "sale_lines"("ownerId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "sale_lines_ownerId_sourcePurchaseOrderId_idx" ON "sale_lines"("ownerId", "sourcePurchaseOrderId");

-- CreateIndex
CREATE INDEX "sale_fee_lines_ownerId_saleOrderId_idx" ON "sale_fee_lines"("ownerId", "saleOrderId");

-- CreateIndex
CREATE INDEX "sale_action_logs_ownerId_saleOrderId_createdAt_idx" ON "sale_action_logs"("ownerId", "saleOrderId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sourceShipmentBatchId_fkey" FOREIGN KEY ("sourceShipmentBatchId") REFERENCES "platform_shipment_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sourceShipmentLineId_fkey" FOREIGN KEY ("sourceShipmentLineId") REFERENCES "platform_shipment_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_fee_lines" ADD CONSTRAINT "sale_fee_lines_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_fee_lines" ADD CONSTRAINT "sale_fee_lines_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_action_logs" ADD CONSTRAINT "sale_action_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_action_logs" ADD CONSTRAINT "sale_action_logs_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
