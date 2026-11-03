# Mildura Phase 2 — portal control (STAGED, NOT LIVE)

Flow: owner (unlocked) → `/api/owner/mildura` validates, seals PIN/phone to the Pi's RSA-OAEP public key,
inserts `gd_mirror_commands` + audit row in `gd_mirror_changes` → Pi polls `gd-mirror` (`action:"commands"`,
every 10 s, outbound HTTPS) → `mildura_commands.py` validates + applies in one SQLite transaction with a
`changes_log` row (`changed_by = portal:<email>`, tagged `[portal <id>]` for idempotency) → Pi `ack`s →
row becomes applied/failed and `sealed` is wiped (function + DB trigger + CHECK constraint).

Checked against the gate app source (github fencemate2026-pixel/Milduraworkingmansclub, main @ 44947f1, 20 Sep 2026;
the Pi was modified 3 Nov and its auto_schedules has a `close_day` column that no version of the source has, so the
Pi runs a newer, unpublished build — verify before go-live):
- No in-memory cache: PIN checks and lockdown read SQLite every time, so direct writes apply on the next PIN.
- Users/persons/schedules: direct SQLite writes that copy database.py's SQL exactly (the app's HTTP routes are
  redirect+flash form posts with no edit-name/PIN, enable-all or persons routes, and its add-user flash puts the PIN
  in the session cookie, so they are not used).
- Open Gate → POST /gate/open, Lockdown → POST /lockdown state=on|off, on loopback, after POST /login with the admin
  PIN read on the Pi at install (never uploaded). Only when `MIRROR_GATE_ACTIONS=1`; the Pi advertises it in
  `last_status.mirror_caps` and the portal enables the buttons only then. Open is at-most-once and dropped after 90 s.
- Hold Open: retired in the gate app (410; the external time clock owns hold) — stays disabled.

## Go-live (in order, each needs Jarrod's approval)
1. SQL: run `cloud/002_mildura_control.sql` on project aevsfrxqyvtuycufffxk (after 001). Rollback: `002_mildura_control_rollback.sql`.
2. Edge function: deploy `cloud/gd-mirror.index.ts.txt` as `gd-mirror` (keep verify_jwt=false). v2 is backwards compatible with Pi v1 (`push` unchanged).
3. Portal: merge branch `mildura-control` and deploy.
4. Pi: copy `pi/mildura_mirror.py`, `pi/mildura_commands.py`, `pi/mildura-mirror.service`, `pi/install.sh` to the Pi, then
   `sudo MIRROR_CONTROL=1 MIRROR_GATE_ACTIONS=1 MIRROR_DB=/home/rjlcommercial/boomgate/boom_gate.db MIRROR_URL=https://aevsfrxqyvtuycufffxk.supabase.co/functions/v1/gd-mirror sh ./install.sh`
   (keeps the existing device secret from /etc/mildura-mirror.env). Compare the printed key fingerprint with the portal.
5. Kill switches: `MIRROR_GATE_ACTIONS=0` (buttons only) or `MIRROR_CONTROL=0` in /etc/mildura-mirror.env + `sudo systemctl restart mildura-mirror`.
