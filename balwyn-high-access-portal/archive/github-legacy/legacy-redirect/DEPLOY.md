# Redirect-only deployment — legacy Balwyn Netlify host

## What this is

Three files that make the site deploy. It publishes a redirect and nothing
else, so the Next.js build that has failed four times never runs.

    netlify.toml      no build command, publish = site, forced 302, headers kept
    site/_redirects   /* -> https://magickeys-balwyn-portal.com/:splat  302!
    site/index.html   fallback page with a meta refresh and a visible link

## Why not fix the build instead

`db/queries.ts` imports eight names from `@/db/schema`. Three exist. Five do
not: `alertVerifications`, `detectionEvents`, `systemEvents`, `gatesConfig`,
`gateSchedules`. VERIFIED against the portal schema, which exports exactly:

    activityLog  authAttempts  automationRules  commandQueue  gateStates
    googleLoginChallenges  microsoftLoginChallenges  operatorTotp
    portalSettings  schedules  systemState  userProfiles

Those five belong to a different data model — one where gates are database rows
rather than a code constant, and where detection and alert-verification events
are persisted. Defining them to satisfy an import would mean inventing a schema,
a migration and a database for a host that only needs to forward old links.

## Two consequences to accept before deploying

**1. The forced redirect takes `remote-open` offline.** The `!` on the rule, and
`force = true` in the TOML, make it win over `/.netlify/functions/*`. No
functions directory is declared here either, so the function is not deployed at
all. That is the intended direction, but the invocation log has still never been
checked. If something out there calls that endpoint, it stops working the moment
this publishes, and the symptom will not point here.

To keep the endpoint alive instead: drop the `!` from `_redirects`, set
`force = false`, and add back `functionsDirectory`.

**2. Paths are preserved by `:splat`.** `/login` goes to `/login` on the portal.
Legacy paths with no portal equivalent will land on a portal 404 rather than
somewhere sensible. Acceptable for a retired host; replace `:splat` with nothing
if you would rather send everything to the portal root.

## Before you publish — unrelated to the build, more important than it

That site's environment holds `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_JWT_SECRET`. FROM SOURCE: the resolved config in the build log. A
service_role key bypasses row-level security entirely. It is on a host that
cannot build and is being retired.

Remove those variables from the site and rotate the key, whatever you decide
about the redirect. Netlify's deploy secret scan does not cover environment
variables, so the clean scan result on earlier deploys says nothing about these.

## How to publish from this folder

This package lives at `legacy-redirect/` so the portal's root `netlify.toml`
keeps building the real app.

On the *retired* Netlify site only:
- set Base directory to `legacy-redirect`
- publish directory `site`
- build command empty

## Verification status

VERIFIED here: `netlify.toml` parses as valid TOML with the intended values;
`index.html` parses; the `_redirects` rule is well formed. The portal schema
export list above was read from `db/schema.ts`.

UNVERIFIED: not deployed. Success looks like the build finishing in seconds with
"no functions deployed", and the legacy host answering 302 to the portal.
Failure looks like `@netlify/plugin-nextjs` loading anyway because `next` is
still in the repository's dependencies — if that happens, the fix is to deploy
this directory directly rather than as a repository build, which is what the
agent's own preview did successfully in seven seconds.
