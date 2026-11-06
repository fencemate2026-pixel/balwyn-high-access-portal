// Safe, loggable name for a database failure. Returns a SQLSTATE or a short
// transport/TLS identifier only (28P01 wrong password, 28000 firewall,
// ECONNREFUSED, ETIMEDOUT, UNABLE_TO_VERIFY_LEAF_SIGNATURE, ...). Never the message:
// it can carry the host or row data. Never the connection string.
export function safeFailureCode(failure: unknown): string {
  if (!failure || typeof failure !== "object" || !("code" in failure) || typeof failure.code !== "string") return "unknown";
  if (/^[0-9A-Z]{5}$/.test(failure.code) || /^[A-Z][A-Z0-9_]{1,40}$/.test(failure.code)) return failure.code;
  return "unknown";
}

// pg reports its own connection timeout without a code; name it so it is not "unknown".
export function directFailureCode(failure: unknown): string {
  const code = safeFailureCode(failure);
  return code === "unknown" && failure instanceof Error && /timeout/i.test(failure.message) ? "CONNECTION_TIMEOUT" : code;
}
