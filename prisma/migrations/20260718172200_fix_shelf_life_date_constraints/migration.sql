-- Preserve the calendar date of legacy inspection-derived expiry timestamps.
-- Existing timestamps were entered as Asia/Shanghai local dates before
-- InventoryItem.expiryDate became a PostgreSQL DATE column.
UPDATE "inventory_items" AS inventory
SET "expiryDate" = (inspection."expiryDate" AT TIME ZONE 'Asia/Shanghai')::date
FROM "inspections" AS inspection
WHERE inventory."inspectionId" = inspection."id"
  AND inventory."expiryDate" IS NOT NULL
  AND inspection."expiryDate" IS NOT NULL;

ALTER TABLE "purchase_order_items"
ADD CONSTRAINT "purchase_order_items_shelf_life_months_range"
CHECK ("shelfLifeMonths" IS NULL OR "shelfLifeMonths" BETWEEN 1 AND 600),
ADD CONSTRAINT "purchase_order_items_shelf_life_date_order"
CHECK (
  "productionDate" IS NULL
  OR "expiryDate" IS NULL
  OR "expiryDate" >= "productionDate"
);

ALTER TABLE "inventory_items"
ADD CONSTRAINT "inventory_items_shelf_life_months_range"
CHECK ("shelfLifeMonths" IS NULL OR "shelfLifeMonths" BETWEEN 1 AND 600),
ADD CONSTRAINT "inventory_items_shelf_life_date_order"
CHECK (
  "productionDate" IS NULL
  OR "expiryDate" IS NULL
  OR "expiryDate" >= "productionDate"
);
