// Owner → an Azure-backed gate site (see GD_SITES). The portal owner (administrator whose email is
// PORTAL_OWNER_EMAIL) can open every gate. A Settlement Road member can open only that site's two
// gates. Anyone else gets 404. Every change also needs an exact same-origin request.
// No PIN or unlock step for the owner (6 Nov 2026, Jarrod).
// Changes are QUEUED here and applied by the Pi; the Pi decides, and the screen shows Applied / Failed
// as the Pi reports it. gate.pulse queues one relay pulse for Macquarie Drive Thomastown.
// This process does not pulse the relay. The Pi does, on its next check-in.
import { GdUnavailableError, gdTransaction } from "@/lib/gd-db";
import { swingCommandInput, type GdSiteId } from "@/lib/gd-swing-model";
import { enqueueCommand, getDetail, listCommands } from "@/lib/gd-swing-store";
import { OwnerSiteInputError, UNIT_ONLINE_SECONDS } from "@/lib/owner-sites-model";
import { assertSameOrigin, requireOperator } from "@/lib/portal-auth";
import type { PortalUser } from "@/lib/portal-model";
import { readBoundedText } from "@/lib/request-body";
import { isSettlementDevice, isSettlementMember } from "@/lib/settlement-access";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const notFound = () => json({ error: "Not found." }, 404);

/** Owner sees every gate. A Settlement Road member sees only that site's two gates. Anyone else is 404. */
async function gateUser(request: Request, site: GdSiteId): Promise<PortalUser | null> {
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return null;
  if (auth.user.role === "administrator" && auth.user.isOwner === true) return auth.user;
  if (isSettlementDevice(site) && isSettlementMember(auth.user.email)) return auth.user;
  return null;
}
function failure(error: unknown, site: GdSiteId) {
  if (error instanceof OwnerSiteInputError) return json({ error: error.message }, 400);
  if (error instanceof GdUnavailableError) return json({ error: error.message }, 503);
  console.warn("gd_owner_failed", site);       // never log the error object: it could carry caller data
  return json({ error: "This site's data is not available right now." }, 503);
}

export async function handleOwnerGet(request: Request, site: GdSiteId): Promise<Response> {
  const user = await gateUser(request, site);
  if (!user) return notFound();
  try {
    const out = await gdTransaction(async (c) => ({ ...(await getDetail(c, site)), commands: await listCommands(c, site) }));
    const seen = out.device?.last_seen ? Date.parse(String(out.device.last_seen)) : NaN;
    return json({ ...out, online: Number.isFinite(seen) && (Date.now() - seen) / 1000 < UNIT_ONLINE_SECONDS * 2, serverTime: new Date().toISOString() });
  } catch (error) { return failure(error, site); }
}

export async function handleOwnerPost(request: Request, site: GdSiteId): Promise<Response> {
  if (!assertSameOrigin(request)) return json({ error: "Request rejected." }, 403);
  const user = await gateUser(request, site);
  if (!user) return notFound();
  let body: Record<string, unknown>;
  try {
    const raw = await readBoundedText(request, 4096);
    if (raw === null) return json({ error: "Invalid request." }, 413);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return json({ error: "Invalid request." }, 400); }
  try {
    const input = swingCommandInput(body);
    // A Settlement Road login cannot queue an open pulse. That pulse belongs to Macquarie Drive.
    if (user.isOwner !== true && input.kind === "gate.pulse") return notFound();
    const out = await gdTransaction((c) => enqueueCommand(c, input, user.email, site));
    return json({ ok: true, ...out });
  } catch (error) { return failure(error, site); }
}
