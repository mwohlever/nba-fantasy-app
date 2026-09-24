const MAX_ERROR_LENGTH = 400;

/** Keep provider/database errors useful without retaining credentials or large payloads. */
export function bracketSyncErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const secret = process.env.CRON_SECRET?.trim();
  let message = secret ? raw.split(secret).join("[redacted]") : raw;
  message = message
    .replace(/(Bearer\s+)[^\s,;}"']+/gi, "$1[redacted]")
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|secret)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return message.slice(0, MAX_ERROR_LENGTH) || "Unknown Bracket sync failure.";
}
