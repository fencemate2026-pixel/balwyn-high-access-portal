import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

export function databaseFixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter((value) => value.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...bindings) { values = bindings; return this; },
        async first() { return statement.get(...values) ?? null; },
        async run() { const result = statement.run(...values); return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
        async all() { return { results: statement.all(...values), success: true, meta: { changes: 0 } }; },
        async raw() { return statement.all(...values).map((row) => Object.values(row)); },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, db };
}

export async function passwordHash(password, salt) {
  let material = new TextEncoder().encode(password);
  for (let stage = 1; stage <= 3; stage++) {
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    material = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(stage === 1 ? salt : `${salt}:stage:${stage}`), iterations: 100000 }, key, 256));
  }
  return Buffer.from(material).toString("base64url");
}
