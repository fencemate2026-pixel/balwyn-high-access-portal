# Mildura Phase 2 — portal control (STAGED, NOT LIVE)

Flow: owner (unlocked) → `/api/owner/mildura` validates, seals PIN/phone to the Pi's RSA-OAEP public key,
inserts `gd_mirror_commands` + audit row in `gd_mirror_changes` → Pi polls `gd-mirror` (`action:"commands"`,
every 10 s, outbound HTTPS) → `mildura_commands.py` validates + applies in one SQLite transaction with a
`changes_log` row (`changed_by = portal:<email>`, tagged `[portal <id>]` for idempotency) → Pi `ack`s →
row becomes applied/failed and `sealed` is wiped (function + DB trigger + CHECK constraint).

Not wired: Open Gate / Hold Open / Lockdown (gate app only exposes `/api/status`; no GPIO from this service).

## Go-live (in order, each needs Jarrod's approval)
1. SQL: run `cloud/002_mildura_control.sql` on project aevsfrxqyvtuycufffxk (after 001). Rollback: `002_mildura_control_rollback.sql`.
2. Edge function: deploy `cloud/gd-mirror.index.ts.txt` as `gd-mirror` (keep verify_jwt=false). v2 is backwards compatible with Pi v1 (`push` unchanged).
3. Portal: merge branch `mildura-control` and deploy.
4. Pi: copy `pi/mildura_mirror.py`, `pi/mildura_commands.py`, `pi/mildura-mirror.service`, `pi/install.sh` to the Pi, then
   `sudo MIRROR_CONTROL=1 MIRROR_DB=/home/rjlcommercial/boomgate/boom_gate.db MIRROR_URL=https://aevsfrxqyvtuycufffxk.supabase.co/functions/v1/gd-mirror sh ./install.sh`
   (keeps the existing device secret from /etc/mildura-mirror.env). Compare the printed key fingerprint with the portal.
5. Kill switch: `MIRROR_CONTROL=0` in /etc/mildura-mirror.env + `sudo systemctl restart mildura-mirror`.
