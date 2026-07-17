-- CreateEnum
CREATE TYPE "MarketPlatform" AS ENUM ('DEWU', 'NINETY_FIVE', 'XIANYU', 'OTHER');

-- CreateEnum
CREATE TYPE "MarketQuoteType" AS ENUM ('EXPECTED_INCOME', 'LISTING_PRICE', 'MANUAL_REFERENCE');

-- CreateEnum
CREATE TYPE "MarketQuoteSourceType" AS ENUM ('MANUAL');

-- CreateTable
CREATE TABLE "market_items" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "skuText" TEXT,
    "normalizedSku" TEXT,
    "versionText" TEXT,
    "conditionText" TEXT,
    "packageVariant" TEXT,
    "accessoryVariant" TEXT,
    "defaultTargetProfitAmount" DECIMAL(12,2),
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_quotes" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "marketItemId" TEXT NOT NULL,
    "platform" "MarketPlatform" NOT NULL,
    "quoteType" "MarketQuoteType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "sourceType" "MarketQuoteSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceReference" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_items_ownerId_isActive_idx" ON "market_items"("ownerId", "isActive");

-- CreateIndex
CREATE INDEX "market_items_ownerId_normalizedName_idx" ON "market_items"("ownerId", "normalizedName");

-- CreateIndex
CREATE INDEX "market_items_ownerId_normalizedName_normalizedSku_idx" ON "market_items"("ownerId", "normalizedName", "normalizedSku");

-- CreateIndex
CREATE INDEX "market_items_ownerId_updatedAt_idx" ON "market_items"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "market_quotes_ownerId_marketItemId_recordedAt_idx" ON "market_quotes"("ownerId", "marketItemId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "market_quotes_ownerId_marketItemId_platform_quoteType_recor_idx" ON "market_quotes"("ownerId", "marketItemId", "platform", "quoteType", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "market_quotes_ownerId_platform_recordedAt_idx" ON "market_quotes"("ownerId", "platform", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "market_quotes_ownerId_confirmedAt_invalidatedAt_idx" ON "market_quotes"("ownerId", "confirmedAt", "invalidatedAt");

-- CreateIndex
CREATE INDEX "market_quotes_expiresAt_idx" ON "market_quotes"("expiresAt");

-- AddForeignKey
ALTER TABLE "market_items" ADD CONSTRAINT "market_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_quotes" ADD CONSTRAINT "market_quotes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_quotes" ADD CONSTRAINT "market_quotes_marketItemId_fkey" FOREIGN KEY ("marketItemId") REFERENCES "market_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
