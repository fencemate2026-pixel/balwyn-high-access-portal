# Connect the portal to the Balwyn Pi

The live path is:

```
Magic Keys UI
  → /.netlify/functions/remote-open
  → HTTPS POST /doors/{1-4}/open
  → /opt/balwyn-gate  (repo: fencemate2026-pixel/balwyn-gate)
  → isolated relay pulse into Compass ACB-004 REX
```

## 1. Pi

Install https://github.com/fencemate2026-pixel/balwyn-gate on the controller.
Start in `DOOR_MODE=mock`. Bind `127.0.0.1:8080`. Put Cloudflare Tunnel or the
school TLS proxy in front. Do not publish the Pi port raw.

`DOOR_API_TOKEN` on the Pi must equal Netlify `DOOR_SERVICE_TOKEN`.

## 2. Netlify function env (not NEXT_PUBLIC_)

Site: `balwyn-high-school-automation-portal`

| Key | Example |
|---|---|
| `DOOR_SERVICE_URL` | `https://doors.example` (origin only, https, no path) |
| `DOOR_SERVICE_TOKEN` | same 32+ char token as the Pi |
| `DOOR_OPERATOR_TOKEN` | a *different* 32+ char token |
| `DOOR_GATE_MAP` | `{"TF-ENTRY":1,"SIDE-ENTRY":2}` |

`SIDE-ENTRY` is a valid map key on this branch.

## 3. What still stays simulated

Dashboard colours, lockdown, fire, schedules and voice remain demonstration
state until sensors exist. A successful pulse does **not** turn a gate card green.
Position is `unknown`. That is correct.

## 4. Hardware

`DOOR_MODE=hardware` only after commissioning sheet B3/B4. GPIO is a dry
contact across the ACB request-to-exit input. Never share lock-supply COM with
Roger 32 COM / 34 AP.
