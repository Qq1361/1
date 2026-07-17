-- CreateEnum
CREATE TYPE "PlatformReturnInspectionResult" AS ENUM ('RESTOCKED', 'PROBLEM', 'PENDING_DECISION');

-- CreateTable
CREATE TABLE "platform_return_inspections" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "shipmentLineId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "result" "PlatformReturnInspectionResult" NOT NULL,
    "storageLocation" TEXT,
    "problemReason" TEXT,
    "note" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_return_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_return_action_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromResult" "PlatformReturnInspectionResult",
    "toResult" "PlatformReturnInspectionResult",
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_return_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_return_inspections_shipmentLineId_key" ON "platform_return_inspections"("shipmentLineId");

-- CreateIndex
CREATE INDEX "platform_return_inspections_ownerId_idx" ON "platform_return_inspections"("ownerId");

-- CreateIndex
CREATE INDEX "platform_return_inspections_ownerId_result_idx" ON "platform_return_inspections"("ownerId", "result");

-- CreateIndex
CREATE INDEX "platform_return_inspections_ownerId_inspectedAt_idx" ON "platform_return_inspections"("ownerId", "inspectedAt");

-- CreateIndex
CREATE INDEX "platform_return_inspections_inventoryItemId_idx" ON "platform_return_inspections"("inventoryItemId");

-- CreateIndex
CREATE INDEX "platform_return_action_logs_ownerId_idx" ON "platform_return_action_logs"("ownerId");

-- CreateIndex
CREATE INDEX "platform_return_action_logs_inspectionId_createdAt_idx" ON "platform_return_action_logs"("inspectionId", "createdAt");

-- CreateIndex
CREATE INDEX "platform_return_action_logs_ownerId_createdAt_idx" ON "platform_return_action_logs"("ownerId", "createdAt");

-- AddConstraint
ALTER TABLE "platform_return_inspections"
  ADD CONSTRAINT "platform_return_inspections_restocked_storage_location_check"
  CHECK (
    "result" <> 'RESTOCKED'::"PlatformReturnInspectionResult"
    OR btrim(COALESCE("storageLocation", '')) <> ''
  );

-- AddConstraint
ALTER TABLE "platform_return_inspections"
  ADD CONSTRAINT "platform_return_inspections_problem_reason_or_note_check"
  CHECK (
    "result" <> 'PROBLEM'::"PlatformReturnInspectionResult"
    OR btrim(COALESCE("problemReason", '')) <> ''
    OR btrim(COALESCE("note", '')) <> ''
  );

-- AddForeignKey
ALTER TABLE "platform_return_inspections" ADD CONSTRAINT "platform_return_inspections_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_return_inspections" ADD CONSTRAINT "platform_return_inspections_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "platform_shipment_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_return_inspections" ADD CONSTRAINT "platform_return_inspections_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_return_action_logs" ADD CONSTRAINT "platform_return_action_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_return_action_logs" ADD CONSTRAINT "platform_return_action_logs_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "platform_return_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
