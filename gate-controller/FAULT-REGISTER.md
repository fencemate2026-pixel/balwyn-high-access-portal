# Balwyn gate controller: fault register (review of 15 Oct 2026)

Source: three independent reviews of branch `fix/gate-controller-ks0212-relays-off` @ 8f447d4 (correctness, security,
hand mutation testing: 80 mutants, 34 survived the old 60-test suite), each finding re-checked against the code and
against the portal source (`lib/portal-store.ts`, `app/api/controller/commands/route.ts`).

Evidence: **VERIFIED** = run in this session (Python suite 135 tests, `node --test` end-to-end 5 tests). Nothing here has
run on a Pi, with real GPIO, real reeds, a Venus operator or systemd. Those are **UNVERIFIED** and are the bench
tests B0 to B4 and commissioning C1 to C7 in `deploy/INSTALL.md`.

"Failed before" = the new test was run against the 8f447d4 code and failed there.

## Fixed (VERIFIED by test; failed before unless noted)

| # | Fault | Effect | Fix |
|---|---|---|---|
| 1 | Fire open failed when the access-board unlock press was still running (needs `UNLOCK_RELAY_PIN`; not used in the Venus plan) | Evacuation open refused | A fire command cancels the old press first |
| 2 | A close was blocked while the safety input was unhealthy | A fire hold could not be ended while a safety device was tripped | Only OPEN needs a healthy safety input |
| 3 | A close from source `schedule` ended a fire hold | A schedule window ending during a fire dropped the evacuation hold | Only `emergency` or `manual` closes end a fire hold |
| 4 | JSON `Infinity` as a command id raised out of `tick()` | Process exit, every relay released (fire hold dropped), restart loop | Ids must be real positive integers; handler errors are contained |
| 5 | JSON `NaN` as `pollAfterMs` | Polling stopped for ever; fire hold could not be released remotely | Non-finite values replaced by 1.5 s |
| 6 | Any exception in `tick()` ended the process | Same as 4 | Bad tick survived; exit only after 100 in a row (~5 s); only healthy ticks feed the systemd watchdog |
| 7 | A disk error while recording a result raised | Same as 4; a stale in-progress record caused a crash loop at start | Result kept in memory, fault reported; broken saved state is set aside |
| 8 | A refused or failed command re-sent by the portal was acknowledged "acknowledged" if the gate happened to be in position | Portal recorded a success that never happened | The recorded outcome is replayed |
| 9 | `SCHEDULE_CONTROL=false` was only sent to the portal, never enforced | A queued schedule open would still hold the gate when DRY_RUN went false | Schedule opens refused ("blocked") |
| 10 | Portal reply read in two steps | Rare: a reply holding a command could be lost | One atomic check |
| 11 | A portal exchange that never returned blocked polling for ever | No heartbeat, no ack, no remote release | Abandoned after 60 s; a late reply is discarded |
| 12 | Schedule hold left on after the open was reported failed | Relay on for up to 14 h behind a "failed" report | Released (fire hold kept) |
| 13 | Ack the portal permanently rejects (400/404/409/410/422) retried every 2 s for ever | Starved newer acks | Dropped and audited. 401/403/408/429/5xx are still retried |
| 14 | Unlimited duplicate acks per command | Queue growth | One per command, capped at 50 |
| 15 | Unknown `source` string passed through | 60 KB audit lines could push the real history out of the rotated log | Only manual / schedule / emergency accepted (the portal's three values); audit text clipped |
| 16 | Error body that is a JSON list, truncated reply, deep JSON | Exception outside `PortalError`; real status lost | All become `PortalError` |
| 17 | Server dribbling a reply one byte at a time | One exchange held for days | 20 s total deadline, 64 KB cap |
| 18 | Portal error text with newlines | Forged log lines | One line, 200 characters |
| 19 | `ALLOW_INSECURE_HTTP_FOR_TESTS=1` honoured for any host | Token in clear text from one stray env line | Loopback only |
| 20 | `CA_FILE` not checked | `check-config` passed, then the service crash-looped | Checked at config time |
| 21 | Non-ASCII digits in a pin raised `ValueError` | Traceback instead of a clear message | `ConfigError` |
| 22 | `read-inputs` needed the token on the command line (INSTALL step 4) | Token visible in `ps` and the sudo log | `read-inputs` needs no token; doc corrected |
| 23 | Journal directory not synced after the rename; failed `begin()` left an in-progress record in memory | Power cut just after a command start could repeat it; phantom "restarted" report | Directory fsync; state restored on failure |
| 24 | Audit log written from two threads without a lock | Lost or misplaced lines at the moment of a relay fault | Lock |
| 25 | Recorded relay pins accepted GPIO 2, 3, 14, 15 | `relays-off` could drive a pin the controller itself refuses | Filtered |
| 26 | `TimeoutStopSec=5` also limits `relays-off` | A slow Pi could kill `relays-off` mid-run | 20 s |
| 27 | `After=network-online.target` | Relay pin claimed OFF up to two minutes after boot | Removed (the controller polls with back-off) |
| 28 | `config.txt` early-boot line was "recommended" | With `RELAY_ACTIVE_LOW=true`, the relay is ON from power-up | Documented as required for every board |
| 29 | INSTALL pointed everyone at the KS0212 env file; generic example had a 1 s pulse | A Venus closes again if released while opening | Venus file is the default; warning added |
| 31 | Portal handed no command at all while `safetyOk` was false, so a fire hold could not be ended remotely (portal code) | Fire hold stuck until a site visit | Portal now hands a CLOSE (never an OPEN) to an unsafe controller; a CLOSE confirmed by the reed is accepted without a healthy safety input. `tests/gate-service.test.mjs` and `controller-safety.test.mjs` (both fail on the old portal code) |
| 32 | Fire hold ended silently by a crash, update or power cut | Evacuation hold lost | Remembered in `state.json`, switched back on at start-up (12 h limit), ended only by a close |
| 33 | Fire hold had no visible age | Forgotten hold, or a stolen credential holding a gate open | Fault shown after 4 h (`EMERGENCY_ALARM_S`); not ended by a timer |
| 34 | Only 200 command ids remembered | Old ids replayable after 200 newer ones | 1000 ids |
| 35 | No limit on opens | Hostile or runaway portal could cycle the gate and lock | 30 per 10 min, fire exempt |
| 36 | Any 404 on an ack was treated as "command unknown" | A portal update with a missing route silently threw acks away | Only the portal's own "Command not found." drops the ack |
| 37 | Token file could be world-readable | Leaked credential | Refused unless mode 600 (or systemd's private copy) |
| 38 | Unused `threat_*` helpers in the journal (unauthenticated free text into the audit log) | Possible forged "approval" lines if ever wired up | Removed |
| 30 | Extra sandboxing missing | Defence in depth | Added `RestrictNamespaces`, `RestrictSUIDSGID`, `RestrictRealtime`, `ProtectKernelLogs`, `ProtectClock`, `ProtectHostname`, `SystemCallArchitectures=native`, `UMask=0077` (UNVERIFIED on the Pi: a directive systemd rejects would stop the service; run `systemd-analyze verify` on the Pi) |

Tests that pass on old code too (guard unchanged correct behaviour): open still blocked by a safety trip, manual close
still ends a fire hold, an unconfirmed fire hold is kept, a 401 ack is kept, an oversized reply is refused.

## OPEN: not fixed, and why

| # | Item | Why it is open |
|---|---|---|
| C | **Venus hold-open.** The controller holds the single IN1 contact for schedule and fire opens. The Venus also has a separate "hold to keep open" input (IN2) | Whether a maintained IN1 contact holds a Venus open is UNVERIFIED and cannot be settled in code. With `SCHEDULE_CONTROL=false` (the example files) only a fire open holds IN1. Bench test V-series with the real Venus decides whether a second relay channel on IN2 is needed |
| G | `DynamicUser=` and a system-call filter | A wrong filter stops `lgpio` working; cannot be tested without a Pi. Run `systemd-analyze verify` and the B-tests on the Pi first |
| H | Both gates run as one Linux user | One compromised service could read the other's token. Low; needs a per-gate user, which changes the install |
| J | A stalled SD card during `pulse()` can hold the relay lock while the audit write waits | The pulse deadline is still enforced by the watchdog thread. Low |
