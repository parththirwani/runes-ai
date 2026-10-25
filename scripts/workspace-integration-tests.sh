#!/usr/bin/env bash
# Runs the PostgreSQL integration suite against a throwaway database.
#
# The suite skips itself unless DATABASE_URL_TEST is set, which is what keeps `bunx vitest run`
# (and CI without a database) green. This script supplies that variable: it derives an integration
# database from the developer DATABASE_URL, recreates it from the migrations, and then runs the
# suite. The target database name defaults to `workspace_it` and is refused if it looks like an
# application database.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required so the integration database can be derived from it." >&2
  exit 1
fi

IT_DB="${WORKSPACE_IT_DB:-workspace_it}"

case "$IT_DB" in
  runes | runes_* | *production* | postgres | template1)
    echo "Refusing to use \"$IT_DB\" as the integration database. Set WORKSPACE_IT_DB." >&2
    exit 1
    ;;
esac

# Strip the query string, then the database segment, to get scheme://user:pass@host:port.
BASE="${DATABASE_URL%%\?*}"
ROOT="${BASE%/*}"
ADMIN_URL="${ROOT}/postgres"
IT_URL="${ROOT}/${IT_DB}"
case "$DATABASE_URL" in
  *"?schema="*) IT_URL="${IT_URL}?schema=${DATABASE_URL##*?schema=}" ;;
  *) IT_URL="${IT_URL}?schema=public" ;;
esac

echo "==> recreating integration database ${IT_DB}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${IT_DB}\" WITH (FORCE_COMMIT)" \
  || psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${IT_DB}\""
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${IT_DB}\""

echo "==> applying migrations"
DATABASE_URL="$IT_URL" npx prisma migrate deploy

echo "==> running the integration suite"
DATABASE_URL="$IT_URL" DATABASE_URL_TEST="$IT_URL" NODE_ENV=test npx vitest run src/__tests__/workspace-access.integration.test.ts
