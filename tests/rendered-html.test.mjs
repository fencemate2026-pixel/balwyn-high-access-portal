import assert from "node:assert/strict";
import test from "node:test";

// The client build must NOT advertise itself as a development preview. This
// page is shown to the client; a "development" marker (and the name of the
// tool that generated it) has no place in the shipped HTML.
const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])[^>]*>/i;

test("does not leak development preview metadata into the rendered page", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.doesNotMatch(await response.text(), developmentPreviewMeta);
});
