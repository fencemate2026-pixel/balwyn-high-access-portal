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
| 30 | Extra sandboxing missing | Defence in depth | Added `RestrictNamespaces`, `RestrictSUIDSGID`, `RestrictRealtime`, `ProtectKernelLogs`, `ProtectClock`, `ProtectHostname`, `SystemCallArchitectures=native`, `UMask=0077` (UNVERIFIED on the Pi: a directive systemd rejects would stop the service; run `systemd-analyze verify` on the Pi) |

Tests that pass on old code too (guard unchanged correct behaviour): open still blocked by a safety trip, manual close
still ends a fire hold, an unconfirmed fire hold is kept, a 401 ack is kept, an oversized reply is refused.

## OPEN: not fixed, and why

| # | Item | Why it is open | Who decides |
|---|---|---|---|
| A | **Portal gives no commands at all while `safetyOk` is false** (`app/api/controller/commands/route.ts`: `body.safetyOk && commissioned ? getNextControllerCommand`) | Fix 2 makes the Pi accept a close, but the portal still will not send one while a safety device is tripped. A fire hold therefore cannot be ended remotely in that state | Portal change: your decision |
| B | An emergency hold has no time limit (intended for fire) | A compromised portal credential could hold a gate open for ever | Set a maximum, or accept |
| C | Venus holds: the controller holds the single IN1 contact for schedule and fire opens. The Venus has a separate "hold to keep open" input (IN2) | Whether a maintained IN1 contact holds a Venus open is UNVERIFIED. With `SCHEDULE_CONTROL=false` (the example files) nothing holds IN1 except fire | Bench test V-series with the real Venus; may need a second relay channel on IN2 |
| D | After a crash or restart the controller reports the interrupted command "failed" and does not re-apply a fire hold | The portal does not re-send an acknowledged emergency command (UNVERIFIED how it behaves) | Portal design |
| E | Only the last 200 command ids are remembered | Rejecting older ids would refuse every command if the portal database ever restarted its numbering | Needs a decision on portal id guarantees |
| F | No cap on how often a hostile portal can cycle the gate | Needs a chosen limit | Your decision |
| G | `DynamicUser=` and a system-call filter not added | Cannot be tested without a Pi; a wrong filter breaks `lgpio` | Bench |
| H | Both gates share one Linux user | One compromised service could read the other's token | Low |
| I | `journal.threat_*` helpers (unused by the controller) accept unauthenticated free text | Nothing calls them; `threat-learning/learner.py` only reads their events | Remove if you agree |
| J | An unreadable SD card in the middle of `pulse()` could hold the relay lock while the audit write waits | Rare; the pulse deadline is still enforced by the watchdog thread | Low |
