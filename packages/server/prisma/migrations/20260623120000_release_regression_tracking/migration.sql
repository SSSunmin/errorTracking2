-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "firstRelease" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "isRegression" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Event_projectId_release_isRegression_idx" ON "Event"("projectId", "release", "isRegression");
