export async function readSignInBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > 8192) throw new Error("Invalid sign-in request.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new Error("Invalid sign-in request."); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const body: unknown = JSON.parse(text);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid sign-in request.");
  return body as Record<string, unknown>;
}
