import type { CenterProfile } from "@/lib/player-center/presentation";
import type { PlayerCenterService } from "@/lib/player-center/service";
import type { CenterPhase, CenterSport, CenterWindow } from "@/lib/player-center/types";
export type ComparisonData = Awaited<ReturnType<PlayerCenterService["comparisons"]>>;
export type ProfileRequest = { sport: CenterSport; playerId: number; season: number; slateId?: number | null; phase?: CenterPhase };
export type ComparisonRequest = { sport: CenterSport; season: number; window: CenterWindow; metric: string; ascending: boolean; position?: string; slateId?: number | null };
export type CenterLoader = {
  profile: (request: ProfileRequest, signal: AbortSignal) => Promise<CenterProfile>;
  comparisons: (request: ComparisonRequest, signal: AbortSignal) => Promise<ComparisonData>;
};
export async function readCenter<T>(path: string, params: Record<string, string | number | null | undefined>, signal: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) query.set(key, String(value));
  const response = await fetch(`${path}?${query}`, { signal, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Player statistics could not be loaded.");
  return body as T;
}
export const realCenterLoader: CenterLoader = {
  profile: (request, signal) => readCenter("/api/player-center", request, signal),
  comparisons: ({ ascending, ...request }, signal) => readCenter("/api/player-center/comparisons", { ...request, direction: ascending ? "asc" : "desc" }, signal),
};
