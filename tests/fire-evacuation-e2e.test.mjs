// Fire / evacuation end to end (28 Sep 2026): the REAL dashboard route
// (/api/portal, action "emergency") and one REAL Python gate controller per
// active gate, each driving a simulated gate (no GPIO). Proves the button asks
// EVERY active gate to open, each controller opens and holds its gate, the
// portal records each open as confirmed, and "clear" returns to normal.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { databaseFixture } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const store = await vite.ssrLoadModule("/lib/portal-store.ts");
const model = await vite.ssrLoadModule("/lib/portal-model.ts");
const portal = await vite.ssrLoadModule("/app/api/portal/route.ts");
const commands = await vite.ssrLoadModule("/app/api/controller/commands/route.ts");
const ack = await vite.ssrLoadModule("/app/api/controller/commands/[id]/ack/route.ts");
const origin = "https://magickeys-balwyn-portal.com";

function controllerServer() {
  const server = createHttp(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const match = req.url.match(/^\/api\/controller\/commands\/(\d+)\/ack$/);
    const response = match ? await ack.POST(request, { params: Promise.resolve({ id: match[1] }) })
      : req.url === "/api/controller/commands" ? await commands.POST(request) : new Response("{}", { status: 404 });
    res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(await response.text());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function runController(url, gateId, token, seconds) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [join(root, "gate-controller/tools/bench_sim.py"), String(seconds)], {
      env: { ...process.env, PORTAL_URL: url, ALLOW_INSECURE_HTTP_FOR_TESTS: "1", GATE_ID: gateId, CONTROLLER_TOKEN: token,
        CYCLE_PULSE_S: "1", TRAVEL_TIMEOUT_S: "10", AUTO_CLOSE_TIMEOUT_S: "20", STATE_DIRECTORY: mkdtempSync(join(tmpdir(), `fire-${gateId}-`)) },
    });
    let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
    child.on("exit", (code) => code === 0 ? resolve(out) : reject(new Error(out)));
  });
}

test("the fire button opens and holds EVERY active gate, confirmed by each controller, and clear returns to normal", { timeout: 120000 }, async (t) => {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters", GOOGLE_ALLOWED_EMAILS: "admin@example.test|administrator" });
  env.fetchDatabase = fetchDatabase;
  const admin = { displayName: "Admin", email: "admin@example.test", role: "administrator" };
  const cookie = (await auth.createSessionCookie(admin)).split(";")[0];
  const press = (body) => portal.POST(new Request(`${origin}/api/portal`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }));
  await store.ensurePortalSeeded();

  const gates = model.ACTIVE_GATES.map((gate) => gate.id);
  assert.ok(gates.length >= 2, "both connected gates are active");
  const server = await controllerServer(); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const runs = [];
  for (const gateId of gates) runs.push(runController(url, gateId, await store.issueControllerToken(gateId, admin), 16));

  // Wait until every controller has commissioned itself (closed + safety healthy).
  for (let i = 0; i < 80; i += 1) {
    const rows = (await pg.query("SELECT commissioned FROM gate_states WHERE gate_id = ANY($1)", [gates])).rows;
    if (rows.length === gates.length && rows.every((row) => Number(row.commissioned) === 1 || row.commissioned === true)) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const fire = await press({ action: "emergency", mode: "fire" });
  assert.equal(fire.status, 200, JSON.stringify(await fire.clone().json()));
  assert.equal((await fire.json()).snapshot.systemMode, "fire");
  const queued = (await pg.query("SELECT gate_id, command, source FROM command_queue ORDER BY gate_id")).rows;
  assert.deepEqual(queued.map((row) => row.gate_id).sort(), [...gates].sort(), "one command per active gate");
  assert.ok(queued.every((row) => row.command === "open" && row.source === "emergency"), "every command is an emergency OPEN");

  const outputs = await Promise.all(runs);
  const results = (await pg.query("SELECT gate_id, state, detail FROM command_queue ORDER BY gate_id")).rows;
  for (const row of results) {
    assert.equal(row.state, "acknowledged", `${row.gate_id}: ${row.detail}`);
    assert.match(row.detail, /Relay held for emergency open; open confirmed by reed switch/);
  }
  for (const output of outputs) assert.match(output, /angle=1\.00/, "each simulated gate ended fully open (held)");

  const clear = await press({ action: "clear_emergency" });
  assert.equal(clear.status, 200);
  assert.equal((await clear.json()).snapshot.systemMode, "normal");
});
