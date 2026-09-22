# Compass gate relay adapter (simulation-first)

This Python service is the backend-only GPIO adapter for gate relay pulses. The browser never touches GPIO directly.

## Safety model

- **Simulation is default** (`HARDWARE_ENABLED=0`).
- Real GPIO requires explicit `HARDWARE_ENABLED=1` plus valid operator/admin tokens and webhook secret.
- Local physical interlocks and certified safety circuits remain authoritative; software cannot bypass them.
- Relay outputs are always returned to the safe inactive state (`try/finally`, startup inactive claim, shutdown cleanup).

## Modes and interlocks

Supported modes: `NORMAL`, `LOCKDOWN`, `EVACUATION`, `MAINTENANCE`, `DEMO`.

- `LOCKDOWN` blocks ordinary pulses and webhook automation.
- `MAINTENANCE` blocks webhook automation unless an explicit maintenance path is used.
- Emergency mode changes require administrator role + explicit confirmation + reason.
- Unknown/uncommissioned/unready/stale-heartbeat gates fail closed.

## AuthZ roles

- **viewer**: telemetry/status access.
- **operator**: individual gate pulse requests.
- **administrator**: emergency mode requests.

Roles come from verified bearer tokens configured in environment variables. Role/identity data in message bodies is ignored.

## Endpoints

- `GET /health` / `GET /status`: service status fields (`mode`, `hardwareEnabled`, `simulation`, `gpioAvailable`, `interlocksHealthy`, `lastHeartbeat`, `version`).
- `POST /doors/{1-4}/open`: operator-only gate pulse (empty body, UUID `Idempotency-Key`).
- `POST /api/v1/heartbeat`: operator-only gate readiness heartbeat (`{"gateId":...,"healthy":true|false}`).
- `POST /api/v1/compass-webhook`: signed webhook path (HMAC SHA-256, timestamp and replay/debounce checks).
- `GET /ws/telemetry`: websocket telemetry channel with authenticated command enforcement.

### WebSocket command contract

Authenticate using an HTTP bearer token header (`Authorization` with a configured viewer/operator/administrator token). If `DOOR_ALLOW_ANON_TELEMETRY=true`, anonymous clients may connect but are telemetry-only and cannot issue commands.
When `DOOR_ALLOWED_ORIGINS` is configured, websocket `Origin` must exactly match one configured origin (scheme + host + optional port, no path).

Accepted websocket command payloads:

- `{"command":"PULSE_GATE","requestId":"<uuid>","gateId":<int|string>,"maintenancePath":true|false}` (operator+)
- `{"command":"SET_MODE","requestId":"<uuid>","mode":"NORMAL|LOCKDOWN|EVACUATION|MAINTENANCE|DEMO","confirm":true,"reason":"..."}` (administrator; confirmation + reason required for emergency/maintenance modes)

## Webhook authentication

Headers:

- `X-Compass-Timestamp`: unix timestamp
- `X-Compass-Signature`: hex HMAC-SHA256 over `<timestamp>.<raw body>` using `COMPASS_WEBHOOK_SECRET`

The service rejects stale signatures, replays, invalid schemas, unsupported event types, unauthorized events, and interlock/cooldown violations.

## Environment variables

See `config.example`. Important defaults:

- `HARDWARE_ENABLED=0`
- `DOOR_MODE=DEMO`
- `DOOR_PULSE_MS=500` (bounded 300..800)
- `DOOR_COOLDOWN_MS=1000` (bounded 100..60000)
- `DOOR_ACTIVE_LOW=true` (configure to match wiring)

### Hardware enablement checklist

1. Keep `HARDWARE_ENABLED=0` until wiring/interlocks are commissioned.
2. Verify active-high/active-low relay logic and safe inactive level.
3. Configure operator/admin tokens and webhook secret (32+ ASCII chars).
4. Configure commissioned gates and heartbeat source.
5. Set `HARDWARE_ENABLED=1` and restart.

## Run in simulation

```bash
cd pi-door-service
export DOOR_OPERATOR_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
python3 door_service.py
```

## Tests

```bash
python3 -m unittest discover -s pi-door-service/tests -v
```

Tests cover simulation defaults, authz, gate/mode validation, interlocks, cooldown/concurrency, fail-safe output reset, webhook hardening, audit redaction, and status output.
