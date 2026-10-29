export class ReadBudget {
  used = 0;
  constructor(readonly max = 8, readonly deadline = Date.now() + 18_000) {}
  consume(now = Date.now()) {
    if (this.used >= this.max || now >= this.deadline) throw new Error("provider_request_budget");
    this.used++;
  }
}
export type CachedRead<T> = {
  value: T | null; fetchedAt: string | null; freshness: "fresh" | "stale" | "unavailable";
  error: string | null;
};
type Entry<T> = { value: T | null; fetchedAt: number | null; expires: number; retryAfter: number; staleUntil: number; error: string | null };

/** Bounded process-local raw-data cache. No Group identity, rules, or fantasy scores. */
export class BoundedReadCache<T> {
  private entries = new Map<string, Entry<T>>();
  private pending = new Map<string, Promise<CachedRead<T>>>();
  private active = 0;
  private misses: number[] = [];
  constructor(private readonly capacity = 128, private readonly now: () => number = Date.now,
    private readonly maxConcurrent = 3, private readonly maxPerMinute = 40) {}

  async read(key: string, load: () => Promise<T>, ttl: number, budget: ReadBudget): Promise<CachedRead<T>> {
    const now = this.now(), entry = this.entries.get(key);
    const result = (e: Entry<T>, error = e.error): CachedRead<T> => ({ value: e.value,
      fetchedAt: e.fetchedAt === null ? null : new Date(e.fetchedAt).toISOString(),
      freshness: e.value === null ? "unavailable" : e.expires > this.now() ? "fresh" : "stale", error });
    if (entry && (entry.expires > now || entry.retryAfter > now) && (entry.value === null || entry.staleUntil > now)) return result(entry);
    const pending = this.pending.get(key);
    if (pending) return pending;
    this.misses = this.misses.filter(time => time > now - 60_000);
    if (this.active >= this.maxConcurrent || this.misses.length >= this.maxPerMinute) {
      return entry && entry.staleUntil > now ? result(entry, "provider_rate_limit") : { value: null, fetchedAt: null, freshness: "unavailable", error: "provider_rate_limit" };
    }
    try { budget.consume(now); } catch {
      return entry && entry.staleUntil > now ? result(entry, "provider_request_budget") : { value: null, fetchedAt: null, freshness: "unavailable", error: "provider_request_budget" };
    }
    this.active++;
    this.misses.push(now);
    const work = (async () => {
      try {
        const value = await Promise.resolve().then(load), fetchedAt = this.now();
        const next: Entry<T> = { value, fetchedAt, expires: fetchedAt + ttl, staleUntil: fetchedAt + ttl + 86_400_000, retryAfter: 0, error: null };
        this.put(key, next);
        return result(next);
      } catch {
        const failedAt = this.now();
        const next: Entry<T> = entry && entry.staleUntil > failedAt ? { ...entry, retryAfter: failedAt + 30_000, error: "provider_unavailable_or_invalid" }
          : { value: null, fetchedAt: null, expires: 0, staleUntil: 0, retryAfter: failedAt + 30_000, error: "provider_unavailable_or_invalid" };
        this.put(key, next);
        return result(next);
      } finally { this.active--; this.pending.delete(key); }
    })();
    this.pending.set(key, work);
    return work;
  }
  private put(key: string, value: Entry<T>) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}
