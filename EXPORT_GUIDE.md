# Balwyn complete project export

This export contains the current OpenAI-hosted portal source, not the older stripped demonstration.

## Included
- `app/`: frontend pages and components plus all server API routes, including the classroom guidance projection imported from the GitHub real-source-from-chatgpt branch.
- `lib/`: authentication, access rules, persistent portal operations, relay gateway, settings validation and helper retrieval.
- `db/` and `drizzle/`: D1 schema and every migration.
- `worker/`, `build/`, `.openai/hosting.json`: Cloudflare Worker build and hosting configuration, with DB and BUCKET bindings.
- `public/`: project images, logos, video and other static assets.
- `controller-agent/`: the sensor-equipped controller agent, configuration example and tests.
- `pi-door-service/`: Compass relay HTTP service, systemd unit, installation guide and tests.
- `data/balwyn_site.json`: the original supplied school outdoor site layer.
- `data/software-knowledge.json` and `SOFTWARE_HELP.md`: software helper knowledge and current feature guide.
- `scripts/`, `tests/`, `package.json`, `package-lock.json`: installation, build, verification and pinned dependencies.
- The downloadable ZIP additionally includes `deployment/site-deployment.tar`, containing the production Worker and compiled frontend for this source revision.

## Running and deploying
Use Node.js 22.13+ and a Linux environment with npm, curl, flock and GNU timeout. Run `npm run install:ci`, then `npm run dev` or `npm run build`. See README.md and LOGIN_AND_ADMIN_SETUP.md for the application and identity setup. Use the existing Sites project identity rather than creating a replacement. Preserve DB and BUCKET bindings when publishing.

Rebuild the helper index after editing its guides: `node scripts/build-help-index.mjs`. The included index is generated from seven project guides, not model training.

## Runtime services and data
The source archive is not a backup of production D1 records, R2 user uploads, accounts, sessions or secret values. The project has password and Google authentication runtime configuration. At export time the hosting configuration did not list DOOR_SERVICE_URL, DOOR_SERVICE_TOKEN, DOOR_GATE_MAP or OPENAI_API_KEY. The owner confirmed that no Pi is deployed yet: the reachable HTTPS origin and verified gate-to-relay assignment must be established before configuration. Generate the shared service token securely at deployment time and enter it into the Pi and hosting secrets without exposing it in chat or Git. These integrations require deployment and configuration before live use. No physical gate was actuated during verification.

AI answers use a server-side OPENAI_API_KEY and optional OPENAI_MODEL. Without a key the helper searches and displays real guide passages, clearly labelled as knowledge-base results. Provider responses have not been exercised with a live key.

The portal's equipment settings are password-protected and saved in D1. Relay pin/polarity/pulse settings are exported for local installation and do not remotely reconfigure an existing Pi. The included service now accepts 300–10,000 ms pulses while keeping the 500 ms default. No onsite software was changed by this portal deployment.

The school site layer is an advisory reference. It preserves the supplied source, approximate distances, missing accessibility/interior detail and approval limitations. It does not drive emergency gate actions or projector broadcasts.

## Validation for this update
- TypeScript type check and production build passed.
- Eleven portal remote-open tests, including a real six-second simulated response, passed.
- Eleven isolated Pi tests passed; no hardware outputs were used.
- Equipment validation, source-map paths and blocked-path behaviour, and knowledge retrieval tests passed.
- Browser component preview checked the settings, route exclusion and knowledge fallback using local fixtures. Authenticated production interactions and physical equipment commissioning were not performed.

PR #10 on fencemate2026-pixel/balwyn-high-access-portal was already merged and closed when inspected. This update did not merge or revert it.

## Help agent and permissions update
The help agent includes follow-up chat, current-page context, source passages and the complete current portal guide. Its hosted knowledge index rebuilds with the app. AI replies still require a securely configured OPENAI_API_KEY; the included guide mode works without it. Live-provider operation has not been verified without that connection. The permission model supports per-account viewer/operator/administrator assignments across Google, Microsoft and password sign-in. Legacy accounts retain administrator access until explicitly reassigned.

The dashboard now labels heartbeats as controller reporting, separate from witnessed onsite commissioning. The two obsolete public aerial/concept assets have been removed; the screen illustration uses a generic diagram. /brand is noindex and omitted from the sitemap. Controller setup uses the custom portal domain.
