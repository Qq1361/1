-- Preserve the Asia/Shanghai calendar date represented by legacy inspection timestamps.
-- New M7-A1 snapshots already write DATE values and do not use this conversion.
UPDATE "inventory_items" AS inventory
SET "expiryDate" = (
  (
    inspection."expiryDate" AT TIME ZONE 'UTC'
  ) AT TIME ZONE 'Asia/Shanghai'
)::date
FROM "inspections" AS inspection
WHERE inventory."inspectionId" = inspection."id"
  AND inventory."expiryDate" IS NOT NULL
  AND inspection."expiryDate" IS NOT NULL
  AND inventory."expiryDate" = inspection."expiryDate"::date;
