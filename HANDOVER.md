# Balwyn High School — Magic Keys handover status

This portal is ready for **operator demonstration and commissioning**, not for unattended life-safety control.

## Live this week

- Google sign-in and portal database
- Dashboard, gates, schedules, activity log, administrator lock
- Fire / lockdown **command packets only** (no motor move until a commissioned controller collects them)
- Red fire strobe on the evacuation panel
- Amber gate lamps when a live gate is not in order
- Facility hire **directory** at `/api/hire` and `app/facility-hire-panel.tsx`

## Not live until onsite commissioning

- Tony Frizza and Side Entry motors and limit inputs
- Confirmed open/closed lamps (green/red)
- CCTV, PTZ, projector broadcasts
- Hire visit run sheet (needs `hire_*` tables applied in `balwyn_portal`)

## School checklist before relying on the portal

1. Confirm Render is on latest `main` and build is Live.
2. Confirm `PORTAL_SETTINGS_PASSWORD_HASH` and `PORTAL_SETTINGS_PASSWORD_SALT` on Render.
3. Keep Gate voice **On** for fire wording.
4. Do not treat uncommissioned gates as physically open or closed.
5. Local safety circuits and the school Emergency Management Plan remain authoritative.
