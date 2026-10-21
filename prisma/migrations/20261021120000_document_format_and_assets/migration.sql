-- Add immutable document format and the owned Markdown asset store.
--
-- Existing documents are LaTeX and must stay LaTeX: the column is added with
-- a non-null LATEX default so every pre-existing row is backfilled by the
-- ALTER, and the explicit UPDATE below performs the documented backfill
-- statement for any row that could still be missing a value.

-- CreateEnum
CREATE TYPE "DocumentFormat" AS ENUM ('LATEX', 'MARKDOWN');

-- AlterTable: backfills all existing rows to LATEX (IDs, slugs, titles,
-- content, chat sessions, and links are untouched).
ALTER TABLE "documents" ADD COLUMN "format" "DocumentFormat" NOT NULL DEFAULT 'LATEX';

-- Explicit backfill: at migration time no MARKDOWN rows can exist, so this
-- normalizes every document to LATEX and serves as the documented proof
-- statement.
UPDATE "documents" SET "format" = 'LATEX';

-- CreateTable
CREATE TABLE "document_assets" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_assets_documentId_path_key" ON "document_assets"("documentId", "path");

-- CreateIndex
CREATE INDEX "document_assets_documentId_idx" ON "document_assets"("documentId");

-- AddForeignKey
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
