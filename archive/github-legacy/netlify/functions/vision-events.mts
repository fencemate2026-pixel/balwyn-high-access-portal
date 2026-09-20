/**
 * Proxy for balwyn-vision events.
 * Without VISION_SERVICE_URL this returns demonstration events.
 * It never pulses a gate.
 */

declare const Netlify: { env: { get: (name: string) => string | undefined } };

const DEMO = {
  source: "demo",
  actuates_gates: false,
  events: [
    {
      id: 1,
      kind: "fire_suspect",
      zone: "TF-FORECOURT",
      score: 0.0165,
      note: "Hot orange cluster. Confirm on site. Not a fire-panel input.",
      label: null,
      reviewer: null,
    },
    {
      id: 2,
      kind: "smoke_suspect",
      zone: "TF-FORECOURT",
      score: 0.0851,
      note: "Grey plume-like region. Confirm on site.",
      label: null,
      reviewer: null,
    },
  ],
};

export default async function visionEvents(request: Request) {
  const base = (Netlify.env.get("VISION_SERVICE_URL") ?? "").replace(/\/$/, "");
  const token = Netlify.env.get("VISION_SERVICE_TOKEN") ?? "";

  if (request.method === "GET") {
    if (!base) return Response.json(DEMO);
    const response = await fetch(`${base}/events`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) return Response.json(DEMO);
    const payload = await response.json();
    return Response.json({ source: "live", actuates_gates: false, events: payload.events ?? [] });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!base) {
      return Response.json({ status: "labelled", id: body.id, source: "demo", actuates_gates: false });
    }
    const response = await fetch(`${base}/events/${body.id}/label`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ label: body.label, reviewer: body.reviewer ?? "portal" }),
    });
    const payload = await response.json().catch(() => ({ status: "labelled", id: body.id }));
    return Response.json({ ...payload, actuates_gates: false });
  }

  return Response.json({ error: "GET or POST only" }, { status: 405 });
}

export const config = { method: ["GET", "POST"] };
