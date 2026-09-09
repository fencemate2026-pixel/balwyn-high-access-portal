# Magic Keys – Balwyn High School

This repository contains the original static gate-control demonstration. Its
existing simulated behaviour is preserved. The school's existing
**Compass ACB-004 four-door access board** now has an optional **one-way,
open-only Pi relay trigger**, alongside the demonstration controls.

Read [Balwyn integration status](BALWYN_INTEGRATION_STATUS.md) for the current
implementation, corrected wiring, verification results and remaining commissioning.
The exact newer Sites changes, including the duplicate-logo fix, are retained in
[the source patch](docs/sites/2026-09-08-compass-and-branding.patch).

## What the ACB-004 integration does

- `POST /doors/{1-4}/open` on the Pi pulses exactly one configured GPIO relay
  channel for 300–800 ms (default 500 ms).
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

## Configure the optional Netlify gateway

The existing static export stays in place. `netlify/functions/remote-open.mts`
adds a server function at `/.netlify/functions/remote-open`; no dynamic Next.js
API route is added to the static export. Set these variables in Netlify's
server function environment (not in browser build variables):

| Variable | Value |
| --- | --- |
| `DOOR_SERVICE_URL` | Reachable HTTPS origin of the approved Pi gateway, without a path |
| `DOOR_SERVICE_TOKEN` | Private random token matching the Pi's `DOOR_API_TOKEN` |
| `DOOR_GATE_MAP` | JSON mapping existing gate IDs to unique board channels 1–4 |
| `DOOR_OPERATOR_TOKEN` | A different random token, at least 32 characters, issued to authorised remote-open operators |

Example format only: `{"TF-ENTRY":1,"TF-EXIT":2}`. This is not a verified onsite
allocation; no live mapping is supplied. One ACB-004 maps at most four gate IDs.
With all service variables absent, the remote controls stay hidden and the
existing simulation works as before. Invalid/partial configuration is blocked.

Open a mapped gate's panel and enter the separate operator token to review a
remote-open request. This token is held only in component memory and cleared
after every attempt or when the panel changes. It is never saved in localStorage
or sessionStorage. The Pi token remains on the server and must differ from the
operator token. The demo login never authorises hardware by itself. Rotate or
remove the operator token to revoke access. Avoid entering it on a shared
untrusted device.

Only explicitly confirmed remote-open requests use this function. Existing
Open/Close controls are labelled **Simulate open/close**, and emergency modes,
schedules, counts, colours and voice announcements remain demonstration state.
They are not ACB-004 sensor feedback and do not operate this service. A remote
pulse never changes a simulated gate position.

The function checks the separate token, request origin and server-side mapping;
it does not trust the demo user name, gate state or a client-supplied channel.
No automatic retry occurs after an uncertain response. Set up the approved HTTPS
network path to the Pi before live mode; a private LAN IP is not cloud-reachable.

Build the existing deployment with `npm run build:netlify:static`. Local static
preview has no Netlify function and retains the demo. To exercise the function,
use Netlify's supported local functions runtime or a controlled deployment with
the Pi in mock mode. See [Netlify's function guide](https://docs.netlify.com/build/functions/get-started/).

The separately hosted Sites portal has newer operator authentication and uses
its own `/api/doors/open` route. Its existing UI and sensor-controller workflow
are preserved; this repository is not a replacement for that newer source.

## Maglock and Roger F70/IPU36

System Settings contains the Wiring section, connection matrix, unlock timing
and commissioning scope. See [the current reference](BALWYN_INTEGRATION_STATUS.md#magnetic-lock-and-roger-f70ipu36).
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

## Implementation map

| File | Purpose |
| --- | --- |
| `pi-door-service/door_service.py` | Four-channel Pi HTTP service and persistent pulse journal |
| `app/remote-open-panel.tsx` | Explicit operator confirmation and pulse-only acknowledgement |
| `lib/remote-open-client.ts` | Same-origin client requests; no device token or sensor updates |
| `lib/door-open-gateway.ts` | Server configuration, door mapping and single upstream request |
| `netlify/functions/remote-open.mts` | Separate operator authentication for the static Netlify demo |
| `app/compass-wiring-reference.tsx` | Existing board and corrected installation notes |
| `AI_REFERENCE_MASTER.md` | Scope and limitations for future development |
