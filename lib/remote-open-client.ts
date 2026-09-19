export type RemoteOpenConfig = { configured: boolean; gateMap?: Record<string, number>; operatorTokenRequired?: boolean };
export type RemoteOpenResult = { status: "pulsed" | "dry_run"; door: number; pulseMs: number; position: "unknown"; sensorFeedback: false; requestId: string };

function localEndpoint(endpoint: string) {
  if (!/^\/(?!\/)[a-zA-Z0-9_/.\-]+$/.test(endpoint)) throw new Error("Remote open requires a same-origin endpoint");
  return endpoint;
}

export async function loadRemoteOpenConfig(endpoint: string, fetcher: typeof fetch = fetch): Promise<RemoteOpenConfig> {
  const response = await fetcher(localEndpoint(endpoint), { cache: "no-store", credentials: "same-origin" });
  // The older static demo has no gateway in ordinary local preview.
  if (response.status === 404) return { configured: false };
  if (!response.ok) throw new Error("Remote open configuration is unavailable");
  const result = await response.json();
  if (result.configured === false) return { configured: false };
  if (result.configured !== true || !result.gateMap || typeof result.gateMap !== "object" || Array.isArray(result.gateMap)) throw new Error("Invalid remote open configuration");
  return result;
}

export async function requestRemoteOpen(endpoint: string, gateId: string, operatorToken = "", fetcher: typeof fetch = fetch): Promise<RemoteOpenResult> {
  const requestId = crypto.randomUUID();
  const target = localEndpoint(endpoint);
  const response = await fetcher(target, {
    method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId, ...(operatorToken ? { Authorization: `Bearer ${operatorToken}` } : {}) },
    body: JSON.stringify({ gateId }),
  }).catch(() => { throw new Error("Pulse outcome unknown after a connection failure. Inspect locally before retrying"); });
  const result = await response.json().catch(() => { throw new Error("Pulse acknowledgement could not be read. Inspect locally before retrying"); });
  if (!response.ok) throw new Error(result.error || "Pulse outcome unknown; inspect locally before retrying");
  if (!["pulsed", "dry_run"].includes(result.status) || result.position !== "unknown" || result.sensorFeedback !== false || result.requestId !== requestId) throw new Error("Pulse acknowledgement could not be verified; inspect locally");
  return result;
}
