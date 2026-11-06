#!/usr/bin/env bash
# Balwyn portal: create the Azure PostgreSQL database, load the schema, copy the
# data from Supabase, compare row counts, and (only if you type SWITCH) point the
# live app at it. Run in Azure Cloud Shell (Bash). Safe to re-run.
#
# Nothing is deleted. Supabase is only READ. The portal keeps using Supabase until
# you type SWITCH AND the code from branch azure-database is deployed.
set -euo pipefail

RG="${RG:-rg-magickeys-balwyn}"
APP="${APP:-magickeys-balwyn-portal}"
LOCATION="${LOCATION:-australiaeast}"
PG_VERSION="${PG_VERSION:-16}"          # the schema bundle was tested on 16
DB_NAME="${DB_NAME:-balwyn_portal_db}"
ADMIN_USER="${ADMIN_USER:-portaladmin}"
STATE_DIR="$HOME/.balwyn-db"
mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="$HERE/balwyn-schema.sql"

say() { printf '\n== %s\n' "$*"; }
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

for tool in az psql openssl curl; do
  command -v "$tool" >/dev/null || die "$tool is not available in this shell."
done
[ -f "$SCHEMA_FILE" ] || die "balwyn-schema.sql must sit next to this script."
az account show >/dev/null 2>&1 || die "Not signed in. In Cloud Shell you are signed in already; otherwise run: az login"
az group show -n "$RG" >/dev/null 2>&1 || die "Resource group $RG not found. Set RG=<name> and re-run."
az webapp show -g "$RG" -n "$APP" >/dev/null 2>&1 || die "App $APP not found in $RG. Set APP=<name> and re-run."

# --- names and password (kept in Cloud Shell storage, mode 600, never in git) ---
if [ -f "$STATE_DIR/server" ]; then SERVER="$(cat "$STATE_DIR/server")"
else SERVER="pg-magickeys-balwyn-$(openssl rand -hex 3)"; echo "$SERVER" > "$STATE_DIR/server"; fi
if [ ! -f "$STATE_DIR/adminpass" ]; then
  openssl rand -base64 33 | tr -dc 'A-Za-z0-9' | head -c 32 > "$STATE_DIR/adminpass"; chmod 600 "$STATE_DIR/adminpass"
fi
ADMIN_PASS="$(cat "$STATE_DIR/adminpass")"
HOST="$SERVER.postgres.database.azure.com"
TARGET_URL="postgres://$ADMIN_USER:$ADMIN_PASS@$HOST:5432/$DB_NAME"
PSQL_TARGET="host=$HOST port=5432 dbname=$DB_NAME user=$ADMIN_USER password=$ADMIN_PASS sslmode=require"

# --- temporary firewall rule for this Cloud Shell, removed on exit ---
MY_IP="$(curl -fsS https://api.ipify.org || true)"
cleanup() {
  if [ -n "${MY_IP:-}" ]; then
    az postgres flexible-server firewall-rule delete -g "$RG" -s "$SERVER" --name cloudshell-temp --yes >/dev/null 2>&1 || true
  fi
  rm -rf "$STATE_DIR/copy"   # exported rows must not stay on disk
}
trap cleanup EXIT

say "1/7 Database server $SERVER ($LOCATION, PostgreSQL $PG_VERSION, Burstable B1ms, 32 GB, 7-day backups)"
if az postgres flexible-server show -g "$RG" -n "$SERVER" >/dev/null 2>&1; then
  echo "Server already exists, reusing it."
else
  az postgres flexible-server create -g "$RG" -n "$SERVER" -l "$LOCATION" \
    --version "$PG_VERSION" --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
    --backup-retention 7 --admin-user "$ADMIN_USER" --admin-password "$ADMIN_PASS" \
    --public-access None --yes >/dev/null
  echo "Created."
fi

say "2/7 Firewall: only the portal's outbound addresses, plus this shell for the next few minutes"
# Public access must be on for firewall rules to work. With no rules, nothing is allowed in.
az postgres flexible-server update -g "$RG" -n "$SERVER" --public-access Enabled >/dev/null
IPS="$(az webapp show -g "$RG" -n "$APP" --query possibleOutboundIpAddresses -o tsv | tr ',' '\n' | sort -u)"
[ -n "$IPS" ] || die "Could not read the app's outbound IP addresses."
EXISTING_RULES="$(az postgres flexible-server firewall-rule list -g "$RG" -s "$SERVER" --query '[].startIpAddress' -o tsv 2>/dev/null \
  || az postgres flexible-server firewall-rule list -g "$RG" -n "$SERVER" --query '[].startIpAddress' -o tsv 2>/dev/null || true)"
i=0
for ip in $IPS; do
  i=$((i+1))
  if printf '%s\n' "$EXISTING_RULES" | grep -qx "$ip"; then continue; fi
  az postgres flexible-server firewall-rule create -g "$RG" -s "$SERVER" --name "portal-out-$i" \
    --start-ip-address "$ip" --end-ip-address "$ip" >/dev/null
done
echo "$i portal addresses allowed."
[ -n "$MY_IP" ] || die "Could not work out this shell's public IP."
az postgres flexible-server firewall-rule create -g "$RG" -s "$SERVER" --name cloudshell-temp \
  --start-ip-address "$MY_IP" --end-ip-address "$MY_IP" >/dev/null

say "3/7 Database and schema"
az postgres flexible-server parameter set -g "$RG" -s "$SERVER" --name azure.extensions --value PGCRYPTO >/dev/null
PSQL_MAINT="host=$HOST port=5432 dbname=postgres user=$ADMIN_USER password=$ADMIN_PASS sslmode=require"
for n in 1 2 3 4 5 6; do psql "$PSQL_MAINT" -qAtc 'select 1' >/dev/null 2>&1 && break; echo "waiting for the server..."; sleep 10; done
if [ "$(psql "$PSQL_MAINT" -qAtc "select count(*) from pg_database where datname='$DB_NAME'")" = "0" ]; then
  psql "$PSQL_MAINT" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$DB_NAME\""
fi
for n in 1 2 3 4 5 6; do psql "$PSQL_TARGET" -qAtc 'select 1' >/dev/null 2>&1 && break; echo "waiting for the server..."; sleep 10; done
psql "$PSQL_TARGET" -qAtc 'select 1' >/dev/null || die "Cannot connect to the new database."
if [ "$(psql "$PSQL_TARGET" -qAtc "select to_regclass('balwyn_portal.portal_accounts') is not null")" = "t" ]; then
  echo "Schema already loaded, skipping."
else
  # A failed earlier attempt may have left a partial schema. This database is new and
  # holds no data yet, so clear it and load again, all in one transaction.
  psql "$PSQL_TARGET" -v ON_ERROR_STOP=1 -qc "DROP SCHEMA IF EXISTS balwyn_portal CASCADE;"
  psql "$PSQL_TARGET" -v ON_ERROR_STOP=1 -q -1 -f "$SCHEMA_FILE"
  psql "$PSQL_TARGET" -v ON_ERROR_STOP=1 -qc "GRANT balwyn_app TO $ADMIN_USER;"
  echo "Schema loaded."
fi

say "4/7 Copy data from Supabase (read-only on their side)"
if [ -f "$STATE_DIR/copied" ]; then
  echo "Data was already copied on $(cat "$STATE_DIR/copied"). Delete $STATE_DIR/copied to copy again (the target tables are cleared first)."
else
  echo "Paste the Supabase SESSION POOLER connection (project aevsfrxqyvtuycufffxk). Input is hidden."
  echo "Either form works: postgresql://... or host=... port=5432 dbname=postgres user=... sslmode=require"
  read -rs -p "Supabase connection: " SUPABASE_DB_URL; echo
  [ -n "$SUPABASE_DB_URL" ] || die "No connection string entered."
  if [ -z "${PGPASSWORD:-}" ] && [[ "$SUPABASE_DB_URL" != *password=* ]] && [[ "$SUPABASE_DB_URL" != postgres*://*:*@* ]]; then
    read -rs -p "Supabase database password (hidden): " PGPASSWORD; echo; export PGPASSWORD
  fi
  psql "$SUPABASE_DB_URL" -qAtc 'select 1' >/dev/null || die "Cannot connect to Supabase with that string."

  # pg_dump cannot be used here: Supabase runs a newer PostgreSQL than Cloud Shell's pg_dump,
  # and pg_dump refuses that. psql \copy works across versions, so copy table by table.
  COPY_DIR="$STATE_DIR/copy"
  rm -rf "$COPY_DIR"; mkdir -p "$COPY_DIR"; chmod 700 "$COPY_DIR"

  # Tables parents-first, so foreign keys are satisfied while loading.
  ORDERED="$(psql "$PSQL_TARGET" -v ON_ERROR_STOP=1 -qAt <<'SQL'
with recursive edges as (
  select c.conrelid as child, c.confrelid as parent
  from pg_constraint c
  join pg_class cc on cc.oid = c.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
  join pg_class pc on pc.oid = c.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
  where c.contype = 'f' and cn.nspname = 'balwyn_portal' and pn.nspname = 'balwyn_portal'
    and c.conrelid <> c.confrelid
), tbls as (
  select c.oid as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'balwyn_portal' and c.relkind in ('r','p')
), chain(t, depth) as (
  select t, 0 from tbls
  union all
  select e.child, chain.depth + 1 from chain join edges e on e.parent = chain.t where chain.depth < 30
)
select c.relname || ' ' || x.d from (select t, max(depth) d from chain group by t) x
join pg_class c on c.oid = x.t order by x.d, c.relname;
SQL
)" || die "Could not read the table list from the new database."
  [ -n "$ORDERED" ] || die "No tables found in balwyn_portal on the new database."
  if printf '%s\n' "$ORDERED" | awk '$2 >= 30 { f=1 } END { exit !f }'; then
    die "Circular foreign keys found. Send Claude this: $(printf '%s' "$ORDERED" | tr '\n' ',')"
  fi

  EXPORT_SQL="$COPY_DIR/export.sql"; LOAD_SQL="$COPY_DIR/load.sql"
  { echo 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'; } > "$EXPORT_SQL"
  { echo 'BEGIN;'
    psql "$PSQL_TARGET" -qAt -c "select 'TRUNCATE ' || string_agg(format('%I.%I', table_schema, table_name), ', ') || ' RESTART IDENTITY CASCADE;' from information_schema.tables where table_schema='balwyn_portal' and table_type='BASE TABLE'"
  } > "$LOAD_SQL"
  NTAB=0
  while read -r t _depth; do
    [[ "$t" =~ ^[a-z0-9_]+$ ]] || die "Unexpected table name: $t"
    # Columns the new table stores (generated columns are rebuilt by the database itself).
    COLS="$(psql "$PSQL_TARGET" -v ON_ERROR_STOP=1 -v t="$t" -qAt <<'SQL'
select string_agg(quote_ident(attname), ', ' order by attnum)
from pg_attribute
where attrelid = format('balwyn_portal.%I', :'t')::regclass and attnum > 0 and not attisdropped and attgenerated = '';
SQL
)"
    [ -n "$COLS" ] || die "No columns found for $t."
    echo "\\copy (select $COLS from balwyn_portal.\"$t\") to '$COPY_DIR/$t.tsv'" >> "$EXPORT_SQL"
    echo "\\copy balwyn_portal.\"$t\" ($COLS) from '$COPY_DIR/$t.tsv'" >> "$LOAD_SQL"
    NTAB=$((NTAB+1))
  done <<< "$ORDERED"
  echo 'COMMIT;' >> "$EXPORT_SQL"

  # Keep serial and identity counters ahead of the copied rows.
  psql "$PSQL_TARGET" -qAt -c "select format('select setval(%L, coalesce((select max(%I) from %I.%I), 1), (select count(*) > 0 from %I.%I));', s.seq, s.col, s.sch, s.tbl, s.sch, s.tbl) from (select pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) as seq, a.attname as col, n.nspname as sch, c.relname as tbl from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'balwyn_portal' and c.relkind in ('r','p') and a.attnum > 0 and not a.attisdropped) s where s.seq is not null" >> "$LOAD_SQL"
  echo 'COMMIT;' >> "$LOAD_SQL"
  chmod 600 "$EXPORT_SQL" "$LOAD_SQL"

  echo "Reading $NTAB tables from Supabase in one read-only snapshot..."
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$EXPORT_SQL" \
    || die "Reading from Supabase failed. Nothing was changed on either side. Send Claude the message above."
  chmod 600 "$COPY_DIR"/*.tsv
  # The schema pre-loads a few starter rows (for example hire_areas). Supabase is the
  # source of truth, so clear every portal table, then load its copy, in ONE transaction:
  # if anything fails, nothing changes on Azure.
  echo "Loading into Azure (one transaction)..."
  psql "$PSQL_TARGET" -v ON_ERROR_STOP=1 -q -o /dev/null -f "$LOAD_SQL" \
    || die "Loading failed and was rolled back. Azure tables are as they were. Send Claude the message above."
  rm -rf "$COPY_DIR"
  date -u +%FT%TZ > "$STATE_DIR/copied"
  echo "Copied."
fi

say "5/7 Compare row counts, table by table"
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  read -rs -p "Supabase connection string again (hidden, for the comparison): " SUPABASE_DB_URL; echo
fi
TABLES="$(psql "$PSQL_TARGET" -qAtc "select table_name from information_schema.tables where table_schema='balwyn_portal' and table_type='BASE TABLE' order by 1")"
BAD=0
printf '%-40s %10s %10s\n' table supabase azure
for t in $TABLES; do
  a="$(psql "$SUPABASE_DB_URL" -qAtc "select count(*) from balwyn_portal.\"$t\"" 2>/dev/null || echo MISSING)"
  b="$(psql "$PSQL_TARGET" -qAtc "select count(*) from balwyn_portal.\"$t\"")"
  mark=""; [ "$a" = "$b" ] || { mark="  <-- DIFFERENT"; BAD=1; }
  printf '%-40s %10s %10s%s\n' "$t" "$a" "$b" "$mark"
done
unset SUPABASE_DB_URL PGPASSWORD
[ "$BAD" = 0 ] || die "Row counts differ. Do not switch. Send Claude the table above."

say "6/7 Test the portal's restricted role on the new database"
psql "$PSQL_TARGET" -v ON_ERROR_STOP=1 -qAt <<'SQL'
begin; set local role balwyn_app; select 'balwyn_app can read: ' || count(*) from balwyn_portal.portal_accounts; rollback;
SQL

say "7/7 Switch the live app"
echo "Everything above passed. The portal still uses Supabase."
echo "Typing SWITCH sets PORTAL_DATABASE_URL on $APP. It only takes effect once the code from"
echo "branch azure-database is deployed. To undo: az webapp config appsettings delete -g $RG -n $APP --setting-names PORTAL_DATABASE_URL"
read -r -p "Type SWITCH to set it, or press Enter to stop here: " ANS
if [ "$ANS" = "SWITCH" ]; then
  az webapp config appsettings set -g "$RG" -n "$APP" --settings "PORTAL_DATABASE_URL=$TARGET_URL" >/dev/null
  echo "Set. (Stored as an encrypted app setting; it is not printed here.)"
else
  echo "Not switched. Re-run this script any time; it will skip the finished steps."
fi
echo "Done. Server: $SERVER   Database: $DB_NAME"
