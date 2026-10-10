import { controllerTokenValid, recordHeartbeat } from "@/lib/portal-store";
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
    };
    const gateId = String(body.gateId ?? "");
    const token = read.token;
    if (!GATES.some((gate) => gate.id === gateId) || !(await controllerTokenValid(gateId, token))) {
      return Response.json({ error: "Controller authentication failed." }, { status: 401 });
    }
    const position = String(body.position ?? "unknown") as ReportedPosition;
    if (!new Set(["open", "closed", "moving", "unknown"]).has(position) || typeof body.safetyOk !== "boolean") {
      return Response.json({ error: "Invalid heartbeat payload." }, { status: 400 });
    }
    await recordHeartbeat({
      gateId,
      position,
      safetyOk: body.safetyOk,
      faults: Array.isArray(body.faults) ? body.faults.map(String) : [],
      softwareVersion: typeof body.softwareVersion === "string" ? body.softwareVersion : undefined,
    });
    return Response.json({ ok: true, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error("controller heartbeat failed", error);
    return Response.json({ error: "Heartbeat could not be recorded." }, { status: 503 });
  }
}
