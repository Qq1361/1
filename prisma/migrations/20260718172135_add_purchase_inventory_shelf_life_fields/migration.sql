-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "productionDate" DATE,
ADD COLUMN     "shelfLifeMonths" INTEGER,
ALTER COLUMN "expiryDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "expiryDate" DATE,
ADD COLUMN     "productionDate" DATE,
ADD COLUMN     "shelfLifeMonths" INTEGER;
