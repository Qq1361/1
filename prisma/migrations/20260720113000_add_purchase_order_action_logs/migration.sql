-- CreateTable
CREATE TABLE "purchase_order_action_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "actionType" TEXT NOT NULL,
    "productNameSnapshot" TEXT,
    "skuSnapshot" TEXT,
    "reasonCode" TEXT,
    "note" TEXT,
    "beforeItemCount" INTEGER,
    "afterItemCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_order_action_logs_ownerId_createdAt_idx"
ON "purchase_order_action_logs"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "purchase_order_action_logs_purchaseOrderId_createdAt_idx"
ON "purchase_order_action_logs"("purchaseOrderId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "purchase_order_action_logs"
ADD CONSTRAINT "purchase_order_action_logs_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_action_logs"
ADD CONSTRAINT "purchase_order_action_logs_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
