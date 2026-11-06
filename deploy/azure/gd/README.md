# Thomastown swing gate: Azure `gd` schema (STAGED, NOT APPLIED)

What this is: a copy of the Thomastown swing gate's callers, call log and change log in Azure, plus a queue of changes the owner makes in the portal. The Pi's own database stays the boss. The Pi pushes data out and asks for queued changes over HTTPS. Nothing here can open the gate.

Nothing in this folder has been run against a live database. It was tested only against a throwaway PostgreSQL-compatible database (`tests/thomastown-swing.test.mjs`).

## Order (each step needs Jarrod's APPROVE)
1. Back up the Azure database.
2. Apply `001_thomastown_swing.sql` as the database admin. Re-running is harmless.
3. Create the login role. Run as admin, with a generated password you do not paste anywhere else:
   `CREATE ROLE gd_login LOGIN PASSWORD '<generated>' IN ROLE gd_app;`
   Build `GD_DATABASE_URL` from it (keep `sslmode=require`).
4. Put `GD_DATABASE_URL` and `GD_THOMASTOWN_SWING_SECRET` in App Service settings (ideally as Key Vault references).
5. Deploy the portal branch. Check `/api/owner/thomastown-swing` as the owner: it should show "waiting for the gate" and empty lists.
6. Only then install the Pi sync service (separate approval; Thomastown repo).

## Rollback
`001_thomastown_swing_rollback.sql` (drops schema `gd` and role `gd_app`). Also `DROP ROLE gd_login`. Unset the three settings. The rest of the portal is unaffected.

## What is stored (disclosure)
- Caller names and phone numbers are stored in plain text in schema `gd`, and every call's number (including numbers not on the list). This is needed to show them to the owner.
- Access: only the owner login (404 for everyone else). The school role `balwyn_app` is explicitly denied all of `gd` (tested).
- Calls with no caller ID, and rings repeated within 8 seconds, never reach the Pi's database, so they cannot appear here.
- Changes expire after 15 minutes if the Pi has not collected them, and are handed out at most 5 times.

## Second site: Thomastown sliding gate (added 7 Nov 2026, STAGED, NOT APPLIED)
Same schema, same code path, its own device id (`thomastown-sliding`), its own secret and its own routes
(`/api/device/thomastown-sliding`, `/api/owner/thomastown-sliding`). A secret acts only as its own device.
1. Back up the Azure database (the 7-day automatic backup applies if no on-demand one is taken).
2. Apply `002_thomastown_sliding.sql` as the database admin (one row; re-running is harmless).
3. Set `GD_THOMASTOWN_SLIDING_SECRET` (new random 64 hex; never reuse the swing value) and restart the app.
4. Deploy this branch. The owner sidebar then lists "Thomastown sliding gate" (waiting for the gate, empty lists).
5. Only then install the sync service on the sliding Pi (separate approval, `PORTAL_SYNC_DEVICE=thomastown-sliding`).
Rollback: `002_thomastown_sliding_rollback.sql`, unset the setting.
