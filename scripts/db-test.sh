#!/usr/bin/env bash
# Applies the local shim, every migration, and the RLS test file to a scratch
# database, then drops it. Needs psql and a Postgres you may create databases on.
#
#   DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run db:test
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Set DATABASE_URL, e.g. postgresql://postgres@localhost:5432/postgres}"
DB_NAME="armature_rls_test"
ADMIN_URL="$DATABASE_URL"
TEST_URL="${DATABASE_URL%/*}/$DB_NAME"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB_NAME" -c "create database $DB_NAME"
trap 'psql "$ADMIN_URL" -q -c "drop database if exists $DB_NAME" >/dev/null 2>&1 || true' EXIT

echo "== shim"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/local/shim.sql
for file in supabase/migrations/*.sql; do
  echo "== migration $file"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$file"
done
echo "== rls tests"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/rls.test.sql
echo "db-test: all checks passed"
