import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_PACKAGE_SCRIPTS,
  assertAllowedScript,
  assertReadableRepoPath,
  assertSafeBranchName,
} from "../mcp/repo-policy.mjs";

test("maintenance script allowlist stays limited to validation commands", () => {
  for (const script of ["build", "lint", "test", "typecheck"]) {
    assert.ok(ALLOWED_PACKAGE_SCRIPTS.has(script));
  }
  assert.throws(() => assertAllowedScript("dev", { dev: "next dev" }), /allowlist/i);
});

test("protected branches cannot be targeted by write actions", () => {
  assert.equal(assertSafeBranchName("feature/mcp"), "feature/mcp");
  assert.throws(() => assertSafeBranchName("main"), /protected/i);
  assert.throws(() => assertSafeBranchName("master"), /protected/i);
});

test("secret and runtime paths stay blocked from read-only tools", () => {
  assert.doesNotThrow(() => assertReadableRepoPath("."));
  assert.doesNotThrow(() => assertReadableRepoPath(".env.example"));
  for (const blocked of [".env", ".env.local", ".git/config", "node_modules/pkg/index.js", ".next/server/app.js"]) {
    assert.throws(() => assertReadableRepoPath(blocked), /not allowed/i);
  }
});
