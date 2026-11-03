// Structural guard for the controller failed-token limit (4 Nov 2026 audit): every controller
// endpoint must check the block BEFORE verifying the token and must record failures through
// controllerAuthFailed. Reading the source keeps this independent of a live database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = [
  "app/api/controller/heartbeat/route.ts",
  "app/api/controller/commands/route.ts",
  "app/api/controller/commands/[id]/ack/route.ts",
];

for (const route of routes) {
  test(`${route} blocks repeat failures before checking the token`, () => {
    const src = readFileSync(new URL(`../${route}`, import.meta.url), "utf8");
    const block = src.indexOf("controllerFailureBlock(request)");
    const check = src.indexOf("controllerTokenValid(gateId, token)");
    assert.ok(block > 0 && check > block, "block check must come before token verification");
    assert.match(src, /return controllerAuthFailed\(request\)/);
    assert.doesNotMatch(src, /Controller authentication failed\."[^)]*status: 401 \}\);\s*\n\s*\}\s*\n\s*const (position|state)/);
  });
}

test("limit is 20 failures per 10 minutes", () => {
  const src = readFileSync(new URL("../lib/controller-request.ts", import.meta.url), "utf8");
  assert.match(src, /CONTROLLER_FAIL_MAX = 20/);
  assert.match(src, /CONTROLLER_FAIL_WINDOW_MS = 10 \* 60 \* 1000/);
});
