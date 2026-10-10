import { acknowledgeControllerCommand, controllerTokenValid } from "@/lib/portal-store";
import { GATES, type ReportedPosition } from "@/lib/portal-model";
import { readControllerRequest } from "@/lib/controller-request";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const read = await readControllerRequest(request);
    if (!read.ok) return read.response;
    const body = read.body as {
      gateId?: string;
      state?: "acknowledged" | "failed" | "blocked";
      position?: ReportedPosition;
      safetyOk?: boolean;
      detail?: string;
    };
    const gateId = String(body.gateId ?? "");
    const commandId = Number(id);
    const token = read.token;
    if (!GATES.some((gate) => gate.id === gateId) || !(await controllerTokenValid(gateId, token))) {
      return Response.json({ error: "Controller authentication failed." }, { status: 401 });
    }
    const state = body.state;
    const position = String(body.position ?? "unknown") as ReportedPosition;
    if (!Number.isSafeInteger(commandId) || commandId <= 0 || !state || !new Set(["acknowledged", "failed", "blocked"]).has(state) || !new Set(["open", "closed", "moving", "unknown"]).has(position) || typeof body.safetyOk !== "boolean") {
      return Response.json({ error: "Invalid acknowledgement payload." }, { status: 400 });
    }
    await acknowledgeControllerCommand({ gateId, commandId, state, position, safetyOk: body.safetyOk, detail: typeof body.detail === "string" ? body.detail.slice(0, 500) : undefined });
    return Response.json({ ok: true, serverTime: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error("controller acknowledgement failed", error);
    // Fixed messages only: database detail stays in the server log.
    return message.includes("not found")
      ? Response.json({ error: "Command not found." }, { status: 404 })
      : Response.json({ error: "Acknowledgement could not be recorded." }, { status: 503 });
  }
}
