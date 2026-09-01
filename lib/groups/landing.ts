import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { GroupContext } from "@/lib/groups/context";
import { sportKeyFromLeagueSportKey } from "@/lib/sports";

export type GroupGameSummary = {
  leagueId: string;
  sportKey: string;
  name: string;
  href: string;
  statusLabel: string;
  detail: string;
};

function gameHref(sportKey: string) {
  if (sportKey === "ncaa") return "/ncaa-pickem";
  if (sportKey === "nba-skins") return "/nba-skins";
  return `/home?sport=${encodeURIComponent(sportKey)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Schedule coming soon";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export async function getGroupGameSummaries(
  context: GroupContext,
): Promise<GroupGameSummary[]> {
  const fantasyLeagues = context.leagues.filter((league) =>
    ["nba", "nfl", "golf"].includes(league.sportKey),
  );
  const ncaaLeagueIds = context.leagues
    .filter((league) => league.sportKey === "ncaa_pickem")
    .map((league) => league.id);
  const skinsLeagueIds = context.leagues
    .filter((league) => league.sportKey === "nba_skins")
    .map((league) => league.id);

  const [slatesResult, weeksResult, seasonsResult] = await Promise.all([
    fantasyLeagues.length
      ? supabaseAdmin
          .from("slates")
          .select("id, league_id, display_name, date, start_date, end_date, is_locked")
          .in("league_id", fantasyLeagues.map((league) => league.id))
          .order("start_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    ncaaLeagueIds.length
      ? supabaseAdmin
          .from("ncaa_pickem_weeks")
          .select("id, league_id, season, week_number, label, lock_at, status")
          .in("league_id", ncaaLeagueIds)
          .order("season", { ascending: false })
          .order("week_number", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    skinsLeagueIds.length
      ? supabaseAdmin
          .from("nba_skins_seasons")
          .select("id, league_id, season, status")
          .in("league_id", skinsLeagueIds)
          .order("season", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error = slatesResult.error ?? weeksResult.error ?? seasonsResult.error;
  if (error) throw new Error(`Failed to load Group game summary: ${error.message}`);

  const today = new Date().toISOString().slice(0, 10);
  return context.leagues.map((league) => {
    const sportKey = sportKeyFromLeagueSportKey(league.sportKey);

    if (["nba", "nfl", "golf"].includes(sportKey)) {
      const rows = (slatesResult.data ?? []).filter((row) => row.league_id === league.id);
      const current = rows.find((row) => {
        const start = row.start_date ?? row.date;
        const end = row.end_date ?? start;
        return start <= today && end >= today;
      });
      const next = [...rows]
        .filter((row) => (row.start_date ?? row.date) > today)
        .sort((a, b) => (a.start_date ?? a.date).localeCompare(b.start_date ?? b.date))[0];
      const selected = current ?? next ?? rows[0];
      const baseLabel = selected?.display_name || (selected ? formatDate(selected.start_date ?? selected.date) : "No slate scheduled");
      const label = next && selected?.id === next.id
        ? `${sportKey === "golf" ? "Next tournament" : "Next draft"} · ${baseLabel}`
        : baseLabel;
      return {
        leagueId: league.id,
        sportKey,
        name: league.name,
        href: gameHref(sportKey),
        statusLabel: selected?.is_locked ? "Final" : current ? "Current" : next ? "Upcoming" : selected ? "Latest" : "Ready",
        detail: label,
      };
    }

    if (sportKey === "ncaa") {
      const week = (weeksResult.data ?? []).find((row) => row.league_id === league.id);
      return {
        leagueId: league.id,
        sportKey,
        name: league.name,
        href: gameHref(sportKey),
        statusLabel: week?.status === "open" ? "Picks open" : week ? "Current" : "Ready",
        detail: week?.label || (week ? `Week ${week.week_number}` : "No week scheduled"),
      };
    }

    const season = (seasonsResult.data ?? []).find((row) => row.league_id === league.id);
    return {
      leagueId: league.id,
      sportKey,
      name: league.name,
      href: gameHref(sportKey),
      statusLabel: season?.status === "active" ? "Active" : season ? "Season" : "Ready",
      detail: season ? `${season.season} season` : "No season scheduled",
    };
  });
}
