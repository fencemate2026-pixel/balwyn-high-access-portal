# Public MagicKeys client entry

The generic form at https://www.magickeys.com.au/client-login/ sends a native HTTPS form POST directly to this portal's `/api/auth/client-entry` endpoint. Only exact MagicKeys and portal origins are accepted. Body size and fields are bounded; credentials never enter a URL, browser storage, analytics or adapter logs.

The adapter calls the existing password sign-in handler, preserving credential verification, account eligibility, IP/account rate limits, audit logging, role permissions and mandatory operator/administrator TOTP. It issues the existing secure HttpOnly cookies on the portal domain. No wildcard CORS or cross-domain session cookies are introduced.

Operators resume their browser-bound, credential-version-checked MFA challenge through a same-origin POST to `/api/auth/client-entry/state`. First-time authenticator enrollment remains supported. View-only accounts retain their existing password-only behavior. The existing direct portal sign-in continues to work.

This installation currently owns one customer workspace. It verifies only this installation's approved accounts. This is not a multi-tenant account directory: onboarding another workspace requires a trusted directory mapping an authenticated identity to its approved destination, plus a secure session handoff. Do not route unknown accounts to arbitrary URLs, accept destinations from form fields, or spray submitted passwords across multiple portals.

Validation: `node --test tests/client-entry.test.mjs` covers origin rejection, oversized/ambiguous input, credential encoding, rate-limit/error redirects, MFA continuation and secure cookie transfer. Existing portal session/account tests and the production build remain required in CI.
