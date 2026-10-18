# Balwyn High School — Magic Keys handover status

This portal is ready for **operator demonstration and commissioning**, not for unattended life-safety control.

## Implemented software (verify the deployed version)

- Google sign-in and portal database
- Dashboard, gates, schedules, activity log, administrator lock
- Fire evacuation **OPEN command packets only**, queued for `ACTIVE_GATES` (no motor move until a commissioned controller collects them)
- `resolveEmergencyCommand("lockdown")` throws; no lockdown control or lockdown-close voice is supported
- Compass `POST /doors/{1-4}/open` remains a separate open-only pulse contract; `pulsed` and `dry_run` both report position `unknown`
- Help chat / Foundry is Q&A only and must not receive hardware-operation tools
- Red fire strobe on the evacuation panel
- Amber gate lamps when a live gate is not in order
- Facility hire **directory** at `/api/hire` and `app/facility-hire-panel.tsx`

## Not live until onsite commissioning

- Tony Frizza and Side Entry motors and limit inputs
- Confirmed open/closed lamps (green/red)
- CCTV, PTZ, projector broadcasts
- Hire visit run sheet (needs `hire_*` tables applied in `balwyn_portal`)

## Current gate controller

`gate-controller/` (Locinox Venus + KS0212 relay boards, `balwyn-gate@.service`)
is the current controller for Tony Frizza and Side Entry and supersedes both
`controller-agent/` and `pi-door-service/` once each gate is commissioned onto
it (`gate-controller/README.md`). Until that commissioning is complete,
`pi-door-service`'s Compass ACB-004 open-only path (referenced above) is still
the live path for the doors it covers.

## School checklist before relying on the portal

1. Confirm Azure App Service `magickeys-balwyn-portal` uses `magickeysbalwyn.azurecr.io/magickeys-portal:<git-sha>` built from the reviewed commit, and that the app has restarted successfully. A GitHub merge alone is not an Azure deployment.
2. Confirm `PORTAL_SETTINGS_PASSWORD_HASH` and `PORTAL_SETTINGS_PASSWORD_SALT` in Azure App Service server-side settings.
3. Keep Gate voice **On** for fire wording.
4. Do not treat uncommissioned gates as physically open or closed.
5. Local safety circuits and the school Emergency Management Plan remain authoritative.

## Safety and deployment boundaries

Tests and the server policy/API code take precedence over this document. The current active gate IDs are `TF-ENTRY` and `SIDE-ENTRY`; the other seven remain inactive. Assign at most four unique REX channels explicitly from verified wiring, never from register order. Keep `DOOR_SERVICE_TOKEN`, `DOOR_API_TOKEN` and `FOUNDRY_API_KEY` server-side and out of `NEXT_PUBLIC_*` and client code.

Only one service may own a relay board. Do not run `pi-door-service` and `balwyn-gate` against the same outputs. Retaining source or mock contract tests does not authorise a second live process. Commissioning and the current field process must be verified onsite; this document is not proof of physical operation.
