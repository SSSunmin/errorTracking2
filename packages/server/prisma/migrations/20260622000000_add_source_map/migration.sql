-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "symbolicated" JSONB;

-- CreateTable
CREATE TABLE "SourceMap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceMap_projectId_release_idx" ON "SourceMap"("projectId", "release");

-- CreateIndex
CREATE UNIQUE INDEX "SourceMap_projectId_release_filename_key" ON "SourceMap"("projectId", "release", "filename");
