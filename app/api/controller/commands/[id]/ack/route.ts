import { acknowledgeControllerCommand, controllerTokenValid } from "@/lib/portal-store";
import { GATES, type ReportedPosition } from "@/lib/portal-model";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as {
      gateId?: string;
      state?: "acknowledged" | "failed" | "blocked";
      position?: ReportedPosition;
      safetyOk?: boolean;
      detail?: string;
    };
    const gateId = String(body.gateId ?? "");
    const commandId = Number(id);
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!GATES.some((gate) => gate.id === gateId) || !(await controllerTokenValid(gateId, token))) {
      return Response.json({ error: "Controller authentication failed." }, { status: 401 });
    }
    const state = body.state;
    const position = String(body.position ?? "unknown") as ReportedPosition;
    if (!Number.isSafeInteger(commandId) || commandId <= 0 || !state || !new Set(["acknowledged", "failed", "blocked"]).has(state) || !new Set(["open", "closed", "moving", "unknown"]).has(position) || typeof body.safetyOk !== "boolean") {
      return Response.json({ error: "Invalid acknowledgement payload." }, { status: 400 });
    }
    await acknowledgeControllerCommand({ gateId, commandId, state, position, safetyOk: body.safetyOk, detail: body.detail });
    return Response.json({ ok: true, serverTime: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Acknowledgement failed.";
    console.error("controller acknowledgement failed", error);
    return Response.json({ error: message }, { status: message.includes("not found") ? 404 : 503 });
  }
}
