import { isSameOriginSignInRequest } from "@/lib/google-signin";
import { clearResidentCookie } from "@/lib/macquarie-session";
import { GdUnavailableError } from "@/lib/gd-db";
import { currentResident, handleResidentPost, publicSnapshot } from "@/lib/macquarie-store";
import { readBoundedText } from "@/lib/request-body";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

function hasResidentCookie(request: Request) {
  return /(?:^|;\s*)macquarie_resident_session=/.test(request.headers.get("cookie") ?? "");
}

export async function GET(request: Request) {
  try {
    const user = await currentResident(request);
    if (!user) return json({ signedIn: false }, 401, hasResidentCookie(request) ? clearResidentCookie() : undefined);
    return json(await publicSnapshot(user));
  } catch (error) {
    if (error instanceof GdUnavailableError) return json({ error: "The sliding gate is not available right now." }, 503);
    console.warn("macquarie_read_failed");
    return json({ error: "Macquarie Drive is not available right now." }, 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginSignInRequest(request)) return json({ error: "Request rejected." }, 403);
  let user;
  try { user = await currentResident(request); } catch {
    return json({ error: "Macquarie Drive is not available right now." }, 503);
  }
  if (!user) return json({ signedIn: false }, 401, hasResidentCookie(request) ? clearResidentCookie() : undefined);
  let body: Record<string, unknown>;
  try {
    const raw = await readBoundedText(request, 8192);
    if (raw === null) return json({ error: "Invalid request." }, 413);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  try {
    const result = await handleResidentPost(user, body);
    return json(result.body, result.status);
  } catch (error) {
    if (error instanceof GdUnavailableError) return json({ error: "The sliding gate is not available right now." }, 503);
    console.warn("macquarie_post_failed");
    return json({ error: "That change could not be saved." }, 503);
  }
}
