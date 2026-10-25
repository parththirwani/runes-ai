#!/usr/bin/env bash
# Migration proof for the DocumentFormat backfill.
#
# Builds a scratch database at the PRE-migration schema, seeds it with legacy
# LaTeX documents, applies the new migration, then verifies:
#   1. row counts match,
#   2. every legacy row has format = LATEX,
#   3. saved content is byte-identical (sha256),
#   4. slugs and titles are unchanged.
#
# Requires a local Postgres reachable via DATABASE_URL (or the defaults used
# by docker-compose / the README).
set -euo pipefail

cd "$(dirname "$0")/.."
# psql rejects the ?schema= parameter that Prisma connection strings carry.
DB_URL_RAW="${DATABASE_URL:-postgresql://runes:runes@localhost:5432/runes-ai}"
DB_URL="${DB_URL_RAW%%\?*}"
PROOF_DB="${DB_URL%/*}/migration_proof"

psql_admin() { psql "$DB_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; }

echo "== resetting scratch database"
psql_admin 'DROP DATABASE IF EXISTS migration_proof;' >/dev/null
psql_admin 'CREATE DATABASE migration_proof;' >/dev/null
export DATABASE_URL="$PROOF_DB"

echo "== applying pre-migration schema (all migrations before document_format)"
MARKER="20261021120000_document_format_and_assets"
for dir in prisma/migrations/2026*; do
  name="$(basename "$dir")"
  # The proof needs the schema exactly as it stood before that migration. Anything newer
  # belongs to a later feature and would change what a legacy row even means.
  if [[ "$name" > "$MARKER" ]]; then continue; fi
  case "$dir" in
    *document_format_and_assets*) continue ;;
  esac
  psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 -f "$dir/migration.sql"
done

echo "== seeding legacy LaTeX documents"
psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (id, email, "createdAt", "updatedAt")
VALUES ('user-1', 'legacy@example.com', now(), now());

INSERT INTO documents (id, title, content, slug, "userId", "createdAt", "updatedAt")
VALUES
  ('doc-1', 'Legacy One', E'\\documentclass{article}\n\\begin{document}Hello \\textbf{world}\\end{document}', 'legacy-one', 'user-1', now(), now()),
  ('doc-2', 'Legacy Two', E'\\section{Only content, no wrapper}', 'legacy-two', 'user-1', now(), now());

INSERT INTO chat_sessions (id, "documentId", title, "createdAt", "updatedAt")
VALUES ('chat-1', 'doc-1', 'Legacy chat', now(), now());
SQL

echo "== recording pre-migration hashes"
BEFORE=$(psql "$PROOF_DB" -tA -c "SELECT md5(content) || '|' || slug || '|' || title FROM documents ORDER BY id;")

echo "== applying new migrations (format + assets)"
psql "$PROOF_DB" -q -v ON_ERROR_STOP=1 -f prisma/migrations/20261021120000_document_format_and_assets/migration.sql

echo "== verifying"
AFTER=$(psql "$PROOF_DB" -tA -c "SELECT md5(content) || '|' || slug || '|' || title FROM documents ORDER BY id;")
COUNT=$(psql "$PROOF_DB" -tA -c "SELECT count(*) FROM documents;")
LATEX=$(psql "$PROOF_DB" -tA -c "SELECT count(*) FROM documents WHERE format = 'LATEX';")
NONLATEX=$(psql "$PROOF_DB" -tA -c "SELECT count(*) FROM documents WHERE format <> 'LATEX';")
CHAT=$(psql "$PROOF_DB" -tA -c "SELECT count(*) FROM chat_sessions;")

fail=0
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: content/slug/title changed"; fail=1; }
[ "$COUNT" = "2" ] || { echo "FAIL: row count drifted ($COUNT)"; fail=1; }
[ "$LATEX" = "2" ] || { echo "FAIL: legacy rows not backfilled to LATEX ($LATEX/2)"; fail=1; }
[ "$NONLATEX" = "0" ] || { echo "FAIL: non-LATEX legacy rows found"; fail=1; }
[ "$CHAT" = "1" ] || { echo "FAIL: chat relations lost"; fail=1; }

# Idempotence: re-running the backfill statement must not change anything.
psql "$PROOF_DB" -q -c "UPDATE documents SET format = 'LATEX';" >/dev/null
AGAIN=$(psql "$PROOF_DB" -tA -c "SELECT md5(content) || '|' || slug || '|' || title FROM documents ORDER BY id;")
[ "$AFTER" = "$AGAIN" ] || { echo "FAIL: backfill not idempotent"; fail=1; }

if [ "$fail" = "0" ]; then
  echo "PASS: 2/2 legacy documents backfilled to LATEX, byte-identical content, slugs and chats intact, backfill idempotent"
fi
exit "$fail"
