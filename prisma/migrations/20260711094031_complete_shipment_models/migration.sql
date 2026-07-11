/*
  Warnings:

  - You are about to drop the column `purpose` on the `platform_shipment_batches` table. All the data in the column will be lost.
  - You are about to drop the column `saleModeSnapshot` on the `platform_shipment_lines` table. All the data in the column will be lost.
  - Added the required column `defaultPurpose` to the `platform_shipment_batches` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShipmentBatchStatus" ADD VALUE 'PARTIALLY_IN_WAREHOUSE';
ALTER TYPE "ShipmentBatchStatus" ADD VALUE 'IN_WAREHOUSE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShipmentLineStatus" ADD VALUE 'DRAFT';
ALTER TYPE "ShipmentLineStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "ShipmentLineStatus" ADD VALUE 'SOLD';

-- AlterTable
ALTER TABLE "platform_shipment_batches" DROP COLUMN "purpose",
ADD COLUMN     "defaultPurpose" "ShipmentPurpose" NOT NULL,
ADD COLUMN     "otherShipmentCost" DECIMAL(12,2),
ADD COLUMN     "outboundShippingCost" DECIMAL(12,2),
ADD COLUMN     "packagingCost" DECIMAL(12,2),
ADD COLUMN     "returnShippingCost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "platform_shipment_groups" ADD COLUMN     "purpose" "ShipmentPurpose";

-- AlterTable
ALTER TABLE "platform_shipment_lines" DROP COLUMN "saleModeSnapshot",
ADD COLUMN     "newSaleModeSnapshot" TEXT,
ADD COLUMN     "oldSaleModeSnapshot" TEXT,
ADD COLUMN     "packedChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "packedCheckedAt" TIMESTAMP(3),
ALTER COLUMN "lineStatus" SET DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "platform_shipment_attachments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "lineId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_shipment_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_shipment_action_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "lineId" TEXT,
    "inventoryItemId" TEXT,
    "actionType" TEXT NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "oldItemStatus" TEXT,
    "newItemStatus" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_shipment_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_shipment_attachments_ownerId_batchId_idx" ON "platform_shipment_attachments"("ownerId", "batchId");

-- CreateIndex
CREATE INDEX "platform_shipment_action_logs_ownerId_batchId_createdAt_idx" ON "platform_shipment_action_logs"("ownerId", "batchId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "platform_shipment_action_logs_ownerId_inventoryItemId_idx" ON "platform_shipment_action_logs"("ownerId", "inventoryItemId");

-- AddForeignKey
ALTER TABLE "platform_shipment_attachments" ADD CONSTRAINT "platform_shipment_attachments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shipment_attachments" ADD CONSTRAINT "platform_shipment_attachments_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "platform_shipment_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shipment_action_logs" ADD CONSTRAINT "platform_shipment_action_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shipment_action_logs" ADD CONSTRAINT "platform_shipment_action_logs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "platform_shipment_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
