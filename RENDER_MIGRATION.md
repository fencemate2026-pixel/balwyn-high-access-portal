# Balwyn portal Render migration

The production destination is `fencemate2026-pixel/balwyn-high-access-portal`, branch `main`, intended to run as a Render Node web service. The Render workspace/service still needs to be confirmed. The source configuration is prepared; a live Render deployment has not yet been verified.

The runtime source was taken from the working OpenAI-hosted `balwyn-gate-automation` project at commit `f7b245d4529cd346c250d30e5b02d13b8a87b307`. The earlier GitHub tree contained extra Next/PostgreSQL files (`db/queries.ts`, `app/api/system-state/route.ts`) and separate legacy Netlify functions which were absent from that source. Those files caused the unresolved `alertVerifications` import. Earlier GitHub-only source is preserved under `archive/github-legacy/` and in Git history; it is not compiled into this application.

The user changed the deployment target from Netlify to Render. The prepared Supabase backend is independent of the web host and remains the database/storage destination. This is a deliberate migration, not a PostgreSQL table added to the former SQLite runtime.

## Runtime

- Next.js server rendering and API routes, built with `npm run build:render`, output `.next`, Node 22. Build command: `npm ci --include=dev && npm run build:render`. Start command: `npm start`. Next listens on `0.0.0.0` and reads Render's `PORT`. `render.yaml` describes the service. `/api/health` checks process health without accessing the database or controllers.
- All database tables live in the separate `balwyn_portal` PostgreSQL schema in Supabase project `aevsfrxqyvtuycufffxk`. Existing `public` tables belong to other applications and must not be modified.
- `supabase/functions/balwyn-portal-db` is a server-only SQL transport. Keep Supabase JWT verification enabled. It additionally requires a service-role JWT for this project, uses parameterized queries, wraps each request in a transaction, and serializes transactions for rate-limit and controller-claim consistency. The database role is `balwyn_app`.
- Profile pictures use the private `balwyn-profile-photos` bucket. Only authenticated portal API routes serve images. Never place the service-role key in a `NEXT_PUBLIC_` variable.
- Outfit Medium headings; Inter body/UI; charcoal text, 1.55 body leading and small-control tracking.

## Completed infrastructure

The schema migration and database Edge Function were deployed. An initial D1 snapshot of 350 records was imported on 20 September 2026; all 89 historical command records were already failed, so no actuation commands were replayed. The initial snapshot contains 168 schedules, 24 historical gate states and one profile. The active gate register in source remains authoritative for the dashboard. No controller commands were issued during verification.

The snapshot contains private operational data and is intentionally absent from Git. Refresh the snapshot at final cutover if the existing portal has changed. Preserve primary keys and reset identity sequences after importing. Do not overwrite a destination that has begun accepting production writes.

## Required before production cutover

1. Enter the existing login configuration securely in Render's environment settings. The current host returns masked values, so the migration tools cannot copy them. Preserve the current values for `PORTAL_SESSION_SECRET`, `PORTAL_USERNAME`, `PORTAL_OPERATOR_EMAIL`, `PORTAL_PASSWORD_HASH`, `PORTAL_PASSWORD_SALT`, `PORTAL_SETTINGS_PASSWORD_HASH`, `PORTAL_SETTINGS_PASSWORD_SALT`, `PORTAL_ALLOWED_EMAILS`, `PORTAL_OWNER_EMAIL`, the configured `PORTAL_SECONDARY_*` account fields, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_ALLOWED_EMAILS`. Also copy non-secret role settings. Do not reset passwords or generate replacement secrets as a migration shortcut.
2. For AI assistance, copy `ANTHROPIC_API_KEY`, `AI_PROVIDER`, and `ANTHROPIC_MODEL`. Microsoft login, if enabled later, needs its corresponding OAuth settings and callback URL.
3. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be available to the Render web service. The old variable named `SUPABASE_DATABASE_URL` held an HTTPS Supabase API URL, not a PostgreSQL connection string. `SUPABASE_URL` is the explicit replacement.
4. Transfer the existing profile picture from the original R2 bucket into the private Supabase bucket using the same `avatar_key`. The database profile was copied; the original image bytes are not yet transferred.
5. Deploy a staging service, verify real owner/school login, MFA, settings unlock, AI assistance and profile image. Verify the existing custom domain and OAuth origins/callbacks. Keep the existing portal available until these checks pass.
6. Refresh data if needed, confirm the Render configuration is on `main`, confirm Render builds the repository root using `render.yaml`, and verify the production URL. Change DNS only after a working preview. Retain the old host for rollback until cutover is confirmed.

Hardware credentials were not configured on the original host at inspection. A successful website deploy does not commission the Compass/Pi connection. Configure the approved door service URL/token and gate map separately, and perform an onsite commissioning check before using gate controls.

## Validation

Run `npm ci` followed by `npm test`. The PostgreSQL authentication tests run locally with PGlite against the production schema migration; they do not contact or modify production. Existing Google/Microsoft challenge, MFA, role, profile, settings, controller and Pi tests remain included.

The live Supabase transport was checked for service authorization, anonymous rejection, unrelated-schema denial, atomic rollback and concurrent rate limiting. A temporary photo was uploaded, read, checked for anonymous denial and removed. All temporary test rows were removed.

The retired Netlify root configuration is under `archive/netlify-source/`. The former Cloudflare build configuration and migrations are retained under `archive/cloudflare-source/` for reference. They are not the Render build target.

## Render handover

Confirm the existing Render workspace and reuse an existing Balwyn service if present. Set its repository to `https://github.com/fencemate2026-pixel/balwyn-high-access-portal`, use the migration branch for staging and `main` after cutover, and use the build/start commands above. No Netlify deployment is required. The Blueprint defaults a new service to the free plan; confirm a suitable always-on plan before operating the client gate portal. Existing service plans should be preserved.

The earlier Netlify environment contains the Supabase URL/service key; those can be transferred server-side once the Render service is confirmed. The original portal's masked login/AI settings and private profile image remain outstanding. GitHub checks validate the code; a green build alone does not verify real owner login or the hardware connection.
