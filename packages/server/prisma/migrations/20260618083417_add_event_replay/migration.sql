-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "clientEventId" TEXT;

-- CreateTable
CREATE TABLE "EventReplay" (
    "id" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "eventCount" INTEGER,
    "durationMs" INTEGER,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReplay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventReplay_clientEventId_key" ON "EventReplay"("clientEventId");

-- CreateIndex
CREATE INDEX "EventReplay_projectId_idx" ON "EventReplay"("projectId");

-- CreateIndex
CREATE INDEX "Event_clientEventId_idx" ON "Event"("clientEventId");
