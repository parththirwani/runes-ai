#!/usr/bin/env bash
# Migration proof for workspaces, teams, and access (docs/workspaces-teams-access-plan.md).
#
# Builds a scratch database at the PRE-workspace schema, seeds it with legacy documents
# (plus a workspace file, a Markdown asset, and a chat), then proves:
#
#   1. the additive migration plus the repeatable ownership script give every user exactly
#      one default personal workspace and put every document in its author's default workspace,
#   2. document ids, slugs, titles, authors, content bytes, files, assets and chats survive,
#   3. re-running the ownership script changes nothing (idempotent backfill),
#   4. the required-column migration aborts on a partially assigned database and applies no DDL.
#
# Requires a local PostgreSQL superuser reachable through DATABASE_URL.
# Runs the TypeScript script with bun when available, otherwise with esbuild + node.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_URL="${DATABASE_URL:-postgresql://runes:runes@localhost:5432/runes?schema=public}"
# psql rejects the ?schema=public parameter that Prisma URLs carry, so derive a plain URI.
ADMIN_URL="${DB_URL%%\?*}"
ADMIN_BASE="${ADMIN_URL%/*}"
SCRATCH="workspace_access_proof"
PROOF_DB="${ADMIN_BASE}/${SCRATCH}"
DB_OWNER="$(psql "$ADMIN_URL" -tA -c "SELECT current_user")"

fail() {
  echo "FAIL: $1"
  exit 1
}

run_script() {
  if command -v bun >/dev/null 2>&1; then
    DATABASE_URL="$PROOF_DB" bun run scripts/migrate-workspace-ownership.ts "$1"
  else
    mkdir -p temp
    npx --yes esbuild scripts/migrate-workspace-ownership.ts --bundle --platform=node \
      --format=esm --packages=external --log-level=error \
      --outfile=temp/workspace-proof-script.mjs >/dev/null
    DATABASE_URL="$PROOF_DB" node temp/workspace-proof-script.mjs "$1"
  fi
}

apply_migrations_before() {
  for dir in prisma/migrations/2026*; do
    case "$dir" in
      *workspaces_teams_access*|*workspace_backfill*|*workspace_owner_lifetime*) continue ;;
    esac
    psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 --single-transaction -f "$dir/migration.sql"
  done
}

reset_scratch() {
  psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $SCRATCH;" >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $SCRATCH OWNER $DB_OWNER;" >/dev/null
}

seed_legacy_rows() {
  psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (id, email, "firstName", "lastName", "createdAt", "updatedAt") VALUES
  ('user-a', 'author.a@example.com', 'Ava', 'Author', now(), now()),
  ('user-b', 'viewer.b@example.com', 'Ben', 'Viewer', now(), now());
INSERT INTO documents (id, title, content, format, "mainFilePath", "isFavorite", slug, "userId", "createdAt", "updatedAt") VALUES
  ('doc-1', 'Thesis', 'title thesis body', 'LATEX', 'main.tex', false, 'thesis', 'user-a', now(), now()),
  ('doc-2', 'Notes', '# Notes', 'MARKDOWN', 'main.md', false, 'notes', 'user-a', now(), now()),
  ('doc-3', 'Plan', '# Plan', 'MARKDOWN', 'main.md', false, 'plan', 'user-b', now(), now());
INSERT INTO workspace_files (id, "documentId", path, kind, "mimeType", "sizeBytes", checksum, revision, content, "createdAt", "updatedAt")
  VALUES ('file-1', 'doc-1', 'main.tex', 'tex', 'text/x-tex', 19, 'abc', 1, 'title thesis body', now(), now());
INSERT INTO document_assets (id, "documentId", path, "mediaType", size, checksum, bytes, "createdAt", "updatedAt")
  VALUES ('asset-1', 'doc-2', 'figures/x.png', 'image/png', 4, 'def', decode('89504e47','hex'), now(), now());
INSERT INTO chat_sessions (id, "documentId", title, "createdAt", "updatedAt") VALUES ('chat-1', 'doc-1', 'Chat', now(), now());
INSERT INTO messages (id, "chatSessionId", content, role, "createdAt", "updatedAt") VALUES ('msg-1', 'chat-1', 'hello', 'user', now(), now());
SQL
}

# Row counts plus a digest over id, slug, title, author and content, so any change in the
# data the release promises to preserve shows up as a different snapshot string.
snapshot() {
  psql "$PROOF_DB" -tA -F"|" -f - <<'SQL'
SELECT
  (SELECT COUNT(*) FROM users),
  (SELECT COUNT(*) FROM documents),
  (SELECT COUNT(*) FROM workspace_files),
  (SELECT COUNT(*) FROM document_assets),
  (SELECT COUNT(*) FROM chat_sessions),
  (SELECT COUNT(*) FROM messages),
  COALESCE(md5(string_agg(
    d.id || ':' || d.slug || ':' || d.title || ':' || d."userId" || ':' || md5(coalesce(d.content, '')),
    ',' ORDER BY d.id)), 'none')
FROM documents d;
SQL
}

assignment_check() {
  psql "$PROOF_DB" -tA -F"|" -f - <<'SQL'
SELECT
  (SELECT COUNT(*) FROM documents WHERE "workspaceId" IS NULL),
  (SELECT COUNT(*) FROM documents d JOIN workspaces w ON w.id = d."workspaceId"
     WHERE NOT (w.kind = 'PERSONAL' AND w."isDefault" AND w."ownerUserId" = d."userId")),
  (SELECT COUNT(*) FROM users u WHERE (
     SELECT COUNT(*) FROM workspaces w
     WHERE w."ownerUserId" = u.id AND w.kind = 'PERSONAL' AND w."isDefault") <> 1);
SQL
}

echo "== resetting scratch database"
reset_scratch

echo "== applying pre-workspace schema and seeding legacy rows"
apply_migrations_before
seed_legacy_rows
BEFORE="$(snapshot)"
echo "   before: $BEFORE"

echo "== applying additive migration (new tables, nullable workspaceId)"
psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 --single-transaction \
  -f prisma/migrations/20261025190000_workspaces_teams_access/migration.sql

echo "== running the repeatable ownership script"
FIRST_RUN="$(run_script apply)"
echo "   $FIRST_RUN"
case "$FIRST_RUN" in
  *"createdDefaultWorkspaces=2 assignedDocuments=3"*) ;;
  *) fail "expected 2 created default workspaces and 3 assigned documents" ;;
esac
run_script verify

echo "== applying required-column migration (guard, uniqueness, foreign key)"
psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 --single-transaction \
  -f prisma/migrations/20261025190100_workspace_backfill/migration.sql

echo "== applying workspace lifetime migration (owner foreign keys cascade)"
psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 --single-transaction \
  -f prisma/migrations/20261025200000_workspace_owner_lifetime/migration.sql

AFTER="$(snapshot)"
echo "   after:  $AFTER"
[ "$BEFORE" = "$AFTER" ] || fail "document bytes, ids, slugs, authors or dependent rows changed"

ASSIGNMENT="$(assignment_check)"
echo "   assignment (unassigned|misassigned|ownersWithoutExactlyOneDefault): $ASSIGNMENT"
[ "$ASSIGNMENT" = "0|0|0" ] || fail "assignment check returned $ASSIGNMENT"

echo "== rerunning the ownership script (idempotency)"
SECOND_RUN="$(run_script apply)"
echo "   $SECOND_RUN"
case "$SECOND_RUN" in
  *"createdDefaultWorkspaces=0 assignedDocuments=0"*) ;;
  *) fail "the second run changed rows" ;;
esac
[ "$AFTER" = "$(snapshot)" ] || fail "the idempotent run changed data"

echo "== negative proof: partial assignment must abort the required-column migration"
reset_scratch
apply_migrations_before
seed_legacy_rows
psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 --single-transaction \
  -f prisma/migrations/20261025190000_workspaces_teams_access/migration.sql
psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 <<'SQL'
-- Simulate a backfill that could not create the default workspace for one user.
CREATE FUNCTION skip_default_workspace() RETURNS trigger AS $BODY$
BEGIN
  IF NEW."ownerUserId" = 'user-b' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;
CREATE TRIGGER skip_default_workspace BEFORE INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION skip_default_workspace();
SQL

ABORT_CODE=0
ABORT_OUTPUT="$(psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 --single-transaction \
  -f prisma/migrations/20261025190100_workspace_backfill/migration.sql 2>&1)" || ABORT_CODE=$?
echo "   exit=$ABORT_CODE last=$(printf '%s' "$ABORT_OUTPUT" | tail -n 1)"
[ "$ABORT_CODE" -ne 0 ] || fail "the migration succeeded on a partially assigned database"
case "$ABORT_OUTPUT" in
  *workspace_backfill_unassigned_documents*) ;;
  *) fail "the abort message did not name the guard constraint" ;;
esac

FOREIGN_KEY="$(psql "$PROOF_DB" -tA -f - <<'SQL'
SELECT COUNT(*) FROM pg_constraint WHERE conname = 'documents_workspaceId_fkey';
SQL
)"
[ "$FOREIGN_KEY" = "0" ] || fail "the foreign key was applied although the guard fired"

REQUIRED="$(psql "$PROOF_DB" -tA -f - <<'SQL'
SELECT COUNT(*) FROM pg_attribute
WHERE attrelid = 'documents'::regclass AND attname = 'workspaceId' AND attnotnull;
SQL
)"
[ "$REQUIRED" = "0" ] || fail "workspaceId was made required although the guard fired"

echo "== proof complete: every assertion passed"
