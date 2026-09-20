# Balwyn portal Netlify migration

The production destination is `fencemate2026-pixel/balwyn-high-access-portal`, branch `main`, linked to Netlify site `balwyn-high-school-automation-portal` (site ID `1b61e521-449b-43c8-88af-e5ca87aa2bff`). This migration branch is not yet the production deployment.

The runtime source was taken from the working OpenAI-hosted `balwyn-gate-automation` project at commit `f7b245d4529cd346c250d30e5b02d13b8a87b307`. The earlier GitHub tree contained extra Next/PostgreSQL files (`db/queries.ts`, `app/api/system-state/route.ts`) and separate Netlify functions which were absent from that source. Those files caused the unresolved `alertVerifications` import. Earlier GitHub-only source is preserved under `archive/github-legacy/` and in Git history; it is not compiled into this application.

The user approved moving the whole application from Cloudflare D1/R2 to Netlify and Supabase. This is a deliberate migration, not a PostgreSQL table added to the former SQLite runtime.

## Runtime

- Next.js server rendering and API routes, built with `npm run build:netlify`, output `.next`, Node 22. Netlify automatically supplies its Next adapter.
- All database tables live in the separate `balwyn_portal` PostgreSQL schema in Supabase project `aevsfrxqyvtuycufffxk`. Existing `public` tables belong to other applications and must not be modified.
- `supabase/functions/balwyn-portal-db` is a server-only SQL transport. Keep Supabase JWT verification enabled. It additionally requires a service-role JWT for this project, uses parameterized queries, wraps each request in a transaction, and serializes transactions for rate-limit and controller-claim consistency. The database role is `balwyn_app`.
- Profile pictures use the private `balwyn-profile-photos` bucket. Only authenticated portal API routes serve images. Never place the service-role key in a `NEXT_PUBLIC_` variable.
- Outfit Medium headings; Inter body/UI; charcoal text, 1.55 body leading and small-control tracking.

## Completed infrastructure

The schema migration and database Edge Function were deployed. An initial D1 snapshot of 350 records was imported on 20 September 2026; all 89 historical command records were already failed, so no actuation commands were replayed. The initial snapshot contains 168 schedules, 24 historical gate states and one profile. The active gate register in source remains authoritative for the dashboard. No controller commands were issued during verification.

The snapshot contains private operational data and is intentionally absent from Git. Refresh the snapshot at final cutover if the existing portal has changed. Preserve primary keys and reset identity sequences after importing. Do not overwrite a destination that has begun accepting production writes.

## Required before production cutover

1. Enter the existing login configuration securely in Netlify's environment settings. The current host returns masked values, so the migration tools cannot copy them. Preserve the current values for `PORTAL_SESSION_SECRET`, `PORTAL_USERNAME`, `PORTAL_OPERATOR_EMAIL`, `PORTAL_PASSWORD_HASH`, `PORTAL_PASSWORD_SALT`, `PORTAL_SETTINGS_PASSWORD_HASH`, `PORTAL_SETTINGS_PASSWORD_SALT`, `PORTAL_ALLOWED_EMAILS`, `PORTAL_OWNER_EMAIL`, the configured `PORTAL_SECONDARY_*` account fields, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_ALLOWED_EMAILS`. Also copy non-secret role settings. Do not reset passwords or generate replacement secrets as a migration shortcut.
2. For AI assistance, copy `ANTHROPIC_API_KEY`, `AI_PROVIDER`, and `ANTHROPIC_MODEL`. Microsoft login, if enabled later, needs its corresponding OAuth settings and callback URL.
3. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be available to Netlify Functions. The old variable named `SUPABASE_DATABASE_URL` held an HTTPS Supabase API URL, not a PostgreSQL connection string. `SUPABASE_URL` is the explicit replacement.
4. Transfer the existing profile picture from the original R2 bucket into the private Supabase bucket using the same `avatar_key`. The database profile was copied; the original image bytes are not yet transferred.
5. Deploy a protected preview, verify real owner/school login, MFA, settings unlock, AI assistance and profile image. Verify the existing custom domain and OAuth origins/callbacks. Keep the existing portal available until these checks pass.
6. Refresh data if needed, merge into `main`, confirm Netlify builds the root application (no base/package directory pointing at a legacy redirect), and verify the production URL. Change DNS only after a working preview. Retain the old host for rollback until cutover is confirmed.

Hardware credentials were not configured on the original host at inspection. A successful website deploy does not commission the Compass/Pi connection. Configure the approved door service URL/token and gate map separately, and perform an onsite commissioning check before using gate controls.

## Validation

Run `npm ci` followed by `npm test`. The PostgreSQL authentication tests run locally with PGlite against the production schema migration; they do not contact or modify production. Existing Google/Microsoft challenge, MFA, role, profile, settings, controller and Pi tests remain included.

The live Supabase transport was checked for service authorization, anonymous rejection, unrelated-schema denial, atomic rollback and concurrent rate limiting. A temporary photo was uploaded, read, checked for anonymous denial and removed. All temporary test rows were removed.

The former Cloudflare build configuration and migrations are retained under `archive/cloudflare-source/` for reference. They are not the Netlify build target.
