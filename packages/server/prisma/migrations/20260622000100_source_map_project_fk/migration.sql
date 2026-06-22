-- AddForeignKey
ALTER TABLE "SourceMap" ADD CONSTRAINT "SourceMap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
