/**
 * Profile photos stored in the portal's own PostgreSQL (table profile_photos),
 * used when PORTAL_DATABASE_URL is set. Same interface as the Supabase Storage
 * version in supabase-storage.ts, so callers do not change.
 */
import { getSql } from "@/db";

const KEY = /^profiles\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 3 * 1024 * 1024;

function checkedKey(key: string) {
  if (!KEY.test(key)) throw new Error("Invalid profile image key.");
  return key;
}

export function databaseProfileStorage() {
  return {
    async put(key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string } }) {
      checkedKey(key);
      if (!TYPES.has(options.httpMetadata.contentType) || bytes.byteLength > MAX_BYTES) throw new Error("Profile photo storage failed.");
      // x-upsert was false in the Storage version: an existing key is refused, not replaced.
      await getSql().prepare("INSERT INTO profile_photos (key, content_type, data_base64) VALUES (?, ?, ?)")
        .bind(key, options.httpMetadata.contentType, Buffer.from(bytes).toString("base64")).run();
    },
    async get(key: string) {
      checkedKey(key);
      const row = await getSql().prepare("SELECT content_type, data_base64 FROM profile_photos WHERE key = ?")
        .bind(key).first<{ content_type: string; data_base64: string }>();
      if (!row) return null;
      return { body: new Uint8Array(Buffer.from(row.data_base64, "base64")), httpMetadata: { contentType: row.content_type } };
    },
    async delete(key: string) {
      checkedKey(key);
      await getSql().prepare("DELETE FROM profile_photos WHERE key = ?").bind(key).run();
    },
  };
}
