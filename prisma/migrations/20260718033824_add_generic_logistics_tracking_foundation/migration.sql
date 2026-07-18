-- CreateEnum
CREATE TYPE "LogisticsBusinessType" AS ENUM ('PURCHASE_INBOUND', 'PLATFORM_OUTBOUND', 'PLATFORM_RETURN', 'PURCHASE_AFTER_SALE_RETURN', 'SALE_AFTER_SALE_RETURN');

-- CreateEnum
CREATE TYPE "LogisticsTrackingStatus" AS ENUM ('UNKNOWN', 'PENDING_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogisticsSyncStatus" AS ENUM ('NEVER_SYNCED', 'PENDING', 'SYNCED', 'RETRYABLE_ERROR', 'TERMINAL_ERROR', 'STOPPED');

-- CreateTable
CREATE TABLE "logistics_shipments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "businessType" "LogisticsBusinessType" NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "carrierName" TEXT,
    "trackingNumber" TEXT NOT NULL,
    "normalizedTrackingNumber" TEXT NOT NULL,
    "currentStatus" "LogisticsTrackingStatus" NOT NULL DEFAULT 'UNKNOWN',
    "rawStatusCode" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "nextSyncAt" TIMESTAMP(3),
    "syncStatus" "LogisticsSyncStatus" NOT NULL DEFAULT 'NEVER_SYNCED',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_tracking_events" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "logisticsShipmentId" TEXT NOT NULL,
    "providerEventId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "status" "LogisticsTrackingStatus" NOT NULL,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "rawStatusCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "logistics_shipments_ownerId_currentStatus_idx" ON "logistics_shipments"("ownerId", "currentStatus");

-- CreateIndex
CREATE INDEX "logistics_shipments_provider_carrierCode_normalizedTracking_idx" ON "logistics_shipments"("provider", "carrierCode", "normalizedTrackingNumber");

-- CreateIndex
CREATE INDEX "logistics_shipments_syncStatus_nextSyncAt_idx" ON "logistics_shipments"("syncStatus", "nextSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_shipments_ownerId_businessType_businessId_key" ON "logistics_shipments"("ownerId", "businessType", "businessId");

-- CreateIndex
CREATE INDEX "logistics_tracking_events_logisticsShipmentId_eventTime_idx" ON "logistics_tracking_events"("logisticsShipmentId", "eventTime");

-- CreateIndex
CREATE INDEX "logistics_tracking_events_ownerId_idx" ON "logistics_tracking_events"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_tracking_events_logisticsShipmentId_dedupeKey_key" ON "logistics_tracking_events"("logisticsShipmentId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "logistics_shipments" ADD CONSTRAINT "logistics_shipments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_tracking_events" ADD CONSTRAINT "logistics_tracking_events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_tracking_events" ADD CONSTRAINT "logistics_tracking_events_logisticsShipmentId_fkey" FOREIGN KEY ("logisticsShipmentId") REFERENCES "logistics_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "logistics_shipments"
ADD CONSTRAINT "logistics_shipments_required_text_check"
CHECK (
    length(btrim("businessId")) > 0
    AND length(btrim("provider")) > 0
    AND length(btrim("carrierCode")) > 0
    AND length(btrim("trackingNumber")) > 0
    AND length(btrim("normalizedTrackingNumber")) > 0
);

-- AddCheckConstraint
ALTER TABLE "logistics_shipments"
ADD CONSTRAINT "logistics_shipments_failure_count_check"
CHECK ("failureCount" >= 0);

-- AddCheckConstraint
ALTER TABLE "logistics_tracking_events"
ADD CONSTRAINT "logistics_tracking_events_required_text_check"
CHECK (length(btrim("dedupeKey")) > 0 AND length(btrim("description")) > 0);
