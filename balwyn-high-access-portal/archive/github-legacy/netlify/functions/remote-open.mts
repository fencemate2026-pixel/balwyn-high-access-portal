import { timingSafeEqual } from "node:crypto";
import { handleDoorRequest } from "../../lib/door-open-gateway";

// Netlify supplies this global at runtime; no browser environment contains these secrets.
declare const Netlify: { env: { get: (name: string) => string | undefined } };

// Verified gate IDs for the static demo deployment. All are treated as active;
// there is no separate "activation" workflow for this legacy Netlify path.
const GATES = [
  { id: "TF-ENTRY", active: true },
  { id: "TF-EXIT", active: true },
  { id: "SCP-B01", active: true },
  { id: "SCP-B02", active: true },
  { id: "SCP-B03", active: true },
  { id: "SCP-B04", active: true },
  { id: "SCP-B05", active: true },
  { id: "SCP-B06", active: true },
  { id: "SCP-B07", active: true },
  { id: "SCP-B08", active: true },
  { id: "SCP-B09", active: true },
  { id: "SCP-B10", active: true },
  { id: "SCP-B11", active: true },
  { id: "SCP-B12", active: true },
  { id: "FRONT-DG01", active: true },
  { id: "FRONT-DG02", active: true },
  { id: "FRONT-DG03", active: true },
] as const;

export default async function remoteOpen(request: Request) {
  return handleDoorRequest(request, {
    readEnv: (name) => Netlify.env.get(name),
    gates: GATES,
    operatorTokenRequired: true,
    authorize: async (req) => {
      if (req.method === "GET") return null; // Returns only channel labels, never a token or network address.
      const secret = Netlify.env.get("DOOR_OPERATOR_TOKEN") ?? "";
      if (!/^[\x21-\x7e]{32,}$/.test(secret) || secret === Netlify.env.get("DOOR_SERVICE_TOKEN")) {
        return Response.json({ error: "A separate remote-open operator credential must be configured" }, { status: 503 });
      }
      const expected = Buffer.from(`Bearer ${secret}`);
      const supplied = Buffer.from(req.headers.get("Authorization") ?? "");
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return Response.json({ error: "A valid remote-open operator token is required; the demo login does not authorise hardware" }, { status: 401 });
      }
      return null;
    },
  });
}

export const config = { method: ["GET", "POST"] };
