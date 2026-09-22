# Magic Keys 3D Access Control Portal Architecture

The portal is split into a Vite + React frontend and an Express backend under `src/`.

- `src/frontend`: operator UI, 3D campus scene, live gate tiles, weather overlay, emergency controls, reports, and settings.
- `src/backend`: REST API, controller bridge, scheduler helpers, AI insight generation, and PostgreSQL-ready state service.
- `src/shared`: shared contracts and branding constants used by both client and server.
- `database/`: SQL schema and sample data for the `balwyn_portal` PostgreSQL schema.

## Runtime flow

1. The Vite client boots from `index.html` and renders `src/frontend/main.tsx`.
2. `App.tsx` loads a portal snapshot from `/api/v1/*` and falls back to local simulation when the backend is unavailable.
3. The 3D scene uses Three.js and `three-stdlib` orbit controls to visualise buildings, gates, lighting, weather, and emergency beacons.
4. The Express API exposes gate control, access policies, schedules, AI insights, and facility hire endpoints.
5. `hardwareComm.ts` formats relay bridge commands for a Raspberry Pi adapter servicing the ACB-004 contact workflow.
6. `database.ts` keeps an in-memory development store with an optional `postgres` connection when `DATABASE_URL` is present.

## Development scripts

- `npm run dev:portal` - Vite frontend
- `npm run dev:api` - Express backend on port `4010`
- `npm run build:portal` - production frontend build
- `npm run typecheck:portal` - TypeScript validation for the new portal code
