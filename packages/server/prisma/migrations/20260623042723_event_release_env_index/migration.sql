-- CreateIndex
CREATE INDEX "Event_projectId_release_idx" ON "Event"("projectId", "release");

-- CreateIndex
CREATE INDEX "Event_projectId_environment_idx" ON "Event"("projectId", "environment");
