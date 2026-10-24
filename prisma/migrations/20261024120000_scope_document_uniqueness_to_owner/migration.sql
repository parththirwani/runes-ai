-- Document URLs and title checks are scoped to the signed-in owner.
-- The old global indexes prevented another user from creating a document
-- with the same title or slug.
DROP INDEX "documents_title_key";
DROP INDEX "documents_slug_key";
CREATE UNIQUE INDEX "documents_userId_slug_key" ON "documents"("userId", "slug");
