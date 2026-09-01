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

export type GroupPulseFact = {
  label: string;
  value: string;
};

export type GroupLandingData = {
  games: GroupGameSummary[];
  pulse: GroupPulseFact[];
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

export async function getGroupLandingData(
  context: GroupContext,
): Promise<GroupLandingData> {
  const fantasyLeagues = context.leagues.filter((league) =>
    ["nba", "nfl", "golf"].includes(league.sportKey),
  );
  const ncaaLeagueIds = context.leagues
    .filter((league) => league.sportKey === "ncaa_pickem")
    .map((league) => league.id);
  const skinsLeagueIds = context.leagues
    .filter((league) => league.sportKey === "nba_skins")
    .map((league) => league.id);

  const [slatesResult, weeksResult, seasonsResult, teamsResult] = await Promise.all([
    fantasyLeagues.length
      ? supabaseAdmin
          .from("slates")
          .select("id, league_id, sport, display_name, date, start_date, end_date, is_locked")
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
    supabaseAdmin
      .from("teams")
      .select("id, name")
      .eq("group_id", context.group.id),
  ]);

  const error =
    slatesResult.error ??
    weeksResult.error ??
    seasonsResult.error;
  if (error) throw new Error(`Failed to load Group game summary: ${error.message}`);

  const today = new Date().toISOString().slice(0, 10);
  const games = context.leagues.map((league) => {
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

  if (teamsResult.error) {
    console.error(`Failed to load Group pulse teams: ${teamsResult.error.message}`);
    return { games, pulse: [] };
  }

  const teamNameById = new Map(
    (teamsResult.data ?? []).map((team) => [Number(team.id), team.name]),
  );
  const candidateSlates = (slatesResult.data ?? []).filter((slate) => {
    const endDate = slate.end_date ?? slate.start_date ?? slate.date;
    return slate.is_locked && Boolean(endDate) && endDate < today;
  });
  const candidateSlateIds = candidateSlates.map((slate) => Number(slate.id));
  const resultsResponse = candidateSlateIds.length
    ? await supabaseAdmin
        .from("team_slate_results")
        .select(
          "slate_id, team_id, finish_position, games_in_progress, games_remaining",
        )
        .in("slate_id", candidateSlateIds)
    : { data: [], error: null };

  if (resultsResponse.error) {
    console.error(`Failed to load Group pulse: ${resultsResponse.error.message}`);
    return { games, pulse: [] };
  }

  const groupTeamIds = new Set(teamNameById.keys());
  const resultsBySlate = new Map<
    number,
    Array<{
      team_id: number;
      finish_position: number | null;
      games_in_progress: number | null;
      games_remaining: number | null;
    }>
  >();

  for (const result of resultsResponse.data ?? []) {
    const teamId = Number(result.team_id);
    if (!groupTeamIds.has(teamId)) continue;
    const slateId = Number(result.slate_id);
    const rows = resultsBySlate.get(slateId) ?? [];
    rows.push({
      team_id: teamId,
      finish_position:
        result.finish_position === null ? null : Number(result.finish_position),
      games_in_progress: Number(result.games_in_progress ?? 0),
      games_remaining: Number(result.games_remaining ?? 0),
    });
    resultsBySlate.set(slateId, rows);
  }

  const completedSlates = candidateSlates.filter((slate) => {
    const rows = resultsBySlate.get(Number(slate.id)) ?? [];
    return (
      rows.length >= 2 &&
      rows.every(
        (row) =>
          row.finish_position !== null &&
          row.games_in_progress === 0 &&
          row.games_remaining === 0,
      )
    );
  });
  const completedSlateIds = new Set(
    completedSlates.map((slate) => Number(slate.id)),
  );
  const completedResults = [...resultsBySlate.entries()]
    .filter(([slateId]) => completedSlateIds.has(slateId))
    .flatMap(([, rows]) => rows);
  const winsByTeam = new Map<number, number>();
  const runnerUpsByTeam = new Map<number, number>();

  for (const result of completedResults) {
    if (result.finish_position === 1) {
      winsByTeam.set(result.team_id, (winsByTeam.get(result.team_id) ?? 0) + 1);
    }
    if (result.finish_position === 2) {
      runnerUpsByTeam.set(
        result.team_id,
        (runnerUpsByTeam.get(result.team_id) ?? 0) + 1,
      );
    }
  }

  function leadingTeam(counts: Map<number, number>) {
    const [leader] = [...counts.entries()].sort(
      ([teamA, countA], [teamB, countB]) =>
        countB - countA ||
        (teamNameById.get(teamA) ?? "").localeCompare(
          teamNameById.get(teamB) ?? "",
        ),
    );
    return leader
      ? {
          name: teamNameById.get(leader[0]) ?? "Unknown team",
          count: leader[1],
        }
      : null;
  }

  const sportLabel: Record<string, string> = {
    nba: "NBA slates",
    nfl: "NFL slates",
    golf: "Golf tournaments",
  };
  const completedBySport = new Map<string, number>();
  for (const slate of completedSlates) {
    const sport = String(slate.sport ?? "").toLowerCase();
    completedBySport.set(sport, (completedBySport.get(sport) ?? 0) + 1);
  }

  const mostWins = leadingTeam(winsByTeam);
  const mostRunnerUps = leadingTeam(runnerUpsByTeam);
  const pulse: GroupPulseFact[] = [];

  if (completedSlates.length > 0) {
    pulse.push({
      label: "Completed matchups",
      value: String(completedSlates.length),
    });
  }

  for (const sport of ["nba", "nfl", "golf"]) {
    const count = completedBySport.get(sport) ?? 0;
    if (count > 0) {
      pulse.push({ label: sportLabel[sport], value: `${count} completed` });
    }
  }

  if (mostWins?.count) {
    pulse.push({
      label: "Most fantasy wins",
      value: `${mostWins.name} · ${mostWins.count}`,
    });
  }

  if (mostRunnerUps?.count) {
    pulse.push({
      label: "Most runner-ups",
      value: `${mostRunnerUps.name} · ${mostRunnerUps.count}`,
    });
  }

  return { games, pulse };
}
