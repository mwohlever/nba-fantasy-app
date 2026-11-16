import type { CenterLoader, ProfileRequest } from "./data";
import type { CenterProfile } from "@/lib/player-center/presentation";

/** Complete only the displayed older NFL appearances, in bounded, read-only batches.
 * The initial request remains five recent summaries; expanding history opts into more.
 */
export async function loadVisibleGameStats(loader: CenterLoader, request: ProfileRequest, signal: AbortSignal, limit: number): Promise<CenterProfile> {
  let profile = await loader.profile(request, signal);
  const verify = (next: CenterProfile) => {
    if (next.player.playerId !== request.playerId || next.player.sport !== request.sport || next.season !== request.season || next.phase !== (request.phase ?? "regular")) throw new Error("Player game context changed.");
  };
  verify(profile);
  if (request.sport !== "nfl" || profile.player.position === "K" || profile.player.identity !== "resolved") return profile;
  const cutoff = Date.parse(profile.asOf);
  const visible = [...profile.games].filter(game => Date.parse(game.gameAt) <= cutoff)
    .sort((a, b) => b.gameAt.localeCompare(a.gameAt)).slice(0, limit);
  const pending = visible.filter(game => game.participation === "played" && !["scheduled", "live"].includes(game.status) && profile.gameFantasyPoints[game.eventId] == null).map(game => game.eventId);
  const originalGroup = (profile as CenterProfile & { groupId?: string }).groupId;
  for (let offset = 0; offset < pending.length; offset += 5) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const next = await loader.profile({ ...request, events: pending.slice(offset, offset + 5).join(",") }, signal);
      verify(next);
      if ((next as CenterProfile & { groupId?: string }).groupId !== originalGroup) throw new Error("Player game Group changed.");
      profile = next;
    } catch (error) {
      if (signal.aborted) throw error;
      // Keep known facts and visibly incomplete rows when ESPN cannot verify more.
      return { ...profile, coverage: { ...profile.coverage, issues: [...profile.coverage.issues, "older_game_statistics_unavailable"] } };
    }
  }
  return profile;
}
