"use client";
import type { NbaLiveContext } from "./nbaContext";
import { useCallback, useEffect, useRef, useState } from "react";

export type LiveRequestIdentity = Readonly<{
  viewerId: string; groupId: string; leagueId: string; resource: string;
} & (
  | { sport: "nba"; context: NbaLiveContext }
  | { sport: "nfl"; context: "nfl" }
  | { sport: "golf"; context: "golf" }
)>;
/** Each invocation has both an immutable identity and a monotonic generation.
 * Aborting alone is insufficient (e.g. A → B → A, or providers ignoring abort). */
export function useLiveRequest<T>(identity: LiveRequestIdentity | null, url: string | null, validate?: (body: T) => string | null) {
  const key = identity && url ? JSON.stringify([identity.viewerId, identity.groupId, identity.leagueId,
    identity.context, identity.sport, identity.resource, url]) : null;
  const currentKey = useRef(key); currentKey.current = key;
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ key: string; data: T | null; error: string; pending: boolean } | null>(null);
  const load = useCallback(async (initial = false) => {
    if (!key || !url || currentKey.current !== key) return;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const token = ++generation.current;
    const matches = () => !controller.signal.aborted && currentKey.current === key && generation.current === token;
    setResult(previous => ({ key, data: !initial && previous?.key === key ? previous.data : null, error: "", pending: true }));
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load NBA Live.");
      const invalid = validate?.(body as T);
      if (invalid) throw new Error(invalid);
      if (matches()) setResult({ key, data: body as T, error: "", pending: false });
    } catch (reason) {
      if (matches()) setResult(previous => ({ key, data: previous?.key === key ? previous.data : null,
        error: reason instanceof Error ? reason.message : "Unable to load NBA Live.", pending: false }));
    } finally { if (matches()) abort.current = null; }
  }, [key, url, validate]);
  const cancel = useCallback(() => {
    ++generation.current; abort.current?.abort(); abort.current = null;
  }, []);
  useEffect(() => {
    if (key) void load(true);
    return cancel;
  }, [key, load, cancel]);
  const visible = key && result?.key === key ? result : null;
  return { data: visible?.data ?? null, error: visible?.error ?? "",
    loading: Boolean(key && (!visible || (visible.pending && !visible.data))),
    refreshing: Boolean(visible?.pending && visible.data), refresh: load };
}
