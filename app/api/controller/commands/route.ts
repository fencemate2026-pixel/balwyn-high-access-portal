import { controllerTokenValid, getNextControllerCommand, getOrCreateScheduledControllerCommand, recordHeartbeat } from "@/lib/portal-store";
import { GATES, type ReportedPosition } from "@/lib/portal-model";
import { readControllerRequest } from "@/lib/controller-request";

export async function POST(request: Request) {
  try {
    const read = await readControllerRequest(request);
    if (!read.ok) return read.response;
    const body = read.body as {
      gateId?: string;
      position?: ReportedPosition;
      safetyOk?: boolean;
      faults?: string[];
      softwareVersion?: string;
      scheduleControl?: boolean;
    };
    const gateId = String(body.gateId ?? "");
    const token = read.token;
    if (!GATES.some((gate) => gate.id === gateId) || !(await controllerTokenValid(gateId, token))) {
      return Response.json({ error: "Controller authentication failed." }, { status: 401 });
    }
    const position = String(body.position ?? "unknown") as ReportedPosition;
    if (!new Set(["open", "closed", "moving", "unknown"]).has(position) || typeof body.safetyOk !== "boolean") {
      return Response.json({ error: "Invalid controller state." }, { status: 400 });
    }
    const commissioned = await recordHeartbeat({ gateId, position, safetyOk: body.safetyOk, faults: Array.isArray(body.faults) ? body.faults.map(String) : [], softwareVersion: typeof body.softwareVersion === "string" ? body.softwareVersion : undefined });
    let command = body.safetyOk && commissioned ? await getNextControllerCommand(gateId) : null;
    if (!command && body.safetyOk && commissioned && body.scheduleControl === true) {
      command = await getOrCreateScheduledControllerCommand(gateId);
    }
    return Response.json({ command, commissioned, pollAfterMs: 750, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("controller poll failed", error);
    return Response.json({ error: "Controller command polling is temporarily unavailable." }, { status: 503 });
  }
}
