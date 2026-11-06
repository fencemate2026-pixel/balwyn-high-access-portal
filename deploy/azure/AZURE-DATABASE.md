# Balwyn portal database on Azure (branch `azure-database`, 6 Nov 2026)

Moves ONLY the Balwyn portal's own data off the shared Supabase project. Thomastown, Mildura, the maintenance app and the Xero/Stripe functions are not touched.

**Stays on Supabase (not part of this move):** the owner "Sites" page reads the `gd_*` gate-dialler tables (Thomastown/Mildura units) through Supabase REST. Those units long-poll that database, so it must stay.

## How the switch works
The portal talks to PostgreSQL directly when `PORTAL_DATABASE_URL` is set. Unset it and the portal goes back to the Supabase function. Same SQL, same guard (single statements only, restricted role `balwyn_app`, single-writer lock). Profile photos are kept in the database instead of Supabase Storage.

## Steps (live changes need Jarrod's approval at each ✋)
1. ✋ **Create** Azure Database for PostgreSQL – Flexible Server, region Australia East, PostgreSQL 17 (same major as now), admin login e.g. `portaladmin`. Networking: allow the App Service's outbound addresses only (or private access); no "allow all". Turn on automated backups.
2. ✋ **Bootstrap**: connect with `psql` as the admin and run `postgres-bootstrap.sql`, then these migrations in this order (the same list the test suite uses):
   `20260920062504_balwyn_portal_netlify`, `20260921103400_hire_bookings_balwyn_portal`, `20260924120000_portal_accounts`, `20260924210000_help_events`, `20260926090000_linked_gate_automation`, `20261010090000_gate_service_and_rjl_alerts`, `20261015100000_staff_presence`, `20261024090000_schedule_labels`, `20261024100000_controller_cpu_temperature`, `20261106120000_profile_photos_db`.
   Then `GRANT balwyn_app TO portaladmin;` (last lines of the bootstrap file).
3. ✋ **Copy the data** (about 25 small tables, under 2 MB). Maintenance window, portal read-only:
   `pg_dump --data-only --schema=balwyn_portal "$SUPABASE_DB_URL" > portal-data.sql` then `psql "$PORTAL_DATABASE_URL" -f portal-data.sql`. Compare row counts table by table before going on. The one profile photo (32 kB) is re-uploaded by its owner or copied by hand.
4. ✋ **Switch**: App Service setting `PORTAL_DATABASE_URL=postgres://portaladmin:<password>@<server>.postgres.database.azure.com:5432/<db>`. Keep the password in Azure Key Vault or an App Service secret, never in git. Check login, a gate view, a schedule edit.
5. **Rollback**: remove `PORTAL_DATABASE_URL`. The Supabase copy is left unchanged until you are happy.
6. ✋ **Only after a week of normal running**: list the Balwyn pieces in Supabase (schema `balwyn_portal`, function `balwyn-portal-db`, bucket `balwyn-profile-photos`) and remove them after your OK.

## Evidence
- VERIFIED (tests run): the guard and transaction rules on real PostgreSQL semantics (PGlite) with every migration; photo storage round trip.
- NOT TESTED (needs a live server): the node-postgres pool, TLS to Azure, the pg_dump copy (triggers on `activity_log` may need care), timestamp formats against the live app.
