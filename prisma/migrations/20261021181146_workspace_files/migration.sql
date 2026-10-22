-- CreateEnum
CREATE TYPE "WorkspaceFileKind" AS ENUM ('tex', 'bib', 'image', 'other');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "mainFilePath" TEXT NOT NULL DEFAULT 'main.tex',
ALTER COLUMN "content" DROP NOT NULL;

-- CreateTable
CREATE TABLE "workspace_files" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" "WorkspaceFileKind" NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_files_documentId_idx" ON "workspace_files"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_files_documentId_path_key" ON "workspace_files"("documentId", "path");

-- AddForeignKey
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
