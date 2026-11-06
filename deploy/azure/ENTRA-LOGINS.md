# Azure-managed logins (branch `azure-logins`, 6 Nov 2026)

Azure signs people in. The portal then checks its own approval lists and starts its normal session. Supabase data is untouched (logins only).

| Who | Azure provider | Portal approval | Portal view |
|---|---|---|---|
| Owner / administrators | Google (existing Easy Auth entry, client "Magic Keys Portal 1") | `GOOGLE_ALLOWED_EMAILS`, role from that list; owner = `PORTAL_OWNER_EMAIL` | Owner view as today |
| Staff | Microsoft Entra External ID (email + password), custom OpenID Connect entry | Active per-person account, **view-only** | Standard portal only, never owner |

Operators/administrators who are not the owner keep the existing email + password + authenticator login.

## Nothing changes until step 7
The code is inert unless `PORTAL_AZURE_AUTH=on`. Old logins keep working throughout.

## Steps (you, in the consoles)
1. **Google client "Magic Keys Portal 1"**: add redirect URI `https://www.magickeys-balwyn-portal.com/.auth/login/google/callback` and JavaScript origin `https://www.magickeys-balwyn-portal.com` (or redirect www to the apex). Confirm the azurewebsites.net redirect URI is complete.
2. **Test Google through Azure**: open `/.auth/login/google`, sign in, then open `/.auth/me`. It should show your email. Do not paste that page anywhere (it holds tokens).
3. **Entra External ID**: create an external tenant; add a sign-in user flow with *Email with password*; turn **self-service sign-up off**; create/invite each staff member. Turn on MFA only if it supports what you want (authenticator-app support: UNVERIFIED, check in the tenant).
4. **Register an app** in that tenant. Redirect URI: `https://magickeys-balwyn-portal.com/.auth/login/<NAME>/callback` (NAME = the provider name you choose in step 5, e.g. `staffid`). Create a client secret.
5. **App Service > Authentication > Add provider > OpenID Connect**: name `<NAME>`; metadata URL `https://<tenant>.ciamlogin.com/<tenant-id>/v2.0/.well-known/openid-configuration` (format from memory: UNVERIFIED, copy the exact URL from the app's Endpoints page); scopes `openid profile email`. Keep **Allow unauthenticated access** (the portal handles its own login).
6. **App settings**: `AZURE_STAFF_IDP=<NAME>`; make sure `GOOGLE_ALLOWED_EMAILS` has your Google email as `|administrator` and `PORTAL_OWNER_EMAIL` is the same email.
7. **Turn on**: set `PORTAL_AZURE_AUTH=on` last. Two buttons appear on the login page. Test the owner button, then one staff account.
8. **Re-invite staff**: Access & users > Sign-in: *Azure email and password (no link)*. Role is view-only. Disabling the account ends their session on the next request.

## Rollback
Set `PORTAL_AZURE_AUTH` to anything but `on` (or delete it). Buttons vanish and every Azure session stops working at once. Nothing else to undo. No database migration is part of this change.

## Safety properties (tested, `tests/azure-signin.test.mjs`)
- Off by default; missing, garbage or stale (>3 min old) Azure headers are refused.
- Google must state the email is verified.
- Only provider `google` or `AZURE_STAFF_IDP` is accepted; any other tenant is refused.
- Staff provider can never be owner, operator or administrator; the owner email is refused on the staff route.
- Logout also clears the Azure session cookie.

## Evidence
- VERIFIED (tests run): 273/273 tests, `tsc --noEmit`, `next build`.
- UNVERIFIED until step 2/7: the exact claim names Azure sends (`email`, `email_verified`, `iat`), the `AppServiceAuthSession` cookie name, the External ID metadata URL. If sign-in is denied, the server log shows `azure_signin_denied` with a reason code (`no_email`, `no_issue_time`, ...), which says which claim to adjust.
