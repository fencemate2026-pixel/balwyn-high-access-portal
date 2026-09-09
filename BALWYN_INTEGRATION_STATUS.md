# Balwyn integration status and wiring reference

Updated 2026-09-08 UTC for `fencemate2026-pixel/balwyn-high-access-portal`.
Read this with `README.md`, `AI_REFERENCE_MASTER.md` and the actual source.

## Current status

| Area | Verified status |
| --- | --- |
| Repository dashboard | Existing static demonstration retained; its gate positions, schedules and emergency modes are simulated |
| Optional Compass opening | Python Pi service, isolated relay request, browser control, authenticated gateway, logging and mock tests implemented |
| Hosted Sites portal | Separate, newer implementation with server-verified operators and an independent sensor-controller workflow |
| Live Pi connection | No `DOOR_SERVICE_URL`, `DOOR_SERVICE_TOKEN` or `DOOR_GATE_MAP` variables were configured on the Sites portal when checked |
| Physical operation | No live relay, gate, lock or emergency operation was tested during this update |
| Cameras, AI and projectors | Do not treat interface screens or guidance previews as evidence of commissioned hardware or a connected trained model |
| Publication | Sites update saved; this GitHub synchronization does not itself publish that Sites version |
| AI learning | Documentation is available to an authorised ingestion process after this push. No model training, retrieval refresh or model deployment was run |

## Implemented open-only interface

The existing Compass ACB-004 has four door channels. The Pi sends one isolated
contact pulse across the verified exit input P1–P4 and its matching GND. GPIO
must never connect directly to the access board, maglock or motor controller.
No card-database synchronization or proprietary ACB-004 Ethernet protocol has
been implemented. One board is not a verified mapping of all 17 campus gates.

- `POST /doors/1/open` through `POST /doors/4/open` is the complete Pi command surface.
- A request pulses exactly one configured output for 300–800 ms; default 500 ms.
- Mock/dry-run is the default. Hardware mode requires explicit verified pin,
  polarity, isolation, network and token configuration.
- Bearer authentication, fixed output mapping, persistent request IDs, duplicate
  suppression and logs are included. Ambiguous requests are never auto-retried.
- An acknowledgement means `pulsed` or `dry_run`; physical position remains
  `unknown`, and `sensor_feedback` remains `false`.
- This path cannot close, toggle, hold open, sequence a maglock/motor, or issue
  fire/lockdown commands. It supplies no gate, lock-release or safety feedback.
- The Netlify demonstration requires a separate operator token. Its demo login
  is not hardware authorization. The Sites route uses its existing operator
  session and rejects manual opening under emergency priority.

## Magnetic lock and Roger F70/IPU36

These are proposed connections for matching equipment, subject to onsite
verification of the board revision, lock ratings and local interface.

**Do not share a powered lock-relay COM with the Roger command common.** NC and
NO on a changeover relay share COM. Feeding lock power into COM makes NO a
switched power output. It does not remain an isolated dry contact.

| Device / wire | ACB-004 or lock supply | Separate isolated interface | Roger F70/IPU36 |
| --- | --- | --- | --- |
| Maglock positive | Assigned door-relay NC | — | — |
| Maglock negative | Dedicated lock supply negative | — | — |
| Lock supply positive | Assigned door-relay COM through the approved protected supply / emergency-release circuit | — | — |
| Gate trigger wire 1 | No direct connection to powered lock COM | Voltage-free contact COM | 32 COM |
| Gate trigger wire 2 | No direct connection to powered lock NO | Voltage-free contact NO | 34 AP (opening) |

Use 12 V DC only if the installed lock requires 12 V. Opening the NC path removes
power to release a fail-safe maglock. Retain the approved emergency power-release
arrangement and verify contact ratings.

Use a suitable local interface/sequencer with electrically isolated contacts to
release the lock before commanding movement. The proposed 3–5-second unlock
period is only a commissioning candidate, not an approved site setting or a
universal residual-magnetism delay. Measure release, clearance and travel, and
restore locking at the appropriate point. The Pi request pulse is a separate
timing and must not substitute for this local sequence.

The manufacturer manual identifies **34 AP / 32 COM** as the open input. **36 PP /
38 COM** is step-by-step and is excluded from this open-only design. Holding AP
active inhibits automatic reclosing until AP is released.
[Roger F70/IPU36 installer manual, command table](https://www.manualslib.com/manual/3373474/Roger-Technology-F70-Ipu36.html?page=23).

The ACB reference is the user-supplied S4A ACB-00 wiring manual, PDF sheet 3,
ACB-004 diagram. Software-guide references: §§2.2, 2.5, 3.2.2 and 3.3.1.
These manuals describe contact functions; they do not certify the installed system.

## Commissioning scope

Verify permissions and readers, schedules, hold-open and return to secure
operation, remote commands, independently measured gate-state feedback,
emergency behaviour, safety functions, and recovery after power or communications
failure. Physical feedback and emergency functions require their own verified
local systems; the Pi opening service cannot supply them.

## Website changes and source record

The duplicate small MagicKeys logo beside the main artwork came from the source
image used for the AI head. The Sites `BrandArtwork` component now applies an
explicit SVG clip to the image at x=800, y=0, width=463, height=984. This excludes
the embedded small logo at wide layouts while retaining the main logo and head.
The full Wiring section is available under System Settings in both implementations.

The exact Sites source update is retained in
[`docs/sites/2026-09-08-compass-and-branding.patch`](docs/sites/2026-09-08-compass-and-branding.patch),
from Sites source commit `ddf5cfc240b47ad339786177023a317b2a9b689e`.
It records all changed Sites source, including the artwork fix and Sites API
route. It is a reference for that separate source history; do not apply it blindly
to this older demonstration. This repository's runnable integration uses
`netlify/functions/remote-open.mts` and preserves its existing simulation.

The Sites build, TypeScript check and 19 remote-open tests passed. These were
software/mock checks; they do not verify real wiring, movement or emergency response.

The GitHub demonstration also passed all 20 tests in `npm run test:doors`
(nine JavaScript tests and eleven Python tests). Its static export and TypeScript
check passed with `npm run build:netlify:static -- --webpack`. Webpack was used
because this workspace shares dependencies through an external symlink, which
the default Turbopack build rejected. No production dependency or build-setting
change was needed for that local verification.
