import { timingSafeEqual } from "node:crypto";
import { handleDoorRequest } from "../../lib/door-open-gateway";

// Netlify supplies this global at runtime; no browser environment contains these secrets.
declare const Netlify: { env: { get: (name: string) => string | undefined } };

export default async function remoteOpen(request: Request) {
  return handleDoorRequest(request, {
    readEnv: (name) => Netlify.env.get(name),
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
