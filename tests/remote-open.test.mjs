import assert from "node:assert/strict";
import test from "node:test";
import { handleDoorRequest, readDoorConfiguration } from "../lib/door-open-gateway.ts";
import { GATES } from "../lib/portal-model.ts";
import { loadRemoteOpenConfig, requestRemoteOpen } from "../lib/remote-open-client.ts";

const origin = "https://portal.example.test";
const token = "0123456789abcdef0123456789abcdef";
const requestId = "01b09e77-2f6a-42c6-ab9b-16cf0a93097a";
const environment = { DOOR_SERVICE_URL: "https://pi.example.test", DOOR_SERVICE_TOKEN: token, DOOR_GATE_MAP: '{"TF-ENTRY":1,"SIDE-ENTRY":4}' };
const readEnv = (key) => environment[key];
const req = (body = { gateId: "SIDE-ENTRY" }, overrides = {}) => new Request(`${origin}/api/doors/open`, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": requestId }, body: JSON.stringify(body), ...overrides,
});
const options = (fetcher) => ({ readEnv, gates: GATES, authorize: async () => null, fetcher, log: () => {} });

test("unconfigured and legacy static demo paths make no hardware calls", async () => {
  let calls = 0;
  const config = await handleDoorRequest(new Request(`${origin}/api/doors/open`), { ...options(() => { calls++; }), readEnv: () => undefined });
  assert.deepEqual(await config.json(), { configured: false });
  assert.equal(calls, 0);
  assert.deepEqual(await loadRemoteOpenConfig("/.netlify/functions/remote-open", async () => new Response("", { status: 404 })), { configured: false });
  assert.deepEqual(await loadRemoteOpenConfig("/api/doors/open", async () => Response.json({ configured: false })), { configured: false });
});

test("configuration exposes mapping but never the Pi token or address", async () => {
  const response = await handleDoorRequest(new Request(`${origin}/api/doors/open`), options());
  const text = await response.text();
  assert.equal(JSON.parse(text).gateMap["SIDE-ENTRY"], 4);
  assert.ok(!text.includes(token));
  assert.ok(!text.includes("pi.example.test"));
});

test("invalid or partial configuration cannot select live channels", () => {
  for (const changes of [
    { DOOR_SERVICE_URL: "http://pi.example.test" }, { DOOR_SERVICE_URL: "REDACTED" },
    { DOOR_SERVICE_URL: "https://pi.example.test/other" }, { DOOR_SERVICE_TOKEN: "REDACTED" },
    { DOOR_GATE_MAP: '{"TF-ENTRY":1,"SIDE-ENTRY":1}' }, { DOOR_GATE_MAP: '{"TF-ENTRY":5}' },
    { DOOR_GATE_MAP: '{"TF-ENTRY":"1"}' }, { DOOR_GATE_MAP: '{}' }, { DOOR_GATE_MAP: '[]' },
    { DOOR_GATE_MAP: '{"NOT-A-GATE":1}' },
  ]) assert.throws(() => readDoorConfiguration((key) => ({ ...environment, ...changes })[key], GATES));
});

test("authorisation, cross-origin, unknown gates and body overrides never call the Pi", async () => {
  let calls = 0;
  const opts = options(async () => { calls++; throw new Error("Must not call"); });
  assert.equal((await handleDoorRequest(req(), { ...opts, authorize: async () => new Response("", { status: 401 }) })).status, 401);
  assert.equal((await handleDoorRequest(req({}, { headers: { Origin: "https://other.example.test" } }), opts)).status, 403);
  for (const body of [{ gateId: "SCP-B01" }, { gateId: "TF-ENTRY", door: 4 }, { gateId: "TF-ENTRY", position: "closed" }, { gateId: "__proto__" }]) {
    assert.equal((await handleDoorRequest(req(body), opts)).status, 400);
  }
  assert.equal(calls, 0);
});

test("a mapped gate sends exactly one empty POST to the correct door with server token", async () => {
  const requests = [];
  const response = await handleDoorRequest(req(), options(async (url, init) => {
    requests.push([url, init]);
    return Response.json({ status: "pulsed", door: 4, pulse_ms: 500, position: "unknown", sensor_feedback: false, request_id: requestId });
  }));
  assert.equal(response.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], "https://pi.example.test/doors/4/open");
  assert.equal(requests[0][1].headers.Authorization, `Bearer ${token}`);
  assert.equal(requests[0][1].headers["Idempotency-Key"], requestId);
  assert.equal(requests[0][1].redirect, "error");
  assert.equal(requests[0][1].body, undefined);
  const result = await response.json();
  assert.equal(result.position, "unknown");
  assert.equal(result.sensorFeedback, false);
});

test("timeouts and malformed acknowledgements never retry or claim open position", async () => {
  for (const outcome of ["timeout", "wrong_door", "false_position"]) {
    let calls = 0;
    const response = await handleDoorRequest(req(), options(async () => {
      calls++;
      if (outcome === "timeout") throw new Error("timeout");
      return Response.json({ status: "pulsed", door: outcome === "wrong_door" ? 1 : 4, pulse_ms: 500, position: outcome === "false_position" ? "open" : "unknown", sensor_feedback: false, request_id: requestId });
    }));
    assert.equal(calls, 1);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /inspect locally/i);
  }
});

test("dry-run acknowledgements stay explicitly dry-run", async () => {
  const response = await handleDoorRequest(req(), options(async () => Response.json({ status: "dry_run", door: 4, pulse_ms: 800, position: "unknown", sensor_feedback: false, request_id: requestId })));
  assert.equal((await response.json()).status, "dry_run");
});

test("accepts a commissioned open-only cycle pulse up to ten seconds", async () => {
  const response = await handleDoorRequest(req(), options(async () => Response.json({ status: "pulsed", door: 4, pulse_ms: 6000, position: "unknown", sensor_feedback: false, request_id: requestId })));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pulseMs, 6000);
});

test("client sends an explicit same-origin request, no retries, and keeps result unknown", async () => {
  const calls = [];
  const result = await requestRemoteOpen("/api/doors/open", "SIDE-ENTRY", "REDACTED", async (url, init) => {
    calls.push([url, init]);
    return Response.json({ status: "pulsed", door: 4, pulseMs: 500, position: "unknown", sensorFeedback: false, requestId: init.headers["Idempotency-Key"] });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[0][1].body), { gateId: "SIDE-ENTRY" });
  assert.equal(result.position, "unknown");
  await assert.rejects(() => requestRemoteOpen("https://other.example.test", "SIDE-ENTRY", "REDACTED"), /same-origin/);
  let failures = 0;
  await assert.rejects(() => requestRemoteOpen("/api/doors/open", "SIDE-ENTRY", "", async () => { failures++; throw new Error("Disconnected"); }));
  assert.equal(failures, 1);
});


test("gates removed from the register are dropped from the door map and can never pulse a channel", async () => {
  let calls = 0;
  const opts = { ...options(async () => { calls++; }), readEnv: (key) => ({ ...environment, DOOR_GATE_MAP: '{"TF-ENTRY":1,"TF-EXIT":4}' })[key] };
  const config = await handleDoorRequest(new Request(`${origin}/api/doors/open`), opts);
  assert.deepEqual((await config.json()).gateMap, { "TF-ENTRY": 1 });
  const response = await handleDoorRequest(req({ gateId: "TF-EXIT" }), opts);
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("a registered but inactive gate still cannot pulse its mapped channel", async () => {
  let calls = 0;
  const gates = [...GATES, { ...GATES[0], id: "RETIRED-GATE", active: false }];
  const opts = { ...options(async () => { calls++; }), gates, readEnv: (key) => ({ ...environment, DOOR_GATE_MAP: '{"TF-ENTRY":1,"RETIRED-GATE":4}' })[key] };
  const response = await handleDoorRequest(req({ gateId: "RETIRED-GATE" }), opts);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /inactive/i);
  assert.equal(calls, 0);
});

test("the Equipment switch can only disable remote open, and the relay mapping always comes from the server setting", async () => {
  const { remoteOpenEnvironment } = await import("../lib/door-open-gateway.ts");
  // Enabled: the server environment is used unchanged.
  assert.deepEqual(readDoorConfiguration(remoteOpenEnvironment(readEnv, true), GATES).gateMap, { "TF-ENTRY": 1, "SIDE-ENTRY": 4 });
  // Disabled, or the setting could not be read: the path is unconfigured and makes no hardware call.
  for (const enabled of [false, null]) {
    let calls = 0;
    const reader = remoteOpenEnvironment(readEnv, enabled);
    assert.equal(readDoorConfiguration(reader, GATES), null);
    const config = await handleDoorRequest(new Request(`${origin}/api/doors/open`), { ...options(() => { calls++; }), readEnv: reader });
    assert.deepEqual(await config.json(), { configured: false });
    const pulse = await handleDoorRequest(req(), { ...options(() => { calls++; }), readEnv: reader });
    assert.equal(pulse.status, 503);
    assert.equal(calls, 0);
  }
});
