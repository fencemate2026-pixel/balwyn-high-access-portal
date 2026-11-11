import assert from "node:assert/strict";
import test from "node:test";

process.env.PORTAL_SESSION_SECRET = "macquarie-resident-test-secret-32chars";

const { createResidentCookie, readResidentSession } = await import("../lib/macquarie-session.ts");

function requestWith(cookie) {
  return new Request("https://example.com/api/macquarie", { headers: cookie ? { cookie } : {} });
}

test("a resident cookie reads back the same person", async () => {
  const header = await createResidentCookie("info@rjlcommercialgroup.com", "Jarrod Alebakis");
  const session = await readResidentSession(requestWith(header.split(";")[0]));
  assert.equal(session?.email, "info@rjlcommercialgroup.com");
  assert.equal(session?.displayName, "Jarrod Alebakis");
});

test("an operator-looking cookie is not a resident session", async () => {
  const header = await createResidentCookie("info@rjlcommercialgroup.com", "Jarrod Alebakis");
  const token = header.split(";")[0].split("=")[1];
  const swapped = requestWith(`balwyn_operator_session=${token}`);
  assert.equal(await readResidentSession(swapped), null);
});

test("a changed resident payload is rejected", async () => {
  const header = await createResidentCookie("info@rjlcommercialgroup.com", "Jarrod Alebakis");
  const token = header.split(";")[0].split("=")[1];
  const [payload, signature] = token.split(".");
  const flipped = `${payload.slice(0, -2)}${payload.endsWith("a") ? "b" : "a"}.${signature}`;
  assert.equal(await readResidentSession(requestWith(`macquarie_resident_session=${flipped}`)), null);
});
