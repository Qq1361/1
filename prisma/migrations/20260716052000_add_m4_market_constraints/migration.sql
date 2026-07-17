-- AddConstraint
ALTER TABLE "market_items"
  ADD CONSTRAINT "market_items_display_name_not_blank_check"
  CHECK (btrim("displayName") <> '');

-- AddConstraint
ALTER TABLE "market_items"
  ADD CONSTRAINT "market_items_normalized_name_not_blank_check"
  CHECK (btrim("normalizedName") <> '');

-- AddConstraint
ALTER TABLE "market_items"
  ADD CONSTRAINT "market_items_normalized_sku_not_blank_check"
  CHECK ("normalizedSku" IS NULL OR btrim("normalizedSku") <> '');

-- AddConstraint
ALTER TABLE "market_items"
  ADD CONSTRAINT "market_items_default_target_profit_non_negative_check"
  CHECK ("defaultTargetProfitAmount" IS NULL OR "defaultTargetProfitAmount" >= 0);

-- AddConstraint
ALTER TABLE "market_quotes"
  ADD CONSTRAINT "market_quotes_amount_non_negative_check"
  CHECK ("amount" >= 0);

-- AddConstraint
ALTER TABLE "market_quotes"
  ADD CONSTRAINT "market_quotes_expiry_after_recorded_at_check"
  CHECK ("expiresAt" IS NULL OR "expiresAt" > "recordedAt");

-- AddConstraint
ALTER TABLE "market_quotes"
  ADD CONSTRAINT "market_quotes_invalidation_reason_pair_check"
  CHECK (
    ("invalidatedAt" IS NULL AND "invalidationReason" IS NULL)
    OR ("invalidatedAt" IS NOT NULL AND btrim(COALESCE("invalidationReason", '')) <> '')
  );

-- AddConstraint
ALTER TABLE "market_quotes"
  ADD CONSTRAINT "market_quotes_source_reference_not_blank_check"
  CHECK ("sourceReference" IS NULL OR btrim("sourceReference") <> '');
