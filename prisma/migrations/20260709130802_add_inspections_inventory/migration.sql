-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PASSED', 'PROBLEM');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'PROBLEM');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('LOCAL', 'DEWU_WAREHOUSE', 'RETURNING', 'SOLD');

-- CreateEnum
CREATE TYPE "SaleMode" AS ENUM ('NONE', 'DEWU_LIGHTNING', 'DEWU_STANDARD', 'NINETY_FIVE', 'XIANYU', 'OTHER');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('PENDING_INSPECTION', 'STOCKED', 'LISTED', 'IN_BATCH', 'SHIPPED_TO_WAREHOUSE', 'WAREHOUSE_RECEIVED', 'INBOUND_SUCCESS', 'INBOUND_FAILED', 'PENDING_SETTLEMENT', 'SETTLED', 'PROBLEM');

-- AlterEnum
ALTER TYPE "AttachmentType" ADD VALUE 'INSPECTION';

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "hasBox" BOOLEAN,
    "capCondition" TEXT,
    "paintCondition" TEXT,
    "leakageCondition" TEXT,
    "isNew" BOOLEAN,
    "hasUsageTrace" BOOLEAN,
    "batchCode" TEXT,
    "expiryDate" TIMESTAMP(3),
    "appearanceNotes" TEXT,
    "result" "InspectionResult",
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "inventoryCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skuText" TEXT,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "locationStatus" "LocationStatus" NOT NULL DEFAULT 'LOCAL',
    "saleMode" "SaleMode" NOT NULL DEFAULT 'NONE',
    "itemStatus" "ItemStatus" NOT NULL,
    "stockedAt" TIMESTAMP(3) NOT NULL,
    "outboundAt" TIMESTAMP(3),
    "problemReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspections_ownerId_status_idx" ON "inspections"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_purchaseOrderItemId_sequence_key" ON "inspections"("purchaseOrderItemId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_inspectionId_key" ON "inventory_items"("inspectionId");

-- CreateIndex
CREATE INDEX "inventory_items_ownerId_itemStatus_idx" ON "inventory_items"("ownerId", "itemStatus");

-- CreateIndex
CREATE INDEX "inventory_items_ownerId_locationStatus_saleMode_idx" ON "inventory_items"("ownerId", "locationStatus", "saleMode");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_ownerId_inventoryCode_key" ON "inventory_items"("ownerId", "inventoryCode");

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
