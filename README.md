# Balwyn High School Gate Operations

This branch migrates the working Balwyn portal to Next.js on Render with a separate Supabase database schema and private image storage. See [the migration and cutover instructions](RENDER_MIGRATION.md) for deployment status, configuration and verification.

Build: `npm ci && npm run build:render`. Test: `npm test`.

## Mildura user management

### Entered PIN in the Mildura Working Men's Club access log

The access log has an **Entered PIN** column containing the actual value saved
with that event, including denied attempts and leading zeros. Missing historical
values show **Not recorded**; they are never reconstructed from a user's current PIN.
Recorded event PINs live in `gd_mirror_access_pins`, a separate RLS-protected table
with no anon/authenticated privileges. Only the existing owner-gated server route
joins them to the visible 300 events. Charts, user/person credential lists and CSV
exports do not include PINs.

Deployment order: apply `deploy/mildura/cloud/003_mildura_access_pins.sql`, deploy
the updated `gd-mirror` function, deploy the portal, then install mirror 2.3.0 with
`sudo python3 ~/upgrade_access_log.py`. The standalone installer updates only
the mirror program and restarts only `mildura-mirror`, with backup and rollback.
It accepts the reviewed 2.2.0 variants and the exact installed 2.2.1 program.
Five-second reconnection retries are retained. The mirror replays recorded access
history once to backfill available PINs; ordinary credential tables stay excluded.

The club gate-app repository previously saved `attempted_pin` only for denied
attempts. Its separate logging-only patch retains the entered value for granted
attempts too. Verify the installed gate app before updating it; the mirror installer
does not edit/restart that app. This feature does not assert that Steve's separate
email alert is active or alter its existing threshold.

The signed-in owner can open **RJL portals → Mildura** and add, edit, enable,
disable or delete users under **Authorised users**, without a separate unlock.
Commands show **Pending → Applied / Failed / Expired**. Queued is not confirmation:
wait for **Applied** to confirm a change reached the Pi. User changes expire after
15 minutes if the Pi does not collect them.

Mirror 2.2.1 polls for commands every five seconds after the preceding request
finishes and also retries failed polls and uploads after five seconds. Retries
continue throughout an outage; there is no five-/15-minute backoff. A recovered
command connection immediately schedules a fresh snapshot, even with no queued
commands. An in-flight HTTPS request can still take its existing 20-second
timeout; the service serializes database access and command application.

This Pi update does not modify Wi-Fi, NetworkManager, routes, DNS, Tailscale,
credentials, the gate app or GPIO. Use the version-checked installer in
`deploy/mildura/pi/upgrade_reconnect.py`; it backs up and replaces only the mirror
Python file, then restarts only `mildura-mirror`. See
[Mildura deployment notes](deploy/mildura/PHASE2.md#continuous-reconnection-update-221).

The deployment remains staged until the original masked login secrets and profile image are transferred. The previous GitHub-only implementation is preserved under `archive/github-legacy/` and in Git history.

---

## Previous project documentation

# Magic Keys – Balwyn High School

For the current login methods, administrator password protection, editable user
profiles and photo storage, see [LOGIN_AND_ADMIN_SETUP.md](LOGIN_AND_ADMIN_SETUP.md).

The Sites portal manages operator access and the campus interface. Its separate
sensor-equipped controller workflow is retained. The school's existing
**Compass ACB-004 four-door access board** now has an optional **one-way,
open-only Pi relay trigger**, independent of that feedback workflow.

## What the ACB-004 integration does

- `POST /doors/{1-4}/open` on the Pi pulses exactly one configured GPIO relay
  channel. The portal accepts a commissioned acknowledgement from 300–10,000 ms;
  the default pulse remains 500 ms.
- Mock/dry-run mode is the default and never imports or operates GPIO.
- Bearer authentication, fixed local pin/polarity configuration, durable
  duplicate protection, logging and tests are included.
- The dashboard gate panel has a separate **Remote open · Compass ACB-004**
  control. It appears only when the service mapping is configured. Existing
  controls and unconfigured behaviour are retained.
- A successful pulse leaves physical position **unknown**. No live sensor,
  lock-release, safety, closing or emergency feedback is produced by this path.

This implementation replaces any proposed ACB-004 TCP/IP protocol adapter with
an HTTP-to-Pi-to-isolated-relay path. It contains no proprietary controller
protocol, packet-format assumptions, direct database access or card syncing.
The ACB-004's native Ethernet capability does not establish an API connection.

## Software setup and verification

Use Node.js 22.13+ and the committed npm lockfile.

```bash
npm run install:ci
npm run dev
npm run test:doors
npm run build
```

`npm run test:doors` runs the HTTP/relay and browser-gateway contract tests.
`npm test` also runs existing repository tests. No test actuates real equipment.
See [the Pi service guide](pi-door-service/README.md) for its mock run, systemd
installation, HTTP responses, GPIO configuration and wiring reference.

## Configure the Sites server

Set these **server-side runtime variables** only after confirming the field
mapping and access path:

| Variable | Value |
| --- | --- |
| `DOOR_SERVICE_URL` | Reachable HTTPS origin of the approved Pi gateway, without a path |
| `DOOR_SERVICE_TOKEN` | Private random token matching the Pi's `DOOR_API_TOKEN` |
| `DOOR_GATE_MAP` | JSON mapping existing gate IDs to unique board channels 1–4 |

For example, `{"TF-ENTRY":1,"TF-EXIT":2}` demonstrates the JSON format only; it
is **not** the verified onsite allocation. There are no default live mappings.
All three variables absent means unconfigured; partial/invalid configuration is
rejected. One board supports at most four mapped gate IDs, not all nine registered gates. Only active gates may receive commands.

The client calls the same-origin `/api/doors/open` route. The server checks the
existing operator session, permissions, exact request origin and current normal
operating priority before sending a request. The Pi token stays on the server.
The new path does not mark any sensor-equipped controller commissioned and
does not write simulated or reported gate positions.

Do not use `NEXT_PUBLIC_*`, browser storage or source files for the Pi secret.
There are no automatic retries after an ambiguous network failure. Local
inspection is required before issuing a fresh request.

## Existing GitHub demonstration

`fencemate2026-pixel/balwyn-high-access-portal` has an older static demonstration.
It receives the same service and optional remote-open client separately; its
simulated gate controls retain their original behaviour when unconfigured.
Its Render function requires a distinct remote-open operator token because a
demo login is not authorisation to actuate school hardware. Refer to that
repository's README for its hosting setup. This change does not replace the
newer Sites portal with the older demo.

## Maglock and Roger F70/IPU36

System Settings contains a Wiring section with the magnetic-lock connections,
isolated Roger open trigger, connection matrix, timing and commissioning scope.
The lock power circuit and Roger dry-contact command require electrically
separate contacts. **Never connect a +12 V lock relay COM to the Roger command
COM.** For the referenced F70/IPU36 manual, the open command is **34 AP / 32 COM**.
The **36 PP / 38 COM** step-by-step input is excluded from this open-only design.

The Pi's short request pulse does not determine maglock release time. The
approved local controller/interface must release the lock before movement and
restore it at the correct point; do not substitute a blanket 3–5-second timer.
The service does not implement that local lock/motor sequence. Confirm the
installed board revision, ratings, relay isolation, emergency release and
mechanical behaviour onsite. Full references and details are in the
[Pi wiring guide](pi-door-service/README.md#maglock-and-roger-f70ipu36-interface).

Commissioning covers permissions/readers, schedules, hold-open and return to
secure operation, remote commands, independently verified gate-state feedback,
emergency behaviour, safety functions, and recovery after power or communication
failure. The manuals describe the contact functions; they do not certify the
installed system. Holding Roger AP active inhibits automatic reclosing until
the command is released, so the local trigger period must also be verified.

## Implementation map

| File | Purpose |
| --- | --- |
| `pi-door-service/door_service.py` | Four-channel Pi HTTP service and persistent pulse journal |
| `app/remote-open-panel.tsx` | Explicit operator confirmation and pulse-only acknowledgement |
| `lib/remote-open-client.ts` | Same-origin client requests; no device token or sensor updates |
| `lib/door-open-gateway.ts` | Server configuration, door mapping and single upstream request |
| `app/api/doors/open/route.ts` | Sites session/role and emergency-priority enforcement |
| `app/compass-wiring-reference.tsx` | Existing board and corrected installation notes |
| `AI_REFERENCE_MASTER.md` | Scope and limitations for future development |


