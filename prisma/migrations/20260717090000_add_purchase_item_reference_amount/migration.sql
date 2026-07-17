-- Add the optional purchase-item reference total without backfilling history.
ALTER TABLE "purchase_order_items"
ADD COLUMN "referenceAmount" DECIMAL(12,2);

ALTER TABLE "purchase_order_items"
ADD CONSTRAINT "purchase_order_items_referenceAmount_nonnegative"
CHECK ("referenceAmount" IS NULL OR "referenceAmount" >= 0);
