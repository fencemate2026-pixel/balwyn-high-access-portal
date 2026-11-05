# Mildura portal control and access log

## Entered access PINs (2.3.0, 6 Nov 2026)

Owner-requested actual event codes are displayed under **Entered PIN** in the
Mildura Working Men's Club access log. User/admin credential tables are never
read for this value. Existing events without a saved PIN remain Not recorded.

`cloud/003_mildura_access_pins.sql` and gd-mirror v3 were applied on 6 Nov 2026.
The separate PIN table denies anon/authenticated access. The owner-only portal
joins by site and visible event ID. Deploy the portal change, transfer
`pi/upgrade_access_log.py` to the Pi and run `sudo python3 ~/upgrade_access_log.py`.
This upgrades mirror 2.2.1 to 2.3.0 and resends saved event history once, committing
progress only after the cloud acknowledges it. It preserves five-second retries
and changes no network settings or gate application.

Successful PIN capture requires the separate gate-app logging patch; older app
versions deliberately saved null on a successful attempt. The on-site app is
newer than GitHub, so inspect it before applying that patch. Never infer an event
PIN from a user's current credential. The existing Steve email trigger is a
separate deployment and has not been verified/changed by this feature.

## Continuous reconnection update (2.2.1)

6 Nov 2026: the supplied Pi log shows continuous URL errors while Wi-Fi could
not associate. Cloud records show commands were never delivered and expired
after 15 minutes. Mirror 2.2.1 continues polling/retrying after five seconds
instead of increasing command retries to five minutes and upload retries to
15 minutes. Recovery triggers an immediate snapshot refresh. Existing HTTPS
timeouts still apply; requests and database writes remain serialized.

The portal displays an explicit warning when the last Pi heartbeat is stale,
and its queue toast asks the owner to wait for Applied. A GitHub update alone
does not update the running Pi or deploy the portal.

### Install on the Pi without changing its network

Transfer `pi/upgrade_reconnect.py` to the Pi and run:

```sh
sudo python3 ~/upgrade_reconnect.py
```

The installer contains the tested mirror source and verifies its checksum. It
accepts the repository 2.2.0 source, the installed variant reviewed on 6 Nov,
or the already-updated source. The reviewed variant differs only in health
reporting; line endings and trailing blank lines are normalised for that check.
Other source changes are refused. The installer
backs up `/opt/mildura-mirror/mildura_mirror.py`, validates Python syntax and
atomically replaces that one file. It restarts **only** `mildura-mirror.service`,
waits briefly, and checks the service. If startup fails it restores the backup
and restarts only that service. It reports the backup path for manual rollback.
Wi-Fi profiles, network services, routes, DNS, Tailscale, the gate application,
credentials, state, keys and GPIO are not edited or restarted.

Requests cannot cross a Wi-Fi outage; frequent retries resume sync after the
existing connection returns. Previously expired commands are not replayed.
Re-enter a wanted change and confirm its Applied result.

Validation: `python3 -m unittest discover -s deploy/mildura/tests -v`.
Includes a virtual-clock outage lasting over six minutes, five-second retry
cadence, recovery snapshot, independent failures of each sync path, readonly
mode, PIN exclusion, idempotent application and busy-database redelivery.

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

