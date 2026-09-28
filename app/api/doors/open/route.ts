import { env } from "@/lib/server-env";
import { requireOperator } from "@/lib/portal-auth";
import { getPortalSnapshot } from "@/lib/portal-store";
import { handleDoorRequest, remoteOpenEnvironment } from "@/lib/door-open-gateway";
import { readEquipment } from "@/lib/equipment-store";
import { GATES } from "@/lib/portal-model";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  // Read only after the operator is authorised; null (unreadable) fails closed.
  let remoteOpenEnabled: boolean | null = null;
  const runtime = (key: string) => { const value = (env as unknown as Record<string, unknown>)[key]; return typeof value === "string" ? value : undefined; };
  return handleDoorRequest(request, {
    gates: GATES,
    readEnv: (key) => remoteOpenEnvironment(runtime, remoteOpenEnabled)(key),
    authorize: async (req) => {
      const auth = await requireOperator(req, req.method === "GET" ? "viewer" : "operator");
      if (!auth.user) return auth.response;
      try { remoteOpenEnabled = (await readEquipment()).remoteOpenEnabled; } catch { remoteOpenEnabled = null; }
      if (req.method === "POST") {
        try {
          const snapshot = await getPortalSnapshot(auth.user);
          if (snapshot.systemMode !== "normal") return Response.json({ error: "Manual remote open is blocked by emergency priority" }, { status: 409 });
        } catch { return Response.json({ error: "Operating priority could not be verified" }, { status: 503 }); }
      }
      return null;
    },
  });
}

export const GET = handle;
export const POST = handle;
