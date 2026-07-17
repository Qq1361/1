-- Prisma wraps PostgreSQL migrations in a transaction. Do not add an automatic
-- status mapping here: legacy records must be migrated explicitly before deploy.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "inventory_items"
    WHERE "itemStatus"::text = ANY (ARRAY[
      'LISTED',
      'IN_BATCH',
      'SHIPPED_TO_WAREHOUSE',
      'WAREHOUSE_RECEIVED',
      'INBOUND_SUCCESS',
      'INBOUND_FAILED',
      'PENDING_SETTLEMENT',
      'SETTLED'
    ])
  ) THEN
    RAISE EXCEPTION '检测到旧 InventoryItem 状态，请先运行 pnpm audit:item-status 并人工迁移数据。';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_type item_status_type ON item_status_type.oid = attribute.atttypid
    WHERE namespace.nspname = 'public'
      AND item_status_type.typname = 'ItemStatus'
      AND relation.relkind IN ('r', 'p')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND NOT (relation.relname = 'inventory_items' AND attribute.attname = 'itemStatus')
  ) THEN
    RAISE EXCEPTION 'ItemStatus 存在未审计的数据列依赖；请先审计并更新迁移。';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attrdef default_value
    JOIN pg_attribute attribute
      ON attribute.attrelid = default_value.adrelid
      AND attribute.attnum = default_value.adnum
    WHERE default_value.adrelid = 'public.inventory_items'::regclass
      AND attribute.attname = 'itemStatus'
  ) THEN
    RAISE EXCEPTION 'inventory_items.itemStatus 存在默认值；请先审计并显式保留默认值。';
  END IF;
END $$;

CREATE TYPE "ItemStatus_new" AS ENUM (
  'PENDING_INSPECTION',
  'STOCKED',
  'PLATFORM_SHIPPED',
  'PLATFORM_RECEIVED',
  'PLATFORM_IN_WAREHOUSE',
  'PLATFORM_LISTED',
  'PLATFORM_REJECTED',
  'RETURNING',
  'RETURNED',
  'SOLD',
  'PROBLEM'
);

ALTER TABLE "inventory_items"
  ALTER COLUMN "itemStatus" TYPE "ItemStatus_new"
  USING ("itemStatus"::text::"ItemStatus_new");

ALTER TYPE "ItemStatus" RENAME TO "ItemStatus_legacy";
ALTER TYPE "ItemStatus_new" RENAME TO "ItemStatus";
DROP TYPE "ItemStatus_legacy";
