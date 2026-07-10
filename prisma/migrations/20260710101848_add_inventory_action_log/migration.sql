-- CreateTable
CREATE TABLE "inventory_action_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "todoType" TEXT,
    "reasonKey" TEXT,
    "actionType" TEXT NOT NULL,
    "note" TEXT,
    "oldSaleMode" TEXT,
    "newSaleMode" TEXT,
    "oldItemStatus" TEXT,
    "newItemStatus" TEXT,
    "oldStorageLocation" TEXT,
    "newStorageLocation" TEXT,
    "oldExpiryDate" TIMESTAMP(3),
    "newExpiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todo_resolutions" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "todoType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reasonKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todo_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_action_logs_ownerId_inventoryItemId_createdAt_idx" ON "inventory_action_logs"("ownerId", "inventoryItemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "inventory_action_logs_ownerId_purchaseOrderId_idx" ON "inventory_action_logs"("ownerId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "todo_resolutions_ownerId_entityType_entityId_idx" ON "todo_resolutions"("ownerId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "todo_resolutions_ownerId_resolvedAt_idx" ON "todo_resolutions"("ownerId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "todo_resolutions_ownerId_todoType_reasonKey_key" ON "todo_resolutions"("ownerId", "todoType", "reasonKey");

-- AddForeignKey
ALTER TABLE "inventory_action_logs" ADD CONSTRAINT "inventory_action_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_action_logs" ADD CONSTRAINT "inventory_action_logs_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_resolutions" ADD CONSTRAINT "todo_resolutions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
