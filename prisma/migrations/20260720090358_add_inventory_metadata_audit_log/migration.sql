-- CreateTable
CREATE TABLE "inventory_item_action_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "batchId" TEXT,
    "actionType" TEXT NOT NULL,
    "beforeData" JSONB NOT NULL,
    "afterData" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_item_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_item_action_logs_ownerId_createdAt_idx" ON "inventory_item_action_logs"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "inventory_item_action_logs_inventoryItemId_createdAt_idx" ON "inventory_item_action_logs"("inventoryItemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "inventory_item_action_logs_ownerId_batchId_idx" ON "inventory_item_action_logs"("ownerId", "batchId");

-- AddForeignKey
ALTER TABLE "inventory_item_action_logs" ADD CONSTRAINT "inventory_item_action_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_action_logs" ADD CONSTRAINT "inventory_item_action_logs_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
