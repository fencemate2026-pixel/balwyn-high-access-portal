import { requireOperator } from "@/lib/portal-auth";
import { editableProfile, profileBucket } from "@/lib/profile-store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator(request);
  if (!auth.user) return auth.response;
  const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  try {
    const { id } = await context.params;
    // Same rule as every other profile endpoint (AUDIT_LIVE_ACTIVE P2 /
    // AUDIT_SECURITY P3, 18 Oct 2026): your own photo, or an administrator
    // with settings unlocked. editableProfile() returns null when neither
    // is true, so a viewer-role account can no longer fetch anyone else's
    // profile photo just by learning their id.
    const row = await editableProfile(request, auth.user, id);
    if (!row) return new Response(null, { status: 403, headers });
    if (!row.avatar_key) return new Response(null, { status: 404, headers });
    const object = await profileBucket().get(row.avatar_key);
    const contentType = object?.httpMetadata?.contentType;
    if (!object || !contentType || !["image/png", "image/jpeg", "image/webp"].includes(contentType)) return new Response(null, { status: 404, headers });
    headers.set("Content-Type", contentType);
    return new Response(object.body, { headers });
  } catch { return new Response(null, { status: 503, headers }); }
}
