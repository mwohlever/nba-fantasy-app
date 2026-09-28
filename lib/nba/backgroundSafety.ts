export function nbaWorkerError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [process.env.CRON_SECRET, process.env.GOLF_CRON_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY]) {
    if (secret?.trim()) message = message.split(secret.trim()).join("[redacted]");
  }
  return message.replace(/Bearer\s+[^\s,;}"']+/gi, "Bearer [redacted]")
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|secret)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[redacted]")
    .replace(/\s+/g, " ").trim().slice(0, 400) || "nba:unknown_failure";
}
