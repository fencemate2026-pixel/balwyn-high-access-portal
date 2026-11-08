// Per-person account management — signed-in administrators only.
// 10 Oct 2026 (Jarrod): every CHANGE (create, role, enable/disable, new setup
// link) again needs the administrator settings password (10-minute unlock),
// reversing the 26 Sep 2026 direction: a stolen or unattended administrator
// session alone can no longer create accounts. Listing stays admin-login only.
// Also enforced on every request: verified administrator session (role checked
// on the server), exact same-origin for every change, activity-log entry.
import { AccountError, assertSameOrigin, createPortalAccount, getAdminSettingsAccess, listPortalAccounts, requireOwner, resetPortalAccount, updatePortalAccount } from "@/lib/portal-auth";
import { recordActivity } from "@/lib/portal-store";
import { requestOrigin } from "@/lib/request-origin";
import { readBoundedText } from "@/lib/request-body";
import { accountKeyFor, staffUsageSummary } from "@/lib/staff-presence";

const headers = { "Cache-Control": "no-store" };
const ROLES = new Set(["viewer", "operator", "administrator"]);

async function authorise(request: Request) {
  // Owner only (8 Nov 2026): client logins never manage accounts.
  const auth = await requireOwner(request);
  if (!auth.user) return { response: auth.response };
  return { user: auth.user };
}

// The public https origin (the same one assertSameOrigin verified for this
// request), not the internal address the server listens on behind the proxy.
function setupLink(request: Request, token: string) {
  return `${requestOrigin(request)}/setup?token=${encodeURIComponent(token)}`;
}

export async function GET(request: Request) {
  const auth = await authorise(request);
  if (!auth.user) return auth.response;
  try {
    const accounts = await listPortalAccounts();
    // Time on portal is additive: if the usage tables are unavailable the list still loads.
    let usage: Awaited<ReturnType<typeof staffUsageSummary>> | null = null;
    try { usage = await staffUsageSummary(); } catch { console.warn("staff_usage_unavailable"); }
    const byKey = new Map((usage ?? []).map((u) => [u.account_key, u]));
    return Response.json({
      accounts: accounts.map((a) => ({ ...a, usage: usage ? byKey.get(accountKeyFor({ accountId: String(a.id), email: String(a.email) })) ?? null : undefined })),
    }, { headers });
  } catch {
    console.warn("accounts_list_unavailable");
    return Response.json({ error: "Accounts are not available right now. Please try again shortly." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers });
  const auth = await authorise(request);
  if (!auth.user) return auth.response;
  if (!await getAdminSettingsAccess(request)) {
    return Response.json({ error: "Enter the administrator settings password, then make the change again.", code: "admin_password_required" }, { status: 403, headers });
  }
  let body: Record<string, unknown>;
  try {
    const raw = await readBoundedText(request, 4096);
    if (raw === null) return Response.json({ error: "Invalid request." }, { status: 413, headers });
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
  try {
    if (body.action === "create") {
      const role = String(body.role ?? "");
      if (!ROLES.has(role)) throw new AccountError("Choose a role.");
      const created = await createPortalAccount({ email: String(body.email ?? ""), displayName: String(body.displayName ?? ""), role: role as "viewer", azureOnly: body.azureOnly === true }, auth.user.email, auth.user.isOwner === true);
      await recordActivity(auth.user, "Account created", `${String(body.email ?? "").trim().toLowerCase()} as ${role}${body.azureOnly === true ? " (Azure sign-in only)" : ""}`, "access");
      if (body.azureOnly === true) return Response.json({ id: created.id, azureOnly: true }, { headers });
      return Response.json({ id: created.id, setupLink: setupLink(request, created.token), expiresAt: created.expiresAt }, { headers });
    }
    if (body.action === "reset") {
      const reset = await resetPortalAccount(String(body.id ?? ""), auth.user.isOwner === true);
      await recordActivity(auth.user, "Account setup link issued", `Account ${reset.id}; previous password and sessions revoked`, "access");
      return Response.json({ id: reset.id, setupLink: setupLink(request, reset.token), expiresAt: reset.expiresAt }, { headers });
    }
    if (body.action === "update") {
      const role = body.role === undefined ? undefined : String(body.role);
      if (role !== undefined && !ROLES.has(role)) throw new AccountError("Choose a role.");
      const active = body.active === undefined ? undefined : Boolean(body.active);
      await updatePortalAccount(String(body.id ?? ""), { active, role: role as "viewer" | undefined }, auth.user.isOwner === true);
      await recordActivity(auth.user, "Account updated", `Account ${String(body.id ?? "")}${role ? ` role ${role}` : ""}${active === undefined ? "" : active ? " enabled" : " disabled"}`, "access");
      return Response.json({ ok: true }, { headers });
    }
    return Response.json({ error: "Unknown action." }, { status: 400, headers });
  } catch (error) {
    if (error instanceof AccountError) return Response.json({ error: error.message }, { status: 400, headers });
    return Response.json({ error: "The account change could not be saved." }, { status: 503, headers });
  }
}
