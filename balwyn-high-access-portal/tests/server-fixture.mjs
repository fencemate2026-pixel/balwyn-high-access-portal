import { fileURLToPath } from "node:url";
const envPath = fileURLToPath(new URL("../lib/server-env.ts", import.meta.url));
export const serverFixturePlugin = {
  name: "test-server-environment",
  enforce: "pre",
  resolveId(id) { if (id === "cloudflare:workers") return envPath; },
  load(id) {
    if (/(?:^|\/)server-env(?:\.ts)?$/.test(id)) return "export const env = {};";
    if (/(?:^|\/)supabase-server(?:\.ts)?$/.test(id)) return 'import {env} from "cloudflare:workers"; export const supabaseFetch = (...args) => env.fetchDatabase(...args);';
    if (/(?:^|\/)supabase-storage(?:\.ts)?$/.test(id)) return 'import {env} from "cloudflare:workers"; export const profileStorage = () => env.BUCKET;';
  },
};
