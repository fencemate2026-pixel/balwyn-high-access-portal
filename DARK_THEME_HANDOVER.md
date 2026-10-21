# Balwyn portal — Tailwind dark / 3D update

This update targets the existing Next.js portal and Azure App Service container. The existing Azure workflow now deploys main-branch pushes after its build and regression checks pass. Manual deployment remains available. Check the GitHub Actions result before treating an update as live.

## Run

Use the project's existing environment configuration and database. No replacement credentials are included.

```sh
npm ci
```

```sh
npm run dev
```

For production, run `npm run build`, then `npm start`. Node 22.13 or newer is required by the existing project.

## Design and implementation

- Tailwind CSS v4 drives the new calendar, weather and hardware cards. Shared CSS variables and Tailwind tokens are in `app/control-room.css` and `app/globals.css`.
- Deep navy page and raised dark cards with a contrasting pale slate sidebar, navy outline navigation, blue controls, green online indicators and amber commissioning states.
- Three.js models render single swing, double swing and boom gates with metallic materials, bevels, studio lighting and shadows. The model type follows the gate register; the two installed Balwyn entries remain single swing gates.
- Physical position feedback drives open/closed changes. Unknown, stale, offline, uncommissioned or pending states do not become confirmed positions. The hardware view is illustrative, not an engineering drawing or camera feed.
- The rendering module loads when visible, pauses offscreen and in background tabs, disposes GPU resources on unmount, and respects reduced motion. Original local artwork remains as an explicitly labelled fallback if WebGL is unavailable.
- Temperature shows a dash and “No sensor fitted” until supplied. Heartbeat is controller report age in seconds, never a fabricated BPM value. The existing snapshot has no temperature field, so no live temperature integration is claimed.
- The campus calendar and seven-day Balwyn forecast are React components shared across signed-in views. They use `/api/hire` and `/api/weather`; booking saves refresh the shared calendar. Failed requests display an unavailable state. Calendar arithmetic preserves Melbourne dates across daylight-saving transitions.
- Facility hire is a native navigation view. The legacy DOM cloning, injected status markup and missing `week-board` dependency have been removed from the active workflow.
- Existing transparent Magic Keys, Balwyn and RJL artwork is used without white backplates. The sidebar preserves the original Magic Keys colours, RJL retains its red artwork, and the Balwyn crest uses a light treatment on dark surfaces. Original image files are preserved. Profile photos use the existing authenticated profile API; initials are used when no photo exists.
- The provided automatic-gate caution artwork appears in gate details.
- Sign-in, role checks, administrator unlock, relay endpoints and emergency confirmation remain part of the existing application. Browser verification used local response fixtures and did not issue live hardware commands.

## Primary files

| File | Purpose |
| --- | --- |
| `app/control-room.css` | Palette variables, Tailwind component styles, existing-view dark styling and responsive rules |
| `app/globals.css` | Tailwind v4 imports and semantic colour/shadow utilities |
| `app/gate-condition-panel.tsx` | Hardware cards and honest telemetry readouts |
| `app/gate-tile.tsx` | Lazy-loaded model and non-WebGL fallback |
| `app/gate-scene.ts` | 3D lighting, materials, gate geometry and lifecycle |
| `app/campus-calendar.tsx` | Shared booking week and selected-day details |
| `app/campus-weather.tsx` | Current Balwyn weather and seven-day outlook |
| `app/dashboard-client.tsx` | Dashboard integration and native facility-hire navigation |
| `app/facility-hire-panel.tsx` | Existing booking form/month view with dark styling and viewer handling |

## Palette

```css
:root {
  --bg-page: #0b131e;
  --bg-sidebar: #dce5ef;
  --bg-card: #121e2c;
  --bg-card-raised: #182738;
  --bg-card-hover: #1c2e42;
  --text-primary: #eef4fc;
  --text-secondary: #a4b4c8;
  --text-muted: #7e91a8;
  --border-subtle: #26374b;
  --accent-green: #42e8a4;
  --accent-blue: #55acff;
  --status-warning: #f5bd64;
  --status-error: #ff727f;
  --glow-green: 0 0 12px #42e8a466, 0 0 28px #42e8a422;
  --glow-blue: 0 0 12px #55acff66, 0 0 28px #55acff22;
  --shadow-card: 0 16px 40px #00000033, inset 0 1px 0 #ffffff08;
}
```

Examples: `bg-card`, `text-accent-blue`, `border-border`, `shadow-card`, `shadow-glow-green`, `motion-reduce:transition-none`.

## Blue hardware cards

The only hardware types shown are single swing, boom and double swing gates. The three matching blue studio renders are in `public/gates/*-blue.webp`, used on the public entry page and as the hardware fallback when WebGL is unavailable. They were generated with the built-in image tool and encoded as high-quality WebP for delivery. The gate register and verified physical position feedback remain authoritative.

Prompt set: photorealistic single swing, vehicle boom and double swing security gates; brushed metal, realistic construction, glowing blue reader, deep navy background, 4:3 product-card composition, no labels or logos.

The Three.js renderer lifecycle follows the official documentation: https://threejs.org/docs/pages/WebGLRenderer.html.

## Verification

Production build and TypeScript compilation passed. All 75 Node regression checks and 14 Python controller/door-service checks passed, covering UI rendering, honest controller states, commissioning safeguards, existing remote-open policy, date-range handling, Melbourne date arithmetic, role checks, profile persistence and authenticated photo handling. Final desktop and mobile browser checks confirmed the pale sidebar, transparent logo backgrounds and readable branding without JavaScript errors.

Preview screenshots use a local fixture for example weather and empty bookings, with uncommissioned gate readings. They are design previews, not a live status report. Live deployment, real identity-provider sign-in, actual weather delivery, database connectivity and physical hardware have not been tested against the school's production environment.

Final browser checks passed at 1600 px and 390 px with no JavaScript errors and no document-level horizontal overflow. Gate drawers and settings surfaces were checked for the dark theme. Standard control buttons were disabled before commissioning; separate local fixtures showed confirmed open/closed positions. Calendar and weather failure states were exercised.
