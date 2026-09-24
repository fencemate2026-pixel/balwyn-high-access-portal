# Moving the Magic Keys portal from Render to Azure (Australia East)

Goal: the same portal, same domain, same database, running in Sydney beside the
database. Users notice nothing except speed. Render stays running until the
Azure copy is proven, so rollback is a DNS change.

## What does NOT move
- The database (Supabase, Sydney) — unchanged; Azure connects to the same one.
- The domain `magickeys-balwyn-portal.com` — stays on Cloudflare; only its
  target changes. Google and Microsoft sign-in are tied to the domain, so they
  keep working with no provider changes.
- Gate controllers — they call the domain, so they follow the DNS change.

## Before cutover
1. Save the GitHub repo (organisation scheduled for deletion about 5 Oct):
   transfer it to an account you keep, or mirror it:
   `git clone --mirror <repo>` then push the mirror to the new home.
2. Rotate the Supabase service_role key and the operator password; update Render
   first so the live site keeps working.
3. `az login`, then `AZ_SUBSCRIPTION=<id> bash deploy/azure/provision.sh`.
4. Enter every setting in `deploy/azure/app-settings.md` on the Azure app.
5. GitHub: create a federated credential for the repo (Entra ID app
   registration > Certificates & secrets > Federated credentials > GitHub
   Actions, environment `production`), grant it Contributor on the resource
   group and AcrPush on the registry, then add the secrets/variables listed at
   the top of `.github/workflows/azure-deploy.yml`.
6. Run the workflow "Deploy to Azure". It runs the full test suite first and
   stops if any test fails.

## Test before switching (the app only accepts Cloudflare traffic)
7. In Cloudflare DNS add a proxied test record, e.g. `azure.magickeys-balwyn-portal.com`
   CNAME `<app>.azurewebsites.net`, and add that hostname to the web app
   (App Service > Custom domains).
8. On the test address check: `/api/health` returns ok; sign in; dashboard
   loads real gate data; Facility hire loads areas and saves a booking; fire
   issue and clear on a test window agreed with the school (or skipped until
   commissioning); sign out on closing the tab.
   Google sign-in will only work on the real domain, because Google allows
   specific origins; test sign-in after step 9 or add the test origin in
   Google Cloud temporarily.

## Cutover (5 minutes, out of school hours)
9. Cloudflare DNS: point `magickeys-balwyn-portal.com` (proxied) at
   `<app>.azurewebsites.net`; add the domain to the web app with a managed
   certificate.
10. Repeat the checks in step 8 on the real domain, including Google sign-in.
11. Watch Azure > App Service > Log stream for 30 minutes.

## Rollback
Point the Cloudflare record back to Render. Render is untouched until Azure has
run cleanly for a week; only then suspend the Render service.

## After cutover
- Add `push: branches: [main]` to the workflow so every push deploys to Azure.
- Switch `Content-Security-Policy-Report-Only` to enforcing in next.config.ts
  once a week of browser reports shows nothing legitimate is blocked.
