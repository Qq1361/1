CREATE TYPE "PurchasePlatform" AS ENUM ('XIANYU');
CREATE TYPE "PurchaseOrderStatus" AS ENUM (
  'PAID',
  'WAITING_SHIPMENT',
  'IN_TRANSIT',
  'PENDING_INSPECTION',
  'PARTIALLY_STOCKED',
  'STOCKED',
  'CANCELLED'
);
CREATE TYPE "AllocationStatus" AS ENUM ('UNALLOCATED', 'DRAFT', 'CONFIRMED');
CREATE TYPE "AttachmentType" AS ENUM ('PURCHASE_ORDER', 'PURCHASE_ORDER_ITEM');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_orders" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "platform" "PurchasePlatform" NOT NULL DEFAULT 'XIANYU',
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'PAID',
  "allocationStatus" "AllocationStatus" NOT NULL DEFAULT 'UNALLOCATED',
  "allocationConfirmedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3) NOT NULL,
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "shippingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "carrierCode" TEXT,
  "trackingNo" TEXT,
  "shippedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order_items" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "skuText" TEXT,
  "quantity" INTEGER NOT NULL,
  "allocatedTotalCost" DECIMAL(12,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attachments" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "entityType" "AttachmentType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_orders_ownerId_orderNo_key"
  ON "purchase_orders"("ownerId", "orderNo");
CREATE INDEX "purchase_orders_ownerId_status_idx"
  ON "purchase_orders"("ownerId", "status");
CREATE INDEX "purchase_orders_ownerId_allocationStatus_idx"
  ON "purchase_orders"("ownerId", "allocationStatus");
CREATE INDEX "purchase_order_items_purchaseOrderId_idx"
  ON "purchase_order_items"("purchaseOrderId");
CREATE INDEX "attachments_entityType_entityId_idx"
  ON "attachments"("entityType", "entityId");

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
