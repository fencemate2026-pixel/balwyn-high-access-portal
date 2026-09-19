# Magic Keys login, administrator settings and profiles

The production entry is https://magickeys-balwyn-portal.com/login.

## Sign-in methods

- **Google:** retains the configured Google Identity Services connection, signed-token validation, browser-bound nonce and single-use challenge. `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_ALLOWED_EMAILS` and `PORTAL_SESSION_SECRET` remain the runtime settings.
- **Email/password:** existing configured operator credentials work with either the account's email or username. A six-digit authenticator code is required before a portal session is created. On first use, the operator enters the displayed time-based setup key into an authenticator app. Password attempts and authenticator attempts are rate limited in D1.
- **Microsoft / Hotmail:** the complete OAuth authorisation-code flow is implemented with PKCE, state, nonce, signature/issuer/audience validation, a browser-bound cookie and single-use D1 challenge. It remains unavailable until the Microsoft registration and approved account IDs below are configured.

Google and Microsoft never ask users to enter their provider password into Magic Keys. The email/password form takes the operator's separately configured portal password.

## Google `origin_mismatch`

Google Identity Services checks the website's origin against the existing web
OAuth client's **Authorised JavaScript origins** in Google Cloud. For production,
add this exact value to the client referenced by `GOOGLE_OAUTH_CLIENT_ID`:

`https://magickeys-balwyn-portal.com`

Use **Google Auth Platform → Clients → the existing Web application client**.
This setting takes the scheme and hostname only: no `/login` path or trailing
slash. Adding the domain to Branding or changing the consent-screen home page
does not register a JavaScript origin. Preserve any other required origins.

The login screen sends visitors using an alternate Sites address to the
production portal before starting Google Identity Services. This avoids starting
Google from an unregistered alias, but cannot register the production origin in
Google Cloud. The existing JavaScript callback does not require a new redirect
URI or a replacement client secret.

The authenticated owner's `/api/auth/google/config` response identifies the
configured public client ID, expected origin and login URL. Match that client
ID in Google Cloud; do not create a different client or change token validation
to work around an origin error. After saving the Google setting, retry Google
sign-in on the production login page with an approved operator account. Google
configuration and successful production sign-in have not been verified by local
tests.

Reference: [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Connect Microsoft / Hotmail

1. Register an application in Microsoft Entra for **accounts in any organisational directory and personal Microsoft accounts**. Personal accounts include Hotmail and Outlook.
2. Add a **Web** redirect URI exactly matching:
   `https://magickeys-balwyn-portal.com/api/auth/microsoft/callback`
3. Configure these server-side Sites runtime secrets:
   - `MICROSOFT_OAUTH_CLIENT_ID`: the application/client ID.
   - `MICROSOFT_OAUTH_CLIENT_SECRET`: the client secret value.
   - `MICROSOFT_ALLOWED_ACCOUNTS`: comma-separated `tenant-id:object-id` pairs for authorised administrators, from the issuing directory/account identity. Include the personal-account tenant ID for personal accounts.
4. Keep the existing session secret. Deploy the saved source against the new runtime environment revision. The Microsoft button enables when the full configuration is present.
5. Complete a real sign-in with each approved account as an acceptance check. Automated tests use locally generated test signing keys; they do not verify production provider credentials or tenant consent.

Microsoft email and preferred-username claims are mutable, so they are used for display only. Approval uses the immutable tenant/object pair. Reference: [Microsoft ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference) and [Microsoft authorisation code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## Operator email accounts

Existing account configuration:

- `PORTAL_USERNAME`, `PORTAL_OPERATOR_EMAIL`, `PORTAL_PASSWORD_SALT`, `PORTAL_PASSWORD_HASH`.
- The existing `PORTAL_SECONDARY_USERNAME`, `PORTAL_SECONDARY_OPERATOR_EMAIL`, `PORTAL_SECONDARY_PASSWORD_SALT` and `PORTAL_SECONDARY_PASSWORD_HASH` support the second configured administrator.

Any custom-domain email can be assigned to a configured operator account. Knowing an email address does not grant access. There is no public self-registration or automatic administrator assignment to new email addresses.

For a password account, the profile's portal username can also be used at sign-in. Editing profile contact details does not change OAuth approval or the configured sign-in email. Password resets are performed by the administrator through the runtime credential configuration; no email delivery service is currently configured.

Passwords use the existing three-stage PBKDF2-SHA256 format, with 100,000 iterations per stage. A changed or removed password credential invalidates password sessions and pending authenticator challenges.

## Administrator password protection

An administrator must verify a password before opening System settings, Operating schedules or Automation rules, issuing/rotating controller credentials, clearing authentication lockouts, or editing other users' profiles/photos. The API enforces these checks independently of the interface.

The unlock lasts ten minutes, is bound to the current signed-in session, and is cleared on sign-out. **Lock settings** closes it immediately in the current browser. A changed administrator password invalidates existing unlock cookies. Verification is rate limited and successful unlocks are recorded in the activity log.

The existing configured administrator passwords work initially. To require a separate settings password, set both `PORTAL_SETTINGS_PASSWORD_SALT` and `PORTAL_SETTINGS_PASSWORD_HASH` using the same PBKDF2 format. If only one is set, unlocking fails closed. Never put these values into browser code, Git, setup downloads or this document.

The password check protects configuration. Existing operator commands and emergency response retain their established role, confirmation, controller and safety checks. The interface does not remotely rewrite physical GPIO wiring or bypass onsite commissioning.

## Profiles and photos

Open **User access → Your profile** to edit the display name, portal username, contact email, telephone and job title. Photos accept PNG, JPEG or WebP up to 3 MB. Removing a photo takes effect when the profile is saved.

Administrators choose **Manage users**, verify their password, and select another profile. Profiles appear after their first sign-in. Profile fields never change authorisation roles or link unrelated OAuth identities. Session account keys remain separate from mutable display details.

Profiles are stored in D1. Images are stored in the `BUCKET` R2 binding and served through an authenticated, non-cacheable image route. Secrets and raw provider tokens are never included in profile records.

## Deployment and validation

### Advanced plan demonstrations

Core-plan visitors can explore CCTV and fictional camera zones, fire/security
guidance examples and a classroom-screen preview. These are client-only
demonstrations: their controls have no operational API calls, broadcast, relay,
analytics, live footage or real campus data. The demo screen and maps are
labelled as examples. They do not grant plan entitlements or settings access.

Upgrade enquiry buttons open the existing proposal sheet. Its email link prepares
a demonstration and proposal request for the administrator to review and send.
No message, purchase or plan activation occurs automatically. The live plan is
still controlled by `PORTAL_PLAN` on the server, and commissioning remains separate.

### Hosting

The existing Sites Worker, D1 `DB` binding and project identity are retained. R2 `BUCKET` is added for profile photos. Append-only migrations `0005` and `0006` create Microsoft challenges and user profiles; existing tables/data are preserved.

Automated checks cover Google/Microsoft token validation, callback replay, password and authenticator verification, configuration lock bypass, session expiry/revocation, profile ownership, duplicate usernames, uploaded file types and authenticated image delivery. Live provider sign-in and photo storage should also be checked with the configured production account.

## Per-account access roles
Google entries in `GOOGLE_ALLOWED_EMAILS` accept `email|role`, separated by commas, for example `viewer@example.test|viewer,operator@example.test|operator,admin@example.test|administrator`. Microsoft entries in `MICROSOFT_ALLOWED_ACCOUNTS` accept `tenant-id:object-id|role`; identifiers must still be valid UUIDs. The only accepted roles are `viewer`, `operator`, and `administrator`. Invalid entries and duplicate identities fail closed.

Password account roles use `PORTAL_ROLE` and `PORTAL_SECONDARY_ROLE`. Existing unannotated OAuth entries and unset password roles retain their previous administrator access for compatibility. Configure explicit roles for school staff; existing accounts have not been silently downgraded. Role changes are checked on every request and invalidate sessions with an old role. Pending password MFA also rechecks the assigned role. Lower-privilege password accounts cannot supply the fallback administrator unlock password.

Use https://magickeys-balwyn-portal.com as the canonical portal and controller origin. The hosting provider's deployment address is not the school-facing setup address.

## Owner and site-wide sign-in restriction
`PORTAL_ALLOWED_EMAILS` is an optional comma-separated exact email restriction applied in addition to provider approval. When configured, non-listed Google, Microsoft and password identities are rejected, including existing sessions. Password account aliases do not bypass the bound account email check. `PORTAL_OWNER_EMAIL` identifies the full-access owner for verified Google/password identities; Microsoft display-email hints cannot grant owner status. Google approval and account roles still apply. The owner's advanced access is account-specific and does not upgrade other users. Keep the separate administrator settings password and MFA requirements.
