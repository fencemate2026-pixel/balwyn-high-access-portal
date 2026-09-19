/** Server-only bridge to the Pi HTTP service. Never import this into a client component. */
type EnvironmentReader = (key: string) => string | undefined;
type GateRegistration = { id: string; active: boolean };
type GatewayOptions = {
  readEnv: EnvironmentReader;
  gates: readonly GateRegistration[];
  authorize: (request: Request) => Promise<Response | null>;
  operatorTokenRequired?: boolean;
  fetcher?: typeof fetch;
  log?: (event: Record<string, unknown>) => void;
};

const GATE_ID = /^(TF-(ENTRY|EXIT)|SIDE-ENTRY|SCP-B(0[1-9]|1[0-2])|FRONT-DG0[1-3])$/;

export function readDoorConfiguration(read: EnvironmentReader) {
  const url = read("DOOR_SERVICE_URL")?.trim() ?? "";
  const token = read("DOOR_SERVICE_TOKEN") ?? "";
  const rawMap = read("DOOR_GATE_MAP")?.trim() ?? "";
  if (!url && !token && !rawMap) return null;
  const base = new URL(url);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("Configure an HTTPS service origin without credentials, path, query or fragment");
  }
  if (!/^[\x21-\x7e]{32,}$/.test(token)) throw new Error("Configure the private Pi token");
  const gateMap = JSON.parse(rawMap) as Record<string, number>;
  if (!gateMap || Array.isArray(gateMap) || typeof gateMap !== "object") throw new Error("Invalid door mapping");
  const entries = Object.entries(gateMap);
  if (entries.length < 1 || entries.length > 4 || new Set(entries.map(([, door]) => door)).size !== entries.length ||
      entries.some(([gate, door]) => !GATE_ID.test(gate) || !Number.isInteger(door) || door < 1 || door > 4)) {
    throw new Error("Map one to four distinct verified gates to unique door numbers 1..4");
  }
  return { origin: base.origin, token, gateMap };
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleDoorRequest(request: Request, options: GatewayOptions): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
  if (request.method === "POST" && (new URL(request.url).protocol !== "https:" || request.headers.get("Origin") !== new URL(request.url).origin || ["cross-site", "same-site", "none"].includes(request.headers.get("Sec-Fetch-Site") ?? ""))) {
    return json({ error: "Request rejected" }, 403);
  }
  const denied = await options.authorize(request);
  if (denied) return denied;
  let config;
  try { config = readDoorConfiguration(options.readEnv, options.gates); }
  catch { return json({ error: "Remote open configuration is incomplete; contact the administrator" }, 503); }
  if (request.method === "GET") {
    const gateMap = config && Object.fromEntries(Object.entries(config.gateMap).filter(([id]) => options.gates.some((gate) => gate.id === id && gate.active)));
    return json(config ? { configured: true, gateMap, operatorTokenRequired: options.operatorTokenRequired === true, sensorFeedback: false } : { configured: false });
  }
  if (!config) return json({ error: "Remote open is not configured" }, 503);
  const requestId = request.headers.get("Idempotency-Key") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) return json({ error: "A request ID is required" }, 400);
  let gateId: string;
  try {
    if (Number(request.headers.get("Content-Length")) > 1024) throw new Error();
    const text = await request.text();
    if (text.length > 1024) throw new Error();
    const body = JSON.parse(text);
    if (!body || Object.keys(body).length !== 1 || typeof body.gateId !== "string") throw new Error();
    gateId = body.gateId;
  } catch { return json({ error: "Supply a gateId only" }, 400); }
  if (!Object.hasOwn(config.gateMap, gateId)) return json({ error: "No verified door channel is assigned to this gate" }, 400);
  if (!options.gates.some((gate) => gate.id === gateId && gate.active)) return json({ error: "This gate is inactive. Remote open is blocked until activation." }, 403);
  const door = config.gateMap[gateId];
  const log = options.log ?? ((event) => console.info("remote_open", event));
  log({ event: "requested", gateId, door, requestId });
  try {
    // One HTTP request, no redirects and no automatic retry. A timeout may follow a physical pulse.
    const response = await (options.fetcher ?? fetch)(`${config.origin}/doors/${door}/open`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${config.token}`, "Idempotency-Key": requestId },
    });
    if (!response.ok) {
      log({ event: "rejected_or_uncertain", gateId, door, requestId, status: response.status });
      return json({ error: "Remote open was rejected or its outcome is unknown. Inspect locally before another request", requestId }, response.status === 409 ? 409 : 502);
    }
    const result = await response.json();
    if (!["pulsed", "dry_run"].includes(result.status) || result.door !== door || result.position !== "unknown" || result.sensor_feedback !== false || result.request_id !== requestId || !Number.isInteger(result.pulse_ms) || result.pulse_ms < 300 || result.pulse_ms > 800) throw new Error("Invalid pulse acknowledgement");
    log({ event: result.status, gateId, door, requestId });
    return json({ status: result.status, door, pulseMs: result.pulse_ms, position: "unknown", sensorFeedback: false, requestId, replayed: result.replayed === true });
  } catch {
    log({ event: "outcome_unknown", gateId, door, requestId });
    return json({ error: "No verified pulse acknowledgement. The door may have received the trigger; inspect locally before retrying", requestId }, 502);
  }
}
