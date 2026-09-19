import { getD1 } from "@/db";
import { requireOperator } from "@/lib/portal-auth";
import { profileBucket } from "@/lib/profile-store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator(request);
  if (!auth.user) return auth.response;
  const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  try {
    const { id } = await context.params;
    const row = await getD1().prepare("SELECT avatar_key FROM user_profiles WHERE id = ?").bind(id).first<{ avatar_key: string | null }>();
    if (!row?.avatar_key) return new Response(null, { status: 404, headers });
    const object = await profileBucket().get(row.avatar_key);
    const contentType = object?.httpMetadata?.contentType;
    if (!object || !["image/png", "image/jpeg", "image/webp"].includes(contentType)) return new Response(null, { status: 404, headers });
    headers.set("Content-Type", contentType);
    return new Response(object.body, { headers });
  } catch { return new Response(null, { status: 503, headers }); }
}
