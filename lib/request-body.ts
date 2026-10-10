/**
 * Byte-capped request body reader (10 Oct 2026 review).
 *
 * A Content-Length check alone does not stop a chunked upload with no length
 * header, which request.text() would read in full. This reads the stream and
 * stops as soon as the cap is passed. Returns null when the body is too large
 * or is not valid UTF-8.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; }
}
