// Administrator-only: one person's recent sessions, button presses and logged
// actions (15 Oct 2026). Read-only. The person is chosen by account id.
import { listPortalAccounts, requireOwner } from "@/lib/portal-auth";
import { accountKeyFor, staffDetail } from "@/lib/staff-presence";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireOwner(request);
  if (!auth.user) return auth.response;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  try {
    const account = (await listPortalAccounts()).find((a) => String(a.id) === id);
    if (!account) return Response.json({ error: "Account not found." }, { status: 404, headers });
    const detail = await staffDetail(accountKeyFor({ accountId: String(account.id), email: String(account.email) }), String(account.display_name));
    return Response.json({ account: { id: account.id, display_name: account.display_name, email: account.email }, ...detail }, { headers });
  } catch {
    console.warn("staff_activity_unavailable");
    return Response.json({ error: "Activity is not available right now. Please try again shortly." }, { status: 503, headers });
  }
}
