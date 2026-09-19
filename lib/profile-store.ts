import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { getAdminSettingsAccess, getSessionAccountKey } from "./portal-auth";
import type { PortalUser } from "./portal-model";
import type { UserProfile } from "./profile-model";

export type ProfileRow = { id: string; account_key: string; display_name: string; username: string | null; contact_email: string; phone: string; job_title: string; avatar_key: string | null; updated_at: string };
export function publicProfile(row: ProfileRow): UserProfile {
  return { id: row.id, displayName: row.display_name, username: row.username ?? "", contactEmail: row.contact_email,
    phone: row.phone, jobTitle: row.job_title, avatarUrl: row.avatar_key ? `/api/profile/image/${row.id}?v=${encodeURIComponent(row.avatar_key.split("/").pop() ?? "")}` : null };
}
export function profileBucket() {
  if (!env.BUCKET) throw new Error("Profile photo storage is unavailable.");
  return env.BUCKET;
}
export async function ownProfile(request: Request, user: PortalUser): Promise<ProfileRow> {
  const key = await getSessionAccountKey(request);
  if (!key) throw new Error("Sign in again.");
  const db = getD1();
  await db.prepare("INSERT INTO user_profiles (id, account_key, display_name, contact_email) VALUES (?, ?, ?, ?) ON CONFLICT(account_key) DO NOTHING")
    .bind(crypto.randomUUID(), key, user.displayName, user.email.includes("@") ? user.email : "").run();
  const row = await db.prepare("SELECT * FROM user_profiles WHERE account_key = ?").bind(key).first<ProfileRow>();
  if (!row) throw new Error("Profile unavailable.");
  return row;
}
export async function editableProfile(request: Request, user: PortalUser, id?: string): Promise<ProfileRow | null> {
  const own = await ownProfile(request, user);
  if (!id || own.id === id) return own;
  if (user.role !== "administrator" || !await getAdminSettingsAccess(request)) return null;
  return getD1().prepare("SELECT * FROM user_profiles WHERE id = ?").bind(id).first<ProfileRow>();
}
