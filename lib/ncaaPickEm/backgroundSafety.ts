import { timingSafeEqual } from "node:crypto";

/** Keep the existing heartbeat secret working; use CRON_SECRET for new Vault jobs. */
export function authorizeNcaaCron(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const actual = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  return [process.env.CRON_SECRET, process.env.GOLF_CRON_SECRET].some(value => {
    const expected = Buffer.from(value?.trim() ?? "");
    return expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

export function ncaaWorkerError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [process.env.CRON_SECRET, process.env.GOLF_CRON_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY])
    if (secret?.trim()) message = message.split(secret.trim()).join("[redacted]");
  return message.replace(/(Bearer\s+)[^\s,;}"']+/gi, "$1[redacted]")
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|secret)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[redacted]")
    .replace(/\s+/g, " ").trim().slice(0, 400) || "Unknown NCAAF worker failure.";
}
