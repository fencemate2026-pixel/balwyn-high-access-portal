import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, server: { middlewareMode: true } });
after(() => vite.close());
const { default: handler } = await vite.ssrLoadModule("/netlify/functions/remote-open.mts");

test("Netlify requires a separate operator token; demo sign-in cannot actuate", async () => {
  const env = { DOOR_OPERATOR_TOKEN: "operator-secret-at-least-32-characters", DOOR_SERVICE_TOKEN: "pi-secret-at-least-32-characters-long", DOOR_SERVICE_URL: "https://pi.example.test", DOOR_GATE_MAP: '{"TF-ENTRY":1}' };
  const previous = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => env[name] } };
  const request = (token = "") => new Request("https://portal.example.test/.netlify/functions/remote-open", {
    method: "POST", headers: { Origin: "https://portal.example.test", Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID() }, body: '{"gateId":"TF-ENTRY"}',
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init.headers.Authorization, `Bearer ${env.DOOR_SERVICE_TOKEN}`);
    return Response.json({ status: "dry_run", door: 1, pulse_ms: 500, position: "unknown", sensor_feedback: false, request_id: init.headers["Idempotency-Key"] });
  };
  try {
    assert.equal((await handler(request())).status, 401);
    assert.equal((await handler(request(env.DOOR_SERVICE_TOKEN))).status, 401);
    assert.equal(calls, 0);
    const good = await handler(request(env.DOOR_OPERATOR_TOKEN));
    assert.equal(good.status, 200);
    assert.equal((await good.json()).status, "dry_run");
    assert.equal(calls, 1);
    env.DOOR_OPERATOR_TOKEN = env.DOOR_SERVICE_TOKEN;
    assert.equal((await handler(request(env.DOOR_OPERATOR_TOKEN))).status, 503);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; globalThis.Netlify = previous; }
});
