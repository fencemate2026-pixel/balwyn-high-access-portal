import { getD1 } from "@/db";
import { assertSameOrigin, requireOperator } from "@/lib/portal-auth";
import { avatarContentType } from "@/lib/profile-model";
import { editableProfile, profileBucket, publicProfile, type ProfileRow } from "@/lib/profile-store";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!assertSameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers });
  const auth = await requireOperator(request);
  if (!auth.user) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  const limit = 3 * 1024 * 1024;
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > limit) return Response.json({ error: "Choose a PNG, JPEG or WebP photo under 3 MB." }, { status: 413, headers });
  try {
    const row = await editableProfile(request, auth.user, id ?? undefined);
    if (!row) return Response.json({ error: "You cannot change this user's photo. Unlock administrator settings first." }, { status: 403, headers });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) { await reader.cancel(); return Response.json({ error: "Choose a photo under 3 MB." }, { status: 413, headers }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const contentType = avatarContentType(bytes);
    if (!contentType) return Response.json({ error: "Choose a PNG, JPEG or WebP photo under 3 MB." }, { status: 400, headers });
    const bucket = profileBucket();
    const key = `profiles/${row.id}/${crypto.randomUUID()}`;
    await bucket.put(key, bytes, { httpMetadata: { contentType } });
    let updated: ProfileRow | null;
    try {
      updated = await getD1().prepare("UPDATE user_profiles SET avatar_key = ?, updated_at = ? WHERE id = ? RETURNING *").bind(key, new Date().toISOString(), row.id).first<ProfileRow>();
      if (!updated) throw new Error("Profile unavailable.");
    } catch (error) { await bucket.delete(key); throw error; }
    if (row.avatar_key) { try { await bucket.delete(row.avatar_key); } catch { /* Retryable cleanup; the previous key is no longer served. */ } }
    return Response.json({ profile: publicProfile(updated) }, { headers });
  } catch { return Response.json({ error: "The profile photo could not be saved. Please try again." }, { status: 503, headers }); }
}
