-- Workspaces, teams, and access: backfill plus the required foreign key.
--
-- Order matters: create the default personal workspace for every user, assign every
-- existing document to it, refuse to continue if anything is unassigned, and only then
-- make documents.workspaceId required and re-scope document uniqueness to the workspace.
-- The same steps are wrapped in an application-level idempotent script
-- (scripts/migrate-workspace-ownership.ts) for repeat runs and staging rehearsals.

-- 1. One default personal workspace per user. Repeatable: users that already have one
--    (including users created by the application in the meantime) are left untouched.
INSERT INTO "workspaces" ("id", "name", "kind", "ownerUserId", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Personal', 'PERSONAL', u."id", true, now(), now()
FROM "users" u
WHERE NOT EXISTS (
    SELECT 1 FROM "workspaces" w
    WHERE w."ownerUserId" = u."id" AND w."kind" = 'PERSONAL' AND w."isDefault" IS TRUE
);

-- 2. Every document belongs to its author's default personal workspace. Documents that
--    already have a workspace are untouched, so reruns change nothing.
UPDATE "documents" d
SET "workspaceId" = w."id"
FROM "workspaces" w
WHERE d."workspaceId" IS NULL
  AND w."kind" = 'PERSONAL'
  AND w."isDefault" IS TRUE
  AND w."ownerUserId" = d."userId";

-- 3. Never tighten the schema on top of a partial assignment. The constraint is validated
--    against the guard row, so an unassigned document aborts the migration with a message
--    that names the problem instead of silently locking those rows out of every read path.
CREATE TEMP TABLE "_workspace_backfill_guard" AS
SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE COUNT(*)::text END AS "unassignedDocuments"
FROM "documents" WHERE "workspaceId" IS NULL;

ALTER TABLE "_workspace_backfill_guard"
    ADD CONSTRAINT "workspace_backfill_unassigned_documents"
    CHECK ("unassignedDocuments" IS NULL);

DROP TABLE "_workspace_backfill_guard";

-- DropIndex: uniqueness is re-scoped from the author to the collection workspace.
DROP INDEX "documents_userId_slug_key";
DROP INDEX "documents_userId_title_key";

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "workspaceId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "documents_workspaceId_title_key" ON "documents"("workspaceId", "title");
CREATE UNIQUE INDEX "documents_workspaceId_slug_key" ON "documents"("workspaceId", "slug");
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- AddForeignKey: Restrict keeps workspace deletion from silently removing documents.
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
