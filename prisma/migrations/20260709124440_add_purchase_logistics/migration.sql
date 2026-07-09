-- CreateEnum
CREATE TYPE "LogisticsStatus" AS ENUM ('NOT_SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'STALLED', 'RETURNING', 'UNKNOWN');

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "logisticsExceptionMessage" TEXT,
ADD COLUMN     "logisticsExceptionType" TEXT,
ADD COLUMN     "logisticsLastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "logisticsLastEventAt" TIMESTAMP(3),
ADD COLUMN     "logisticsLastEventText" TEXT,
ADD COLUMN     "logisticsStatus" "LogisticsStatus" NOT NULL DEFAULT 'NOT_SHIPPED';

-- CreateTable
CREATE TABLE "logistics_events" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "trackingNo" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "eventText" TEXT NOT NULL,
    "location" TEXT,
    "status" "LogisticsStatus" NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "logistics_events_ownerId_status_idx" ON "logistics_events"("ownerId", "status");

-- CreateIndex
CREATE INDEX "logistics_events_purchaseOrderId_eventTime_idx" ON "logistics_events"("purchaseOrderId", "eventTime");

-- AddForeignKey
ALTER TABLE "logistics_events" ADD CONSTRAINT "logistics_events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_events" ADD CONSTRAINT "logistics_events_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
