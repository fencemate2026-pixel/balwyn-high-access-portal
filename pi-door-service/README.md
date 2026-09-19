# Compass ACB-004 open-only relay service

The existing Compass ACB-004 is a four-door access controller. This Python 3.10+
service drives an isolated Pi relay contact for an assigned request-to-exit
input. It does not speak the ACB-004 TCP/IP protocol, read cards, change its
database, or provide door/lock/safety feedback. One channel corresponds to one
of the board's four door inputs; a single board is not a mapping of all 17 gates.

## HTTP contract

`POST /doors/1/open` through `POST /doors/4/open`, with:

- `Authorization: Bearer <DOOR_API_TOKEN>` (a random, private token).
- `Idempotency-Key: <canonical UUID>` (a fresh key for a deliberate new request).
- An empty body. Pins, duration, and polarity cannot be changed by a request.

There are no close, hold-open, toggle, bulk, sensor or emergency endpoints.
Successful responses have `status: pulsed` in hardware mode or `status: dry_run`
in mock/dry-run mode, plus `door`, `pulse_ms`, `request_id`, `position: unknown`
and `sensor_feedback: false`. A pulse acknowledgement is not proof of movement.

401 rejects unauthorised calls; 400 rejects malformed requests; 404 rejects
unsupported paths/doors; 405 rejects unsupported methods; 409 rejects concurrent
or ambiguous/reused requests; 503 reports local faults. No request is queued or
automatically retried. On a timeout the physical outcome may be unknown: inspect
locally before a new request. Reusing a completed key returns the original
acknowledgement without pulsing; the same key for a different door is rejected.

The SQLite journal is committed before energising a relay. A request interrupted
by a restart stays reserved and cannot replay. Preserve this journal during
upgrades; deleting it removes duplicate protection. Logs contain request IDs,
door numbers, modes and outcomes, never tokens. Only one pulse runs at a time.
GPIO exceptions latch a fault until an operator investigates and restarts.

## Dry run on a development machine

No third-party Python packages or GPIO hardware are needed for mock mode.

```bash
cd pi-door-service
export DOOR_API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export DOOR_MODE=mock
python3 door_service.py
```

The service binds to `127.0.0.1:8080` by default. From another terminal with the
same token securely loaded:

```bash
curl --fail-with-body -X POST http://127.0.0.1:8080/doors/1/open \
  -H "Authorization: Bearer $DOOR_API_TOKEN" \
  -H "Idempotency-Key: $(python3 -c 'import uuid; print(uuid.uuid4())')"
```

`DOOR_MODE=dry-run` is equivalent to mock mode. Neither imports `lgpio` or touches
physical GPIO. Example pins 17,27,22,23 are mock examples, not an onsite pin map.

## Pi installation

1. Verify the relay module accepts the Pi's 3.3 V logic, its isolation and active
   polarity. Use voltage-free contacts on the board side. Never wire GPIO to an
   ACB terminal, a maglock, mains or a motor input directly.
2. Install the Raspberry Pi OS `python3-lgpio` package. Create an unprivileged
   `compass-door` service account with access to the `gpio` group. Install
   `door_service.py` in `/opt/compass-door-open/`.
3. Copy `config.example` to `/etc/compass-door-open.env`, owned by root with mode
   600. Replace the placeholder token. Start with `DOOR_MODE=mock`.
4. Install `compass-door-open.service` in `/etc/systemd/system/`, then run
   `sudo systemctl daemon-reload` and `sudo systemctl enable --now compass-door-open`.
   Inspect logs with `sudo journalctl -u compass-door-open`.
5. Record the verified four BCM pins in door 1,2,3,4 order as `DOOR_GPIO_PINS`.
   Each pin must be distinct. Explicitly set `DOOR_ACTIVE_LOW=true` or `false`
   and the correct `DOOR_GPIO_CHIP`. Confirm the hardware starts with all relays
   inactive. Only after commissioning, select `DOOR_MODE=hardware` and restart.

`DOOR_PULSE_MS` is a fixed integer from 300 through 800 (default 500). It is a
request pulse, not a lock-release timer. Linux scheduling is not a hard real-time
guarantee; verify measured pulse length and fail-off behaviour on the installed
relay hardware. Software cannot guarantee contact release after a welded relay,
power fault, forced process kill or hardware failure.

Place the loopback HTTP service behind the school's approved TLS gateway or
reverse proxy for access from the hosted portal. `DOOR_SERVICE_URL` must be a
reachable HTTPS origin. A cloud-hosted portal cannot reach a private Pi IP just
because it is entered in an environment variable. Keep tokens out of URLs,
client bundles and proxy/access logs. Do not expose an unauthenticated Pi port.

## Maglock and Roger F70/IPU36 interface

The supplied ACB-004 diagram shows door exit inputs P1–P4/GND and per-door
COM/NO/NC lock contacts. Have the installer confirm labels and current usage
onsite. The intended Pi path is one isolated normally-open contact across the
assigned ACB request-to-exit input and its matching ground; existing local
access-control logic handles the release.

| Circuit | Connection | Isolation / timing requirement |
| --- | --- | --- |
| Lock supply positive | Dedicated lock PSU positive to ACB door-relay COM | Voltage must match the maglock nameplate; check contact/current ratings |
| Maglock positive | ACB door-relay NC to lock positive | Interrupts lock power to release a fail-safe maglock |
| Maglock negative | Lock negative to the lock PSU negative | Preserve the installed emergency power-release arrangement |
| Roger open trigger | Separate isolated dry-contact COM to 32 COM; NO to 34 AP | No external lock voltage on this contact; verify local unlock-before-motion sequence |
| Roger PP reference | 36 PP with 38 COM | Not used: step-by-step is not an open-only command |

**Do not reuse a powered lock relay's COM/NO to command the Roger board.** NC and
NO share COM on a changeover relay. Feeding +12 V to that COM makes its NO side
a switched +12 V output, not an isolated dry contact. Use separately isolated
contacts and a correctly rated local interface/sequencer. Simply using another
door relay does not establish correct sequencing.

The Python service pulses one channel only; it does not separately release a
maglock and then energise a motor. The approved local controller/interface must
release the lock before gate movement and restore locking at the appropriate
point. No generic 3–5-second setting or blanket residual-magnetism delay is
specified here. Confirm the installed lock, suppression, controller release
time, gate travel, emergency release, and applicable local safety circuits.
The 300–800 ms Pi pulse must not be extended to substitute for this sequence.

Sources: user-supplied S4A ACB-00 wiring PDF, sheet 3 (ACB-004) and sheet 4
(optional ACB-EA05 module); software guide pp. 15–18, 32–34, 45–46 and 61.
The wiring guide's optional fire expansion is not evidence it is installed.
Roger terminal references are from the manufacturer-authored
[F70/IPU36 IS247 R1.50 installer manual, command table](https://www.manualslib.com/manual/3373474/Roger-Technology-F70-Ipu36.html?page=23),
reproduced by ManualsLib. Verify the model/revision against the installed board.

## Tests

```bash
python3 -m unittest discover -s pi-door-service/tests -v
```

Run from the repository root. Tests exercise the HTTP routes and authentication,
four-channel isolation, bounds/polarity, mock operation, concurrent requests,
GPIO failure cleanup, shutdown, durable duplicate protection and log redaction.
They use mock outputs and cannot certify field wiring or real gate movement.
