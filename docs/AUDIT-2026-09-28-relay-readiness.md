# Magic Keys Balwyn: full audit before connecting the relays (28 Sep 2026)

Audited commit: `main` @ `60f40dd` (the commit Azure deployed on 27 Sep, runs
36338317200 and 36338317079 both green). Fixes are on branch
`claude/magic-keys-design-system-v26nbq`.

Evidence labels: **VERIFIED** = run in this audit, output recorded ·
**FROM SOURCE** = read from a named file or document · **UNVERIFIED** = can
only be proven on the Pi or on site. Nothing here was run on a Raspberry Pi or
against a relay, and no relay was operated.

## Verdict

Before these fixes, the Pi gate controller **could not have started on the
Pi**. There were three independent start-up blockers, and the service would
have given up after 10 restarts. A fourth defect would have dropped a fire /
evacuation hold whenever the school network hung. All four are fixed and
covered by tests on this branch.

With this branch, everything that can be tested off site passes. Everything
that depends on the physical Pi, relay board, reeds, F70 settings and the
school network is UNVERIFIED until the on-site steps in
`gate-controller/deploy/INSTALL.md` (B0, sections 3–6, C1–C7, B3) are done.

**Use the `gate-controller` folder from this branch on the Pi, not from
`main`, until this branch is merged.**

## What was run (all VERIFIED)

| Check | Before fixes | After fixes |
|---|---|---|
| `npx tsc --noEmit` | pass | pass |
| `npx eslint .` | 0 errors, 16 warnings | 0 errors, 16 warnings (unchanged) |
| `npm run build` | pass | pass |
| `node --test tests/*.test.mjs` | 107/107 | 108/108 |
| gate-controller Python tests | 17/17 (never run by CI) | 27/27 (now run by `npm test` and the Azure pipeline) |
| controller-agent Python tests | 3/3 | 3/3 |
| pi-door-service Python tests | 11/11 | 11/11 |
| Portal ↔ real controller end-to-end (`tests/gate-controller-e2e.test.mjs`) | pass | pass (threaded controller) |
| One controller tick with a black-holed network | **24.0 s** | worst **3 ms** over 200 ticks, fire hold kept |
| `import lgpio` as an unprivileged user in a read-only directory | **FileNotFoundError '.lgd-nfy-3'** | imports; next step is opening the GPIO chip (no GPIO in the sandbox) |
| Example env file through `check-config`, parsed as systemd parses it | **fails** (`INPUT_PULL must be up, down or off`) | passes |

## Findings fixed on this branch

| # | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| 1 | Critical | `import lgpio` creates a notification FIFO (`.lgd-nfy*`) in the current directory at import time. The service runs as `balwyn-gate` from root-owned, read-only `/opt/balwyn-gate-controller` (`ProtectSystem=strict`), so the import crashed. The install guide's step 4 `read-inputs` crashed the same way. | VERIFIED (reproduced with lgpio 0.2.2.0 as user `nobody`); FROM SOURCE lgpio `lgpio_extra.py:331`, `lgNotify.c:130` | `LgpioBackend` sets `LG_WD` to `<state dir>/lgpio` (or a private temp dir) before importing lgpio. |
| 2 | Critical | Every line of `gate.env.example` had an inline `# comment`. systemd keeps everything after `=` as the value, so `RELAY_PIN` became `17  # relay COM/NO …` and the service refused to start. | FROM SOURCE systemd v252 `src/basic/env-file.c`; VERIFIED by running `check-config` on the file parsed the same way | Comments moved to their own lines. The controller now names any setting containing `#`. A test runs the shipped example through `check-config`. |
| 3 | Critical (probable) | The unit had `Requires=dev-gpiochip0.device`. Raspberry Pi OS never tags gpiochip devices for systemd, so that unit never starts and the service fails with a dependency error after the device timeout. | FROM SOURCE RPi-Distro `99-com.rules` (no `TAG+="systemd"` for gpio), systemd `99-systemd.rules`; UNVERIFIED on a Pi | Dependency removed (the controller already fails fast and restarts if the chip is missing). |
| 4 | High | All portal HTTPS calls ran inside the 50 ms control loop, with an 8 s timeout per call, and DNS lookups are not bounded at all. A hung network blocked the loop for 24 s. systemd's 15 s watchdog then kills the controller, which releases the relay, **including a fire / evacuation hold** that is designed to survive network loss. The same blocking also delayed the safety-input interlock. | VERIFIED (black-hole server test) | Network exchanges run on a worker thread (`PortalLink`); the loop never waits. Tests use the same code inline. New tests: black-holed network (tick < 0.25 s, fire hold kept) and a threaded end-to-end open. |
| 5 | Medium | Python's `urllib` follows redirects and re-sends the `Authorization` header, so a redirect from the portal URL would hand the gate credential to another host. | VERIFIED by test | Redirects refused; reported as e.g. `HTTP 301` (fix `PORTAL_URL`). |
| 6 | Medium | A 200 reply whose JSON is not an object (captive portal, proxy) raised an uncaught error in the control loop, and a controller crash releases the relay. | VERIFIED by test | Treated as "portal unreachable". |
| 7 | Medium | Neither `npm test` (the Verify workflow) nor the Azure deploy pipeline ran the gate-controller tests: the code that drives the relay was never checked by CI. | FROM SOURCE `package.json`, `.github/workflows/*.yml` | Added to both. |
| 8 | Medium | `/api/doors/open` (the older Compass ACB-004 path) ignored the stored "remote open" switch, while the help assistant reported that switch as authoritative. | FROM SOURCE `app/api/doors/open/route.ts`, `app/api/help/route.ts` | One shared reader: the switch can only disable the path. The relay-channel mapping always comes from the server setting `DOOR_GATE_MAP`, never from a saved value. Test added. |
| 9 | Medium | Dashboard text was false: "Controller-side schedule execution stays disabled until commissioning sign-off" and "…until the school approves its operating plan". In fact a gate follows schedules, bookings and rules as soon as its controller commissions itself (first healthy heartbeat) with `SCHEDULE_CONTROL=true`, and nothing checks for sign-off. | FROM SOURCE `lib/portal-store.ts:380-402`, `app/api/controller/commands/route.ts:24-27` | Wording corrected. The example env now starts with `SCHEDULE_CONTROL=false`; the install guide switches it on after test C1. |
| 10 | Low | The "clear emergency" dialog did not say that gates opened by the fire command can stay held open (a fire hold has no timer). | FROM SOURCE `relay.py`, `portal-store.ts:248-256` | Dialog now says to check each gate and press Close. |
| 11 | Low | The help guide described an Equipment settings screen that does not exist, said schedules need the administrator password (operators can save them), and indexed the superseded `controller-agent` README instead of the current controller docs. | FROM SOURCE | Sections corrected; help index now includes `gate-controller/README.md` and `deploy/INSTALL.md`. |
| 12 | Low | Install guide: no way to get the code onto the Pi, a multi-line command (breaks in Termius), no bench test before connecting the gate, no relay-board requirements, no clock or network checks. | FROM SOURCE | Added section 0 (what to buy), copy step, B0 bench test, clock/NTP and HTTPS checks, optional `config.txt` boot-state line, single-line commands. |

## Decisions for you (nothing changed)

1. **Operators can make gates open.** Any operator (not only administrators)
   can save weekly gate schedules and create facility-hire bookings. A booking
   defaults to holding its area's gates open from 15 min before to 15 min
   after (FROM SOURCE `app/api/hire/route.ts:105-107`). Automation rules need
   an administrator plus the settings password; schedules do not. Decide
   whether saving schedules should need the administrator unlock too.
2. **Pi restart during fire / evacuation.** If the Pi restarts while fire mode
   is active (power blip, crash), the relay drops and the operator auto-closes
   the gate. Nothing re-opens it: fire mode disables schedule re-sends. The
   dashboard shows that gate under "require attention" (it does not claim it is
   open), and an administrator must use "Reissue". The fire panel remains the
   life-safety authority. Decide whether the portal should re-send the fire
   OPEN automatically.
3. **Two relay paths exist.** `/api/doors/open` → `pi-door-service` (Compass
   ACB-004): open pulse only, no position feedback, no safety-input check, and
   it needs an inbound HTTPS route to the Pi. `gate-controller` is the
   supervised path, and HANDOVER.md allows only one service per relay board.
   Recommendation: do not install `pi-door-service` or `controller-agent` on
   the Pi, and leave `DOOR_SERVICE_URL`, `DOOR_SERVICE_TOKEN` and
   `DOOR_GATE_MAP` unset in Azure. UNVERIFIED: I could not read the Azure app
   settings.
4. **GitHub organisation deletion.** `deploy/azure/MIGRATION.md` says the
   organisation is "scheduled for deletion about 5 Oct". The source and the
   Azure deploy pipeline live there. Mirror the repository now
   (`git clone --mirror`).
5. **Relay board polarity and boot state.** Hardware-dependent and UNVERIFIED.
   Test B0 (meter across COM/NO through power-on, boot and reboot, before
   connecting the gate) is the proof. The firmware `gpio=` line in
   `config.txt` holds the pin in the OFF state from early boot, but the
   Raspberry Pi documentation says it takes effect a few seconds after power-on
   (FROM SOURCE raspberrypi/documentation `config_txt/gpio.adoc`). What the
   relay does in those first seconds depends on the board and the pin's
   default pull (UNVERIFIED until B0).

## Hardware facts used (sources)

* Core Electronics PiRelay V2 (CE08517) and 8 Relays Card are driven over I²C,
  **not compatible** with this controller, which switches a GPIO pin.
  Waveshare 3-channel RPi Relay Board (WS-11638): relays on GPIO 26 / 20 / 21.
  Core Electronics 5 V single-channel relay (CE05137): active-low, and supply
  must match logic level (use 3.3 V on a Pi). The Pi 5 needs the official
  27 W supply (CE09787). (Core Electronics product pages via search results;
  the site itself was blocked by this sandbox's network policy.)
* Current Raspberry Pi OS: the 40-pin header is `/dev/gpiochip0` on Pi 4 and
  Pi 5 (Pi 5 kernels before 6.6.45 used gpiochip4). `python3-lgpio` is in
  Raspberry Pi OS Bookworm and Trixie.
* lgpio raises an exception on any failed call (`lgpio_extra.py`:
  `exceptions = True`), so a pin that is busy or missing stops the controller
  instead of being ignored.

## Not covered or not verifiable here

* Anything on the physical Pi, relay, reeds, F70/IPU36 or the school network
  (UNVERIFIED by definition; proven only by INSTALL.md tests B0–B3 and C1–C7).
* The live portal (`magickeys-balwyn-portal.com`) and Azure settings: blocked
  by this sandbox's network policy, so the live database (schedules,
  bookings, issued credentials) was not inspected.
* `controller-agent/` and `pi-door-service/`: superseded. Their tests were run
  and pass; they were not audited line by line and should not be installed.
* UI styling and marketing / plan-upgrade copy were not proofread word by
  word. Hardware, relay, emergency, schedule and controller wording on the
  dashboard and in the help guide was.
