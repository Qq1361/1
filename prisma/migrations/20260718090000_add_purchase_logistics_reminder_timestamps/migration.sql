-- Preserve historical orders: the reminder timestamps are intentionally nullable.
ALTER TABLE "purchase_orders"
  ADD COLUMN "trackingNumberRecordedAt" TIMESTAMP(3),
  ADD COLUMN "manuallyReceivedAt" TIMESTAMP(3);
