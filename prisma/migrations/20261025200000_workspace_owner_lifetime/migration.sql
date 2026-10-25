-- Workspace lifetime follows the thing that owns it.
--
-- "workspaces_exactly_one_owner" requires exactly one of "ownerUserId" / "teamId" to be set.
-- The original foreign keys used ON DELETE SET NULL, which would clear both columns and make
-- the deletion of any account that owns a workspace fail partway through, leaving the account
-- gone and its collection stranded. Cascading keeps the constraint true: the collection
-- disappears together with the account or team that owned it.
--
-- Documents are unaffected by this change. They cascade from their author through
-- "documents_userId_fkey", and a workspace that still holds rows cannot be deleted at all,
-- because "documents_workspaceId_fkey" is RESTRICT.

ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_ownerUserId_fkey";

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_teamId_fkey";

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id")
  ON UPDATE CASCADE ON DELETE CASCADE;
