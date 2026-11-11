import { isSameOriginSignInRequest } from "@/lib/google-signin";
import { clearResidentCookie, createResidentCookie } from "@/lib/macquarie-session";
import { currentResident, noteSignOut, requestLoginCode, verifyLoginCode } from "@/lib/macquarie-store";
import { readBoundedText } from "@/lib/request-body";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (!isSameOriginSignInRequest(request)) return json({ error: "Request rejected." }, 403);
  try {
    const raw = await readBoundedText(request, 8192);
    if (raw === null) return json({ error: "Invalid request." }, 413);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
}

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (body.action === "request-code") {
    const result = await requestLoginCode(body.email, request);
    return json({ message: result.message, sent: result.sent }, result.status);
  }
  if (body.action === "verify-code") {
    const result = await verifyLoginCode(body.email, body.code);
    if (!result.ok) return json({ message: result.message }, result.status);
    return json({
      message: result.activityLogged ? "Signed in." : "Signed in. It did not appear on the activity timeline.",
    }, 200, await createResidentCookie(result.email, result.displayName));
  }
  if (body.action === "sign-out") {
    const user = await currentResident(request).catch(() => null);
    const activityLogged = user ? await noteSignOut(user) : true;
    return json({
      message: activityLogged ? "Signed out." : "Signed out. It did not appear on the activity timeline.",
    }, 200, clearResidentCookie());
  }
  return json({ error: "Unknown action." }, 400);
}
