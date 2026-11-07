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

## Third site: Mildura boom gate (added 7 Nov 2026, STAGED, NOT APPLIED)
Moves Mildura's mirror off the Supabase `gd-mirror` function (HTTP 402) onto Azure. The Pi's own protocol is kept
(`POST {device_id, secret, action: push|key|commands|ack}`), so the Pi needs ONE value changed: `MIRROR_URL`
in `/etc/mildura-mirror.env` -> `https://<portal-host>/api/device/mildura`. No Pi code, network, Tailscale, sshd or gate-app change.
Device id `mildura-001`. The secret is NOT stored in Azure, only its sha256 (`gd.devices.secret_sha256`).
1. Back up the Azure database.
2. Apply `003_mildura.sql` as the database admin (needs 001 first; re-running is harmless).
3. Set the device's secret hash and the Pi's command PUBLIC key (values come from the Pi, never from this repo):
   `UPDATE gd.devices SET secret_sha256 = '<64 hex>', command_pubkey = '<PEM>', command_pubkey_at = now() WHERE device_id = 'mildura-001';`
   Hash: on the Pi, `sudo sh -c "grep -h '^MIRROR_SECRET=' /etc/mildura-mirror.env | cut -d= -f2- | tr -d '\n' | sha256sum"`.
   Key: on the Pi, `sudo openssl pkey -in /var/lib/mildura-mirror/command_key.pem -pubout`.
4. Deploy this branch. Leave `MILDURA_BACKEND` unset first: the owner screens still use the old path. Then set
   `MILDURA_BACKEND=azure` and restart: the Mildura page reads Azure ("waiting for the gate" until the Pi switches).
5. Pi cutover (separate approval, with a timed auto-revert): change `MIRROR_URL`, clear the mark entries `snap` and `stream`
   in `/var/lib/mildura-mirror/state.json` (keep `key_registered` and `access_pin_sync_v1`) so users, schedules, people and the full history resend, restart `mildura-mirror` only.
Rollback: `003_mildura_rollback.sql`; unset `MILDURA_BACKEND`; put the Pi's `MIRROR_URL` and `state.json` back.
Stored: user, schedule and person names; access and change history; the PIN typed at each access event (owner request, 6 Nov 2026) in `gd.mildura_access_pins`
(read only by the owner-gated screens); sealed command ciphertext (wiped when a command finishes). Tests: `tests/mildura-azure.test.mjs` (includes the real Pi mirror code against the real route).

## Hold-open windows (added 7 Nov 2026, STAGED, NOT APPLIED)
Adds `gd.hold_windows` and widens the allowed command kinds (hold.add/update/delete/enable) for both Thomastown gates.
1. Apply `004_hold_windows.sql` as the database admin, after 001 and 002. In Azure Cloud Shell: `bash deploy/azure/gd/apply-hold.sh` (asks for the admin login, applies in one transaction, checks the result, prints the rollback).
2. Deploy the portal branch. Until step 1 is done the page still loads and a hold change is refused with a plain message.
3. Only then update the Pi package and set `HOLD_PIN` on that Pi (separate approval; Thomastown repo, branch `claude/thomastown-hold-windows`). A Pi without `HOLD_PIN` never holds anything.
Rollback: `004_hold_windows_rollback.sql`.

## Gate SIM number (added 8 Nov 2026, STAGED, NOT APPLIED)
The Pi reads whichever SIM is fitted (ICCID, and the number on it if any); if the SIM stores no number the owner types it once on the Thomastown page and the Pi remembers it per SIM. Display only.
1. Apply `005_sim_number.sql` as the database admin (after 001 and 004): widens the command kinds to include `sim.number`. Until then the page loads and saving a number is refused with a plain message.
2. Deploy the portal. A Pi that has not been updated keeps showing the legacy number for the swing gate.
3. Update the Pi package (separate approval; restarts `thomgate`, which briefly drops caller detection).
Rollback: `005_sim_number_rollback.sql`.
