# Microsoft sign-in for the Magic Keys portal (the "Azure list")

Written 8 Oct 2026 from the portal code at HEAD 60f40dd (`lib/microsoft-signin.ts`,
`lib/auth-settings.ts`, `lib/account-roles.ts`, `lib/portal-auth.ts`).
The Android app signs in through this same page, so once this works on the
website it works in the app.

## How access is decided
- Staff sign in with their own Microsoft work account (school or RJL).
- The portal lets them in ONLY if their Microsoft **tenant ID + object ID** is on
  `MICROSOFT_ALLOWED_ACCOUNTS`. Email addresses are NOT used to approve anyone.
- The list is re-checked on every request: remove someone and they are out
  immediately, on the website and in the app.

## 1. Register the portal with Microsoft (once)
Microsoft Entra admin center > App registrations > New registration
- Name: `Magic Keys – Balwyn`
- Supported account types: **Accounts in any organizational directory (multitenant)**
  (needed because school staff accounts live in the school's directory, not RJL's)
- Redirect URI, platform **Web**:
  `https://magickeys-balwyn-portal.com/api/auth/microsoft/callback`
  (add `https://azure.magickeys-balwyn-portal.com/api/auth/microsoft/callback` too
  if you use the test address from MIGRATION.md step 7)

Then:
- Overview > Application (client) ID → `MICROSOFT_OAUTH_CLIENT_ID`
- Certificates & secrets > New client secret → copy the **Value** →
  `MICROSOFT_OAUTH_CLIENT_SECRET`. Note the expiry date; sign-in stops when it expires.

## 2. The approved list
`MICROSOFT_ALLOWED_ACCOUNTS` = comma-separated entries, one per person:

    <tenant-id>:<object-id>|operator,<tenant-id>:<object-id>|viewer

- `operator` can open gates. `viewer` can look but not open.
- **Always put the role.** An entry with no `|role` is treated as ADMINISTRATOR
  (`configuredRole()` keeps that for old entries).
- Both IDs are the long `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` codes.

Where the IDs come from:
- People in RJL's own Microsoft tenant: Entra > Users > the person > Object ID;
  tenant ID is on Entra > Overview.
- School staff: the IDs are in the school's directory, which RJL cannot see.
  The school's IT can read them, or the portal can be changed to show a refused
  person their own code to send to RJL (not built yet).

## 3. Settings that can block approved staff
- `PORTAL_ALLOWED_EMAILS`: if this is set, a Microsoft user's email must ALSO be on
  it, or they are refused. Leave it empty, or add every staff email.
- The school's Microsoft tenant may not let staff approve a new app themselves.
  If they see "Need admin approval", the school's IT has to approve
  "Magic Keys – Balwyn" once. (Not tested — depends on the school's settings.)

## 4. Making Microsoft the only sign-in
- Leave `GOOGLE_OAUTH_CLIENT_ID` empty on the host: the Google button disappears.
  Google sign-in also cannot work inside the Android app (Google blocks it).
- Recommended: keep RJL's own operator email login (`PORTAL_USERNAME` + password
  hash) as a backup way in, in case Microsoft sign-in is misconfigured.

## 5. Where these go
Same place as every other portal setting: Render > Environment today; Azure >
App Service > Environment variables after the move (`deploy/azure/app-settings.md`).
Changing them needs a restart of the service.
