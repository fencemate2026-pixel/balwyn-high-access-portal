import { getD1 } from "@/db";
import { getAdminSettingsAccess, requireOperator } from "@/lib/portal-auth";
import { isSameOriginSignInRequest } from "@/lib/google-signin";
import { readSignInBody } from "@/lib/signin-request";
import { validateProfileInput } from "@/lib/profile-model";
import { editableProfile, ownProfile, profileBucket, publicProfile, type ProfileRow } from "@/lib/profile-store";

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.user) return auth.response;
  const headers = { "Cache-Control": "no-store" };
  try {
    const profile = await ownProfile(request, auth.user);
    if (new URL(request.url).searchParams.get("scope") === "all") {
      if (!await getAdminSettingsAccess(request)) return Response.json({ error: "Unlock administrator settings to manage other users." }, { status: 403, headers });
      const rows = await getD1().prepare("SELECT * FROM user_profiles ORDER BY display_name LIMIT 500").all<ProfileRow>();
      return Response.json({ profile: publicProfile(profile), profiles: rows.results.map(publicProfile) }, { headers });
    }
    return Response.json({ profile: publicProfile(profile) }, { headers });
  } catch { return Response.json({ error: "Profiles are temporarily unavailable." }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers });
  const auth = await requireOperator(request);
  if (!auth.user) return auth.response;
  let body: Record<string, unknown>;
  let input: ReturnType<typeof validateProfileInput>;
  try { body = await readSignInBody(request); input = validateProfileInput(body); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid profile." }, { status: 400, headers }); }
  try {
    const row = await editableProfile(request, auth.user, typeof body.id === "string" ? body.id : undefined);
    if (!row) return Response.json({ error: "You cannot edit this profile. Administrator password verification is required." }, { status: 403, headers });
    if (input.username) {
      const existing = await getD1().prepare("SELECT id FROM user_profiles WHERE username = ? AND id != ?").bind(input.username, row.id).first();
      if (existing) return Response.json({ error: "That username is already in use." }, { status: 409, headers });
    }
    const updated = await getD1().prepare(`UPDATE user_profiles SET display_name = ?, username = ?, contact_email = ?, phone = ?, job_title = ?,
      avatar_key = ?, updated_at = ? WHERE id = ? RETURNING *`)
      .bind(input.displayName, input.username || null, input.contactEmail, input.phone, input.jobTitle,
        body.removePhoto === true ? null : row.avatar_key, new Date().toISOString(), row.id).first<ProfileRow>();
    if (!updated) throw new Error("Profile unavailable.");
    await getD1().prepare("INSERT INTO activity_log (action, detail, category, actor_name, actor_role) VALUES ('User profile updated', ?, 'settings', ?, ?)")
      .bind(`Profile ${row.id} updated.`, auth.user.displayName, auth.user.role).run();
    if (body.removePhoto === true && row.avatar_key) {
      try { await profileBucket().delete(row.avatar_key); } catch { /* The removed photo is no longer served by the profile route. */ }
    }
    return Response.json({ profile: publicProfile(updated) }, { headers });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint/i.test(error.message)) return Response.json({ error: "That username is already in use." }, { status: 409, headers });
    return Response.json({ error: "Your profile could not be saved. Please try again." }, { status: 503, headers });
  }
}
