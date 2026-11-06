// Mildura Phase 2 (4 Nov 2026, Jarrod): owner-only control of the Mildura Pi through a command
// queue the Pi polls over outbound HTTPS (gd-mirror). Open Gate / Lockdown are applied by the Pi via the
// gate app's own loopback admin routes, never GPIO, and only when the Pi advertises them. Same gate as /api/owner/sites (owner session,
// else 404) PLUS exact same-origin for every change. 4 Nov 2026 (Jarrod): no separate administrator unlock or PIN step to add or delete people.
// PINs: validated here, sealed to the Pi's public key, never stored, logged or echoed in plaintext.
import { getSql } from "@/db";
import { GdUnavailableError, gdTransaction } from "@/lib/gd-db";
import * as azure from "@/lib/gd-mildura-store";
import { assertSameOrigin, requireOperator } from "@/lib/portal-auth";
import { readBoundedText } from "@/lib/request-body";
import { OwnerSiteInputError } from "@/lib/owner-sites-model";
import { GATE_KINDS, GATE_OFF_NOTE, GATE_OPEN_TTL_S, HOLD_RETIRED_NOTE, keyFingerprint, melbourneNow, mirrorCommandInput, sealSecrets } from "@/lib/mildura-commands-model";
import {
  OwnerSitesUnavailableError, auditMirrorChange, enqueueMirrorCommand, getMirrorUnit, getSiteBySlug, listMirrorCommands,
} from "@/lib/owner-sites-store";
import type { PortalUser } from "@/lib/portal-model";

export const dynamic = "force-dynamic";
const SLUG = "mildura";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const notFound = () => json({ error: "Not found." }, 404);

/** What the Pi says it will accept (it reports this in every heartbeat; it re-checks on apply). */
function caps(unit: { last_status: Record<string, unknown> | null }) {
  const c = unit.last_status?.mirror_caps;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === "string") : [];
}

async function owner(request: Request): Promise<PortalUser | null> {
  const auth = await requireOperator(request, "administrator");
  return auth.user && auth.user.isOwner === true ? auth.user : null;
}
function failure(error: unknown) {
  if (error instanceof OwnerSiteInputError) return json({ error: error.message }, 400);
  if (error instanceof OwnerSitesUnavailableError || error instanceof GdUnavailableError) return json({ error: error.message }, 503);
  console.warn("mildura_control_failed");                 // never log the error object: it could carry input
  return json({ error: "Mildura control is not available right now." }, 503);
}

/** Mildura lives in Azure once MILDURA_BACKEND=azure (7 Nov 2026); until then the Supabase path is unchanged. */
async function loadUnit(): Promise<{ sid: string; unit: { id: string; command_pubkey: string | null; last_status: Record<string, unknown> | null } }> {
  if (azure.milduraOnAzure()) {
    const unit = await gdTransaction((c) => azure.mirrorUnit(c));
    if (!unit) throw new OwnerSiteInputError("The Mildura Pi is not registered yet.");
    return { sid: azure.MILDURA_DEVICE_ID, unit };
  }
  const site = await getSiteBySlug(SLUG);
  const sid = String(site.id);
  return { sid, unit: await getMirrorUnit(sid) };
}
async function loadState() {
  if (azure.milduraOnAzure()) {
    const { unit, commands } = await gdTransaction(async (c) => ({ unit: await azure.mirrorUnit(c), commands: await azure.mirrorCommands(c) }));
    if (!unit) throw new OwnerSiteInputError("The Mildura Pi is not registered yet.");
    return { unit, commands };
  }
  const { sid, unit } = await loadUnit();
  return { unit, commands: await listMirrorCommands(sid) };
}

export async function GET(request: Request) {
  const user = await owner(request);
  if (!user) return notFound();
  try {
    const { unit, commands } = await loadState();
    return json({
      commands, keyFingerprint: await keyFingerprint(unit.command_pubkey), keyRegistered: Boolean(unit.command_pubkey),
      unlocked: true, unlockExpiresAt: null,
      gate: { open: caps(unit).includes("gate.open"), lockdown: caps(unit).includes("gate.lockdown"), lockdownOn: unit.last_status?.lockdown === true,
        hold: false, holdNote: HOLD_RETIRED_NOTE, offNote: GATE_OFF_NOTE },
      serverTime: new Date().toISOString(),
    });
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
    const input = mirrorCommandInput(body);
    const { sid, unit } = await loadUnit();
    if ((GATE_KINDS as readonly string[]).includes(input.kind) && !caps(unit).includes(input.kind)) throw new OwnerSiteInputError(GATE_OFF_NOTE);
    const id = crypto.randomUUID();
    let sealed: string | null = null;
    if (input.secrets) {
      if (!unit.command_pubkey) throw new OwnerSiteInputError("The Mildura Pi has not registered its command key yet, so PINs cannot be sent. Enable control on the Pi first.");
      sealed = await sealSecrets(unit.command_pubkey, input.secrets, id);
    }
    const queued = {
      id, site_id: sid, unit_id: unit.id, client_key: input.clientKey, kind: input.kind, args: input.args, sealed, actor_email: user.email,
      ...(input.kind === "gate.open" ? { expires_at: new Date(Date.now() + GATE_OPEN_TTL_S * 1000).toISOString() } : {}),
    };
    const { command, duplicate } = azure.milduraOnAzure()
      ? await gdTransaction((c) => azure.enqueue(c, queued))
      : await enqueueMirrorCommand(queued);
    if (!duplicate) {
      const changed_by = `portal:${user.email}`;
      const entry = { action: `portal.${input.kind}`, detail: `Queued: ${input.summary}`, changed_by, occurred_at_local: melbourneNow() };
      if (azure.milduraOnAzure()) await gdTransaction((c) => azure.audit(c, entry)); else await auditMirrorChange(sid, entry);
      // Same activity log the admin unlock writes to. Best effort: the queue + gd_mirror_changes row are the record.
      try {
        await getSql().prepare("INSERT INTO activity_log (action, detail, category, actor_name, actor_role) VALUES ('Mildura command queued', ?, 'settings', ?, ?)")
          .bind(input.summary, user.displayName, user.role).run();
      } catch { /* portal DB unavailable: audit already in gd_mirror_changes */ }
    }
    return json({ ok: true, duplicate, command });
  } catch (error) { return failure(error); }
}
