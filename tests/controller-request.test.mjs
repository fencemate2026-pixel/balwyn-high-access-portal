// AUDIT_CODE P2-1 (18 Oct 2026): the shared front door for every
// gate-controller HTTP endpoint (heartbeat, command poll, acknowledgement)
// had no direct test coverage. This exercises readControllerRequest() in
// isolation: malformed/missing bearer header, oversized body (both with and
// without Content-Length, since the function itself streams and caps rather
// than trusting the header), and array/non-object JSON.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// controller-request.ts resolves lib/request-body via the "@/" tsconfig
// path alias, which only Vite's dev server (not Node's native TS loader)
// understands - the same reason every other test touching an "@/..."
// import loads it through Vite rather than a plain relative ESM import.
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { readControllerRequest } = await vite.ssrLoadModule("/lib/controller-request.ts");

const origin = "https://portal.example.test";
const validToken = "a".repeat(32);

const NO_HEADER = Symbol("no Authorization header at all");

// `auth` uses NO_HEADER rather than `undefined` as its "omit the header"
// sentinel: a destructured default parameter also applies when the
// property's VALUE is `undefined`, so passing `{ auth: undefined }` would
// silently fall back to the default valid token instead of sending no
// header - exactly the mistake this test exists to catch in the function
// under test, so the test itself must not make it.
function req(body, { auth = `Bearer ${validToken}`, headers = {}, raw } = {}) {
  const text = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const init = { method: "POST", headers: { ...(auth === NO_HEADER ? {} : { Authorization: auth }), ...headers } };
  if (text !== undefined) init.body = text;
  return new Request(`${origin}/api/controller/heartbeat`, init);
}

test("a missing or malformed bearer header is refused before the body is read", async () => {
  for (const auth of [NO_HEADER, "", "Bearer", "Bearer short", "Token abcdefghijklmnopqrstuvwxyz012345", `bearer ${validToken}`]) {
    const result = await readControllerRequest(req({ gateId: "TF-ENTRY" }, { auth }));
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 401);
    assert.equal((await result.response.json()).error, "Controller authentication failed.");
  }
});

test("a well-formed bearer token is extracted and the body is parsed", async () => {
  const result = await readControllerRequest(req({ gateId: "TF-ENTRY", position: "closed" }));
  assert.equal(result.ok, true);
  assert.equal(result.token, validToken);
  assert.deepEqual(result.body, { gateId: "TF-ENTRY", position: "closed" });
});

test("a body over 8 KB is refused with 413, with or without a Content-Length header", async () => {
  const bigValue = "x".repeat(9000);
  const withLength = await readControllerRequest(req({ gateId: bigValue }));
  assert.equal(withLength.ok, false);
  assert.equal(withLength.response.status, 413);

  // No Content-Length (e.g. chunked transfer): the function must still cap
  // the stream itself, not rely on the header.
  const text = JSON.stringify({ gateId: bigValue });
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
  const chunkedRequest = new Request(`${origin}/api/controller/heartbeat`, {
    method: "POST", headers: { Authorization: `Bearer ${validToken}` }, body: stream, duplex: "half",
  });
  const withoutLength = await readControllerRequest(chunkedRequest);
  assert.equal(withoutLength.ok, false);
  assert.equal(withoutLength.response.status, 413);
});

test("array or non-object JSON bodies are refused as invalid, not accepted", async () => {
  for (const raw of ["[1,2,3]", '"just a string"', "42", "null", "not json at all"]) {
    const result = await readControllerRequest(req(undefined, { raw }));
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 400);
    assert.equal((await result.response.json()).error, "Invalid controller message.");
  }
});

test("an empty body is accepted as an empty object (no body is sent by some callers)", async () => {
  const request = new Request(`${origin}/api/controller/heartbeat`, { method: "POST", headers: { Authorization: `Bearer ${validToken}` } });
  const result = await readControllerRequest(request);
  // No body stream at all -> readBoundedText() returns "", which is not
  // valid JSON, so this is correctly refused rather than silently treated
  // as {}.
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 400);
});
