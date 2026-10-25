-- Assign every document to its author's default personal workspace, then make the
-- relationship required and re-scope document uniqueness from the author to the workspace.
--
-- The statements are written to be safe to run against a database that was already backfilled
-- by scripts/backfill-workspaces.ts: everything is guarded by NOT EXISTS / IS NULL checks, so a
-- second pass is a no-op. Documents keep their id, author, slug, content, files, assets and
-- chats; only the new workspaceId column is written.

-- 1. One default personal workspace per user, including users with no documents yet.
INSERT INTO "workspaces" ("id", "name", "kind", "ownerUserId", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Personal', 'PERSONAL', "u"."id", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" "u"
WHERE NOT EXISTS (
  SELECT 1 FROM "workspaces" "w"
  WHERE "w"."ownerUserId" = "u"."id" AND "w"."kind" = 'PERSONAL' AND "w"."isDefault" = true
)
ON CONFLICT DO NOTHING;

-- 2. Every document joins its author's default personal workspace. Documents whose author row
--    is gone are left alone and reported by the verifier instead of being silently reassigned.
UPDATE "documents" "d"
SET "workspaceId" = "w"."id"
FROM "workspaces" "w"
WHERE "d"."workspaceId" IS NULL
  AND "w"."kind" = 'PERSONAL'
  AND "w"."isDefault" = true
  AND "w"."ownerUserId" = "d"."userId";

-- 3. Fail loudly rather than converting the column to NOT NULL over unassigned rows.
DO $$
DECLARE
  unassigned integer;
BEGIN
  SELECT COUNT(*) INTO unassigned FROM "documents" WHERE "workspaceId" IS NULL;
  IF unassigned > 0 THEN
    RAISE EXCEPTION 'workspaces backfill incomplete: % document(s) have no workspace. Run `bun run backfill:workspaces` first.', unassigned;
  END IF;
END $$;

ALTER TABLE "documents" ALTER COLUMN "workspaceId" SET NOT NULL;

-- 4. A collection workspace is the uniqueness scope: the same title or URL may exist in two
--    different workspaces, which the author-scoped indexes forbade.
DROP INDEX "documents_userId_slug_key";
DROP INDEX "documents_userId_title_key";
CREATE UNIQUE INDEX "documents_workspaceId_slug_key" ON "documents"("workspaceId", "slug");
CREATE UNIQUE INDEX "documents_workspaceId_title_key" ON "documents"("workspaceId", "title");
