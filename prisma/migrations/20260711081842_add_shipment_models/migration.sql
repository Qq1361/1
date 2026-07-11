-- CreateEnum
CREATE TYPE "ShipmentPlatform" AS ENUM ('DEWU', 'NINETY_FIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "ShipmentPurpose" AS ENUM ('DEWU_LIGHTNING_INBOUND', 'DEWU_STANDARD_FULFILLMENT', 'NINETY_FIVE_INBOUND', 'OTHER');

-- CreateEnum
CREATE TYPE "ShipmentBatchStatus" AS ENUM ('DRAFT', 'SHIPPED', 'RECEIVED', 'PARTIALLY_RECEIVED', 'PARTIALLY_LISTED', 'LISTED', 'PARTIALLY_REJECTED', 'RETURNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentLineStatus" AS ENUM ('SHIPPED', 'RECEIVED', 'LISTED', 'REJECTED', 'RETURNING', 'RETURNED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ItemStatus" ADD VALUE 'PLATFORM_SHIPPED';
ALTER TYPE "ItemStatus" ADD VALUE 'PLATFORM_RECEIVED';
ALTER TYPE "ItemStatus" ADD VALUE 'PLATFORM_LISTED';
ALTER TYPE "ItemStatus" ADD VALUE 'PLATFORM_REJECTED';
ALTER TYPE "ItemStatus" ADD VALUE 'RETURNING';
ALTER TYPE "ItemStatus" ADD VALUE 'RETURNED';
ALTER TYPE "ItemStatus" ADD VALUE 'SOLD';

-- CreateTable
CREATE TABLE "platform_shipment_batches" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "platform" "ShipmentPlatform" NOT NULL,
    "purpose" "ShipmentPurpose" NOT NULL,
    "status" "ShipmentBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "carrierCode" TEXT,
    "trackingNo" TEXT,
    "shippedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_shipment_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_shipment_groups" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "platformOrderNo" TEXT,
    "platformTradeNo" TEXT,
    "groupName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_shipment_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_shipment_lines" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "groupId" TEXT,
    "inventoryItemId" TEXT NOT NULL,
    "lineStatus" "ShipmentLineStatus" NOT NULL DEFAULT 'SHIPPED',
    "inventoryCodeSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "unitCostSnapshot" DECIMAL(12,2) NOT NULL,
    "saleModeSnapshot" TEXT NOT NULL,
    "sourcePurchaseOrderId" TEXT NOT NULL,
    "rejectedReason" TEXT,
    "returnCarrierCode" TEXT,
    "returnTrackingNo" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnedStorageLocation" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_shipment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_shipment_batches_ownerId_status_idx" ON "platform_shipment_batches"("ownerId", "status");

-- CreateIndex
CREATE INDEX "platform_shipment_batches_ownerId_platform_idx" ON "platform_shipment_batches"("ownerId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "platform_shipment_batches_ownerId_batchNo_key" ON "platform_shipment_batches"("ownerId", "batchNo");

-- CreateIndex
CREATE INDEX "platform_shipment_groups_ownerId_batchId_idx" ON "platform_shipment_groups"("ownerId", "batchId");

-- CreateIndex
CREATE INDEX "platform_shipment_lines_ownerId_batchId_idx" ON "platform_shipment_lines"("ownerId", "batchId");

-- CreateIndex
CREATE INDEX "platform_shipment_lines_ownerId_inventoryItemId_idx" ON "platform_shipment_lines"("ownerId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "platform_shipment_lines_ownerId_lineStatus_idx" ON "platform_shipment_lines"("ownerId", "lineStatus");

-- CreateIndex
CREATE UNIQUE INDEX "platform_shipment_lines_ownerId_inventoryItemId_batchId_key" ON "platform_shipment_lines"("ownerId", "inventoryItemId", "batchId");

-- AddForeignKey
ALTER TABLE "platform_shipment_batches" ADD CONSTRAINT "platform_shipment_batches_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shipment_groups" ADD CONSTRAINT "platform_shipment_groups_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shipment_groups" ADD CONSTRAINT "platform_shipment_groups_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "platform_shipment_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shipment_lines" ADD CONSTRAINT "platform_shipment_lines_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shipment_lines" ADD CONSTRAINT "platform_shipment_lines_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "platform_shipment_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shipment_lines" ADD CONSTRAINT "platform_shipment_lines_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "platform_shipment_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shipment_lines" ADD CONSTRAINT "platform_shipment_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
