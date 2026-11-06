import { supabaseFetch } from "./supabase-server";
import { directDatabaseConfigured } from "@/db/direct-postgres";
import { databaseProfileStorage } from "./db-profile-storage";

const bucket = "balwyn-profile-photos";
function path(key: string) {
  if (!/^profiles\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(key)) throw new Error("Invalid profile image key.");
  return `/storage/v1/object/${bucket}/${key}`;
}

export function profileStorage() {
  // On the portal's own PostgreSQL there is no Supabase Storage: photos live in the database.
  if (directDatabaseConfigured()) return databaseProfileStorage();
  return {
    async put(key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string } }) {
      const response = await supabaseFetch(path(key), { method: "POST", body: bytes as BodyInit,
        headers: { "Content-Type": options.httpMetadata.contentType, "x-upsert": "false" } });
      if (!response.ok) throw new Error("Profile photo storage failed.");
    },
    async get(key: string) {
      const response = await supabaseFetch(path(key));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Profile photo storage unavailable.");
      return { body: response.body, httpMetadata: { contentType: response.headers.get("Content-Type")?.split(";")[0] } };
    },
    async delete(key: string) {
      path(key);
      const response = await supabaseFetch(`/storage/v1/object/${bucket}`, { method: "DELETE",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [key] }) });
      if (!response.ok) throw new Error("Profile photo cleanup failed.");
    },
  };
}
