import { controllerTokenValid, getNextControllerCommand, getOrCreateScheduledControllerCommand, noteScheduleControlOff, recordHeartbeat } from "@/lib/portal-store";
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
      cpuTempC?: number;
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
    const commissioned = await recordHeartbeat({ gateId, position, safetyOk: body.safetyOk, faults: Array.isArray(body.faults) ? body.faults.map(String) : [], softwareVersion: typeof body.softwareVersion === "string" ? body.softwareVersion : undefined, cpuTempC: typeof body.cpuTempC === "number" ? body.cpuTempC : null });
    // An unhealthy safety input never receives an OPEN, but it may receive a CLOSE (releases a hold).
    let command = commissioned ? await getNextControllerCommand(gateId, { closeOnly: !body.safetyOk }) : null;
    if (!command && body.safetyOk && commissioned && body.scheduleControl === true) {
      command = await getOrCreateScheduledControllerCommand(gateId);
    } else if (!command && body.safetyOk && commissioned && body.scheduleControl === false) {
      await noteScheduleControlOff(gateId);
    }
    return Response.json({ command, commissioned, pollAfterMs: 750, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("controller poll failed", error);
    return Response.json({ error: "Controller command polling is temporarily unavailable." }, { status: 503 });
  }
}
