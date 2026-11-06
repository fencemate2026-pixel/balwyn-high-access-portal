// Owner → Thomastown swing gate (Azure). Same gate as /api/owner/sites: a verified administrator session
// whose email is PORTAL_OWNER_EMAIL, else 404 (the page's existence is not disclosed); every change also
// needs an exact same-origin request. No PIN or unlock step for the owner (6 Nov 2026, Jarrod).
// Changes are QUEUED here and applied by the Pi; the Pi decides, and the screen shows Applied / Failed
// as the Pi reports it. Nothing here can move the gate relay.
import { GdUnavailableError, gdTransaction } from "@/lib/gd-db";
import { SWING_DEVICE_ID, swingCommandInput } from "@/lib/gd-swing-model";
import { enqueueCommand, getDetail, listCommands } from "@/lib/gd-swing-store";
import { OwnerSiteInputError, UNIT_ONLINE_SECONDS } from "@/lib/owner-sites-model";
import { assertSameOrigin, requireOperator } from "@/lib/portal-auth";
import type { PortalUser } from "@/lib/portal-model";
import { readBoundedText } from "@/lib/request-body";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const notFound = () => json({ error: "Not found." }, 404);

async function owner(request: Request): Promise<PortalUser | null> {
  const auth = await requireOperator(request, "administrator");
  return auth.user && auth.user.isOwner === true ? auth.user : null;
}
function failure(error: unknown) {
  if (error instanceof OwnerSiteInputError) return json({ error: error.message }, 400);
  if (error instanceof GdUnavailableError) return json({ error: error.message }, 503);
  console.warn("thomastown_swing_failed");     // never log the error object: it could carry caller data
  return json({ error: "Thomastown swing data is not available right now." }, 503);
}

export async function GET(request: Request) {
  const user = await owner(request);
  if (!user) return notFound();
  try {
    const out = await gdTransaction(async (c) => ({ ...(await getDetail(c)), commands: await listCommands(c) }));
    const seen = out.device?.last_seen ? Date.parse(String(out.device.last_seen)) : NaN;
    return json({ ...out, online: Number.isFinite(seen) && (Date.now() - seen) / 1000 < UNIT_ONLINE_SECONDS * 2, serverTime: new Date().toISOString() });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return json({ error: "Request rejected." }, 403);
  const user = await owner(request);
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
    const out = await gdTransaction((c) => enqueueCommand(c, input, user.email, SWING_DEVICE_ID));
    return json({ ok: true, ...out });
  } catch (error) { return failure(error); }
}
