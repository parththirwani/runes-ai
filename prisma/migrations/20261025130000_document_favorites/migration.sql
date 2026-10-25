ALTER TABLE "documents" ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "documents_userId_isFavorite_idx" ON "documents"("userId", "isFavorite");
