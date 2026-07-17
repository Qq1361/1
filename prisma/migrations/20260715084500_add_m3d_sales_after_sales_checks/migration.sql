-- Enforce sales-after-sales monetary invariants at the database boundary.
-- Allocation totals and all workflow transitions remain future service work.
ALTER TABLE "sale_after_sale_lines"
  ADD CONSTRAINT "sale_after_sale_lines_requested_refund_positive"
  CHECK ("requestedRefundAmount" > 0),
  ADD CONSTRAINT "sale_after_sale_lines_approved_refund_non_negative"
  CHECK ("approvedRefundAmount" IS NULL OR "approvedRefundAmount" >= 0);

ALTER TABLE "sale_refund_records"
  ADD CONSTRAINT "sale_refund_records_refund_amount_positive"
  CHECK ("refundAmount" > 0);

ALTER TABLE "sale_refund_allocations"
  ADD CONSTRAINT "sale_refund_allocations_amount_positive"
  CHECK ("amount" > 0);
