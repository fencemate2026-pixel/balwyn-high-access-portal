export function supabaseSettings() {
  const value = process.env.SUPABASE_URL ?? process.env.SUPABASE_DATABASE_URL ?? "";
  const url = new URL(value);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || !key) {
    throw new Error("Server database configuration is unavailable.");
  }
  return { origin: url.origin, key };
}

export async function supabaseFetch(path: string, init: RequestInit = {}) {
  const { origin, key } = supabaseSettings();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  return fetch(`${origin}${path}`, { ...init, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
}
