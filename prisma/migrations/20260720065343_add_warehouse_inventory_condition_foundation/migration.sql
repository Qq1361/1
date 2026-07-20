-- CreateEnum
CREATE TYPE "InventoryCondition" AS ENUM ('NEW', 'LIKE_NEW', 'LIGHTLY_USED', 'USED', 'FLAWED');

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "condition" "InventoryCondition",
ADD COLUMN     "storageLocationId" TEXT,
ADD COLUMN     "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouses_ownerId_isActive_idx" ON "warehouses"("ownerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_ownerId_name_key" ON "warehouses"("ownerId", "name");

-- CreateIndex
CREATE INDEX "warehouse_locations_ownerId_isActive_idx" ON "warehouse_locations"("ownerId", "isActive");

-- CreateIndex
CREATE INDEX "warehouse_locations_warehouseId_isActive_idx" ON "warehouse_locations"("warehouseId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_warehouseId_name_key" ON "warehouse_locations"("warehouseId", "name");

-- CreateIndex
CREATE INDEX "inventory_items_ownerId_warehouseId_idx" ON "inventory_items"("ownerId", "warehouseId");

-- CreateIndex
CREATE INDEX "inventory_items_ownerId_storageLocationId_idx" ON "inventory_items"("ownerId", "storageLocationId");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
