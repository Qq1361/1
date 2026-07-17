ALTER TABLE "daily_business_report_deliveries"
  ADD CONSTRAINT "daily_business_report_deliveries_attempt_count_nonnegative"
  CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "daily_business_report_deliveries_timezone_supported"
  CHECK ("timezone" = 'Asia/Shanghai'),
  ADD CONSTRAINT "daily_business_report_deliveries_idempotency_key_nonblank"
  CHECK (length(btrim("idempotencyKey")) > 0),
  ADD CONSTRAINT "daily_business_report_deliveries_sent_has_timestamp"
  CHECK ("status" <> 'SENT' OR "sentAt" IS NOT NULL),
  ADD CONSTRAINT "daily_business_report_deliveries_failed_has_safe_error"
  CHECK (
    "status" <> 'FAILED'
    OR (
      "failedAt" IS NOT NULL
      AND "lastErrorCode" IS NOT NULL
      AND length(btrim("lastErrorCode")) > 0
    )
  );
