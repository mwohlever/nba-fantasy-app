import { nflSlateWindow, nflTeamCode } from "@/lib/live-scores/nflFantasyGames";
import { fetchNflScoringSchedule } from "@/lib/providers/nfl";
import { loadNflPlayers } from "./playerCatalog.server";

/** Schedule membership is specific to the selected slate, never the current-week flag. */
export async function loadNflSlateAvailability(slate: {
  date: string;
  start_date?: string | null;
  end_date?: string | null;
}) {
  const window = nflSlateWindow(slate);
  if (!window) throw new Error("Invalid NFL slate schedule window.");
  // The daily reader rejects failed/incomplete provider responses. ESPN's NFL
  // scoreboard does not support date ranges; silently empty fallback is unsafe here.
  const events = await fetchNflScoringSchedule(
    window.start.replaceAll("-", ""), window.end.replaceAll("-", ""),
  );
  const teams = new Set<string>();
  for (const event of events) {
    // Monday night can fall on Tuesday in UTC and still belongs to Monday's slate.
    const day = new Date(event.date).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (day < window.start || day > window.end) continue;
    for (const competitor of event.competitions?.[0]?.competitors ?? []) {
      const code = nflTeamCode(competitor.team?.abbreviation);
      if (code) teams.add(code);
    }
  }
  const teamAbbreviations = [...teams].sort();
  if (teams.size === 0) return { ...window, teamAbbreviations, availablePlayerIds: [] as number[] };
  const { data, error } = await loadNflPlayers<{ id: number; team_abbreviation: string | null }>(
    "id, team_abbreviation", { activeOnly: true },
  );
  if (error) throw new Error(error.message);
  return {
    ...window,
    teamAbbreviations,
    availablePlayerIds: data.filter(player => teams.has(nflTeamCode(player.team_abbreviation))).map(player => Number(player.id)),
  };
}
