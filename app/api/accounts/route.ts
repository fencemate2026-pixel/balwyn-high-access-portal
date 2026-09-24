// Per-person account management — administrators only, with the
// administrator settings unlock (password re-entered within 10 minutes).
// Every change is written to the activity log.
import { AccountError, assertSameOrigin, createPortalAccount, getAdminSettingsAccess, listPortalAccounts, requireOperator, resetPortalAccount, updatePortalAccount } from "@/lib/portal-auth";
import { recordActivity } from "@/lib/portal-store";

const headers = { "Cache-Control": "no-store" };
const ROLES = new Set(["viewer", "operator", "administrator"]);

async function authorise(request: Request) {
  const auth = await requireOperator(request, "administrator");
  if (!auth.user) return { response: auth.response };
  if (!await getAdminSettingsAccess(request)) {
    return { response: Response.json({ error: "Unlock administrator settings to manage accounts." }, { status: 403, headers }) };
  }
  return { user: auth.user };
}

function setupLink(request: Request, token: string) {
  const origin = new URL(request.url).origin;
  return `${origin}/setup?token=${encodeURIComponent(token)}`;
}

export async function GET(request: Request) {
  const auth = await authorise(request);
  if (!auth.user) return auth.response;
  try {
    return Response.json({ accounts: await listPortalAccounts() }, { headers });
  } catch {
    return Response.json({ error: "Accounts are not available yet. The accounts table has not been created in the database." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers });
  const auth = await authorise(request);
  if (!auth.user) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
  try {
    if (body.action === "create") {
      const role = String(body.role ?? "");
      if (!ROLES.has(role)) throw new AccountError("Choose a role.");
      const created = await createPortalAccount({ email: String(body.email ?? ""), displayName: String(body.displayName ?? ""), role: role as "viewer" }, auth.user.email);
      await recordActivity(auth.user, "Account created", `${String(body.email ?? "").trim().toLowerCase()} as ${role}`, "access");
      return Response.json({ id: created.id, setupLink: setupLink(request, created.token), expiresAt: created.expiresAt }, { headers });
    }
    if (body.action === "reset") {
      const reset = await resetPortalAccount(String(body.id ?? ""));
      await recordActivity(auth.user, "Account setup link issued", `Account ${reset.id}; previous password and sessions revoked`, "access");
      return Response.json({ id: reset.id, setupLink: setupLink(request, reset.token), expiresAt: reset.expiresAt }, { headers });
    }
    if (body.action === "update") {
      const role = body.role === undefined ? undefined : String(body.role);
      if (role !== undefined && !ROLES.has(role)) throw new AccountError("Choose a role.");
      const active = body.active === undefined ? undefined : Boolean(body.active);
      await updatePortalAccount(String(body.id ?? ""), { active, role: role as "viewer" | undefined });
      await recordActivity(auth.user, "Account updated", `Account ${String(body.id ?? "")}${role ? ` role ${role}` : ""}${active === undefined ? "" : active ? " enabled" : " disabled"}`, "access");
      return Response.json({ ok: true }, { headers });
    }
    return Response.json({ error: "Unknown action." }, { status: 400, headers });
  } catch (error) {
    if (error instanceof AccountError) return Response.json({ error: error.message }, { status: 400, headers });
    return Response.json({ error: "The account change could not be saved." }, { status: 503, headers });
  }
}
