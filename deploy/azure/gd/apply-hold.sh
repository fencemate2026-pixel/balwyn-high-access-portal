#!/usr/bin/env bash
# Applies 004_hold_windows.sql to the Magic Keys Azure PostgreSQL database.
# STAGED. Run by Jarrod, by hand, in Azure Cloud Shell (Bash). Nothing here is run automatically.
# No passwords or secrets are stored in this file: it asks for the admin login when it runs.
#
# What it does, in order:
#   1. Asks for the database admin username and password (password is not echoed, not saved).
#   2. Checks it can connect and that schema gd already exists (migration 001 applied).
#   3. Shows the state BEFORE (does gd.hold_windows exist, which command kinds are allowed).
#   4. Applies 004_hold_windows.sql inside one transaction (all or nothing).
#   5. Shows the state AFTER and checks it.
#   6. Prints the rollback command.
# It changes only the gd schema: one new table and one widened CHECK. It does not touch any gate Pi,
# the school tables, App Service settings or the portal deployment.
set -euo pipefail

HOST="${PGHOST_OVERRIDE:-pg-magickeys-balwyn-6e2c98.postgres.database.azure.com}"
DB="${PGDATABASE_OVERRIDE:-balwyn_portal_db}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${HERE}/004_hold_windows.sql"

if ! command -v psql >/dev/null 2>&1; then
  echo "STOP: psql is not installed in this shell. Azure Cloud Shell (Bash) normally has it." >&2
  exit 1
fi
if [ ! -f "$SQL" ]; then
  echo "STOP: cannot find $SQL. Run this script from inside the cloned repo (deploy/azure/gd)." >&2
  exit 1
fi

read -r -p "Database admin username (the one used to apply 001): " ADMIN_USER
read -r -s -p "Password for ${ADMIN_USER} (not shown, not saved): " ADMIN_PASS
echo
export PGPASSWORD="$ADMIN_PASS"
export PGSSLMODE=require
unset ADMIN_PASS

run() { psql -X -v ON_ERROR_STOP=1 -h "$HOST" -U "$ADMIN_USER" -d "$DB" "$@"; }

echo
echo "== 1. Connection check (${HOST} / ${DB})"
if ! run -tA -c "select current_user, current_database();"; then
  echo "STOP: could not connect. If the error mentions a firewall rule, Cloud Shell's address is not allowed on the server yet; nothing was changed." >&2
  exit 1
fi

echo
echo "== 2. Schema gd and gd.devices must already exist (migration 001)"
HAS=$(run -tA -c "select to_regclass('gd.devices') is not null;")
if [ "$HAS" != "t" ]; then
  echo "STOP: gd.devices not found. Migration 001 has not been applied here. Nothing was changed." >&2
  exit 1
fi
echo "ok: gd.devices exists"

echo
echo "== 3. BEFORE"
run -c "select to_regclass('gd.hold_windows') as hold_windows_table;"
run -c "select pg_get_constraintdef(oid) as commands_kind_check from pg_constraint where conname='commands_kind_check' and conrelid='gd.commands'::regclass;"

echo
echo "== 4. Applying 004_hold_windows.sql (one transaction)"
run --single-transaction -f "$SQL"

echo
echo "== 5. AFTER"
run -c "select to_regclass('gd.hold_windows') as hold_windows_table;"
run -c "select pg_get_constraintdef(oid) as commands_kind_check from pg_constraint where conname='commands_kind_check' and conrelid='gd.commands'::regclass;"
run -c "select grantee, privilege_type from information_schema.role_table_grants where table_schema='gd' and table_name='hold_windows' order by 1,2;"

OK_TABLE=$(run -tA -c "select to_regclass('gd.hold_windows') is not null;")
OK_KIND=$(run -tA -c "select pg_get_constraintdef(oid) like '%hold.add%' from pg_constraint where conname='commands_kind_check' and conrelid='gd.commands'::regclass;")
BAD_ACCESS=$(run -tA -c "select count(*) from information_schema.role_table_grants where table_schema='gd' and table_name='hold_windows' and grantee in ('PUBLIC','balwyn_app');")

echo
if [ "$OK_TABLE" = "t" ] && [ "$OK_KIND" = "t" ] && [ "$BAD_ACCESS" = "0" ]; then
  echo "RESULT: PASS. Table exists, hold.* command kinds allowed, school role and PUBLIC have no access."
else
  echo "RESULT: FAIL. table=${OK_TABLE} hold_kinds=${OK_KIND} unwanted_grants=${BAD_ACCESS}. Do not deploy the portal. Send this output back." >&2
  exit 2
fi

cat <<EOF

Rollback (only if needed), same login:
  psql "host=${HOST} dbname=${DB} user=${ADMIN_USER} sslmode=require" --single-transaction -f ${HERE}/004_hold_windows_rollback.sql

Next steps, each needs your approval separately:
  - deploy the portal branch claude/thomastown-hold-windows
  - bench-test the hold relay, then update the Pi package and set HOLD_PIN on that Pi
EOF
