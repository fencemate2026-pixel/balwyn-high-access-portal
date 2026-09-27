// End-to-end: the REAL Python gate controller (simulated gate, no GPIO) talking
// to the REAL portal controller routes and database schema. Proves the two
// halves agree on the protocol: commissioning, command, acknowledgement.
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
const store = await vite.ssrLoadModule("/lib/portal-store.ts");
const commands = await vite.ssrLoadModule("/app/api/controller/commands/route.ts");
const ack = await vite.ssrLoadModule("/app/api/controller/commands/[id]/ack/route.ts");

function serve() {
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

function controller(url, token, seconds) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [join(root, "gate-controller/tools/bench_sim.py"), String(seconds)], {
      env: { ...process.env, PORTAL_URL: url, ALLOW_INSECURE_HTTP_FOR_TESTS: "1", GATE_ID: "TF-ENTRY", CONTROLLER_TOKEN: token,
        CYCLE_PULSE_S: "1", TRAVEL_TIMEOUT_S: "10", AUTO_CLOSE_TIMEOUT_S: "20", STATE_DIRECTORY: mkdtempSync(join(tmpdir(), "gate-")) },
    });
    let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
    child.on("exit", (code) => code === 0 ? resolve(out) : reject(new Error(out)));
  });
}

test("the real controller commissions, opens on a portal command and is confirmed by the portal", { timeout: 120000 }, async (t) => {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  env.fetchDatabase = fetchDatabase;
  await store.ensurePortalSeeded();
  const admin = { displayName: "Admin", email: "a@example.test", role: "administrator" };
  const token = await store.issueControllerToken("TF-ENTRY", admin);
  const server = await serve(); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = controller(url, token, 14);
  // Wait for commissioning from a real heartbeat (closed + safety healthy).
  for (let i = 0; i < 60; i += 1) {
    const row = (await pg.query("SELECT commissioned FROM gate_states WHERE gate_id = 'TF-ENTRY'")).rows[0];
    if (row?.commissioned === 1 || row?.commissioned === true) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await store.queueGateCommands(["TF-ENTRY"], "open", admin, { activityAction: "Test open", activityDetail: "e2e" });
  const output = await run;
  const command = (await pg.query("SELECT command, state, detail FROM command_queue WHERE gate_id = 'TF-ENTRY' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(command.command, "open");
  assert.equal(command.state, "acknowledged", `${command.detail}\n${output}`);
  assert.match(command.detail, /open confirmed by reed switch/);
  const gate = (await pg.query("SELECT commissioned, safety_ok FROM gate_states WHERE gate_id = 'TF-ENTRY'")).rows[0];
  assert.ok(gate.commissioned);
  assert.match(output, /relay_on_writes=1/);
});
