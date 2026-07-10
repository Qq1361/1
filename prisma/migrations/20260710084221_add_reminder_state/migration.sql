-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SNOOZED', 'RESOLVED');

-- CreateTable
CREATE TABLE "reminder_states" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "todoType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "ReminderStatus" NOT NULL,
    "snoozedUntil" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminder_states_ownerId_status_snoozedUntil_idx" ON "reminder_states"("ownerId", "status", "snoozedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_states_ownerId_todoType_entityType_entityId_key" ON "reminder_states"("ownerId", "todoType", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "reminder_states" ADD CONSTRAINT "reminder_states_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
