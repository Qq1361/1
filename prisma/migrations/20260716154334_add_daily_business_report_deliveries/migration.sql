-- CreateEnum
CREATE TYPE "DailyBusinessReportDeliveryChannel" AS ENUM ('FEISHU');

-- CreateEnum
CREATE TYPE "DailyBusinessReportDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "daily_business_report_deliveries" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "channel" "DailyBusinessReportDeliveryChannel" NOT NULL,
    "status" "DailyBusinessReportDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "providerRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_business_report_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_business_report_deliveries_idempotencyKey_key" ON "daily_business_report_deliveries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "daily_business_report_deliveries_ownerId_reportDate_idx" ON "daily_business_report_deliveries"("ownerId", "reportDate");

-- CreateIndex
CREATE INDEX "daily_business_report_deliveries_ownerId_status_updatedAt_idx" ON "daily_business_report_deliveries"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "daily_business_report_deliveries_ownerId_reportDate_channel_key" ON "daily_business_report_deliveries"("ownerId", "reportDate", "channel");

-- AddForeignKey
ALTER TABLE "daily_business_report_deliveries" ADD CONSTRAINT "daily_business_report_deliveries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
