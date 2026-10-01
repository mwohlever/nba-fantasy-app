"use client";

import ViewingContextSelector from "@/components/ui/ViewingContextSelector";
import { useViewingContext } from "@/lib/viewing-context/useViewingContext";
import AppNav from "@/components/AppNav";
import TeamAvatar from "@/components/ui/TeamAvatar";
import { useGroupContext } from "@/components/providers/GroupProvider";

import Link from "next/link";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { getDefaultNbaSkinsRules } from "@/lib/rules/leagueRules";


type PickRecord = {
  wins: number;
  losses: number;
  gamesPlayed: number;

  projectedWins:
    | number
    | null;

  projectedLosses:
    | number
    | null;

  projectionSource:
    | string
    | null;
};


type SkinsPick = {
  id: number;
  nbaTeamAbbreviation: string;
  nbaTeamName: string;
  pickType:
    | "wins"
    | "losses";
  draftRound:
    | number
    | null;
  finalPoints:
    | number
    | null;
  record:
    | PickRecord
    | null;
};


type Standing = {
  ownerName: string;

  leagueTeamId:
    | number
    | null;

  avatarUrl:
    | string
    | null;

  pickCount: number;

  finalTotal:
    | number
    | null;

  hasCompleteFinalPoints:
    boolean;

  rank:
    | number
    | null;

  picks:
    SkinsPick[];
};


type StandingsResponse = {
  rules: {
    participantCount: number;
    nbaTeamsPerParticipant: number;
    totalPicks: number;
  };

  availableSeasons:
    Array<{
      season: number;
      status:
        | "open"
        | "locked"
        | "final";
    }>;

  selectedSeason:
    | {
        id: number;
        season: number;
        status:
          | "open"
          | "locked"
          | "final";
        participantCount: number;
        nbaTeamsPerParticipant: number;
        totalPicks: number;
      }
    | null;

  standings:
    Standing[];

  error?: string;
};


type HomeRow = Standing & {
  points: number;
  gamesPlayed: number;
  gamesLeft: number;

  accuracy:
    | number
    | null;

  pace:
    | number
    | null;

  projected:
    | number
    | null;

  possible: number;
};


function seasonLabel(
  season: number,
) {
  return `${season}-${String(
    season + 1,
  ).slice(-2)}`;
}


function formatNumber(
  value:
    | number
    | null,
  digits = 0,
) {
  if (value === null) {
    return "—";
  }

  return value.toLocaleString(
    "en-US",
    {
      minimumFractionDigits:
        digits,
      maximumFractionDigits:
        digits,
    },
  );
}


function rowMetrics(
  standing: Standing,
  teamsPerParticipant: number,
): HomeRow {
  const fullSeasonGames = teamsPerParticipant * 82;
  let points = 0;
  let gamesPlayed = 0;

  let projectedPoints =
    0;

  let projectedPickCount =
    0;


  standing.picks.forEach(
    (pick) => {
      if (pick.record) {
        gamesPlayed +=
          Number(
            pick.record.gamesPlayed ??
              0,
          );

        points +=
          pick.pickType ===
          "wins"
            ? Number(
                pick.record.wins ??
                  0,
              )
            : Number(
                pick.record.losses ??
                  0,
              );


        const projectionValue =
          pick.pickType ===
          "wins"
            ? pick.record
                .projectedWins
            : pick.record
                .projectedLosses;


        if (
          projectionValue !==
            null &&
          projectionValue !==
            undefined &&
          Number.isFinite(
            Number(
              projectionValue,
            ),
          )
        ) {
          projectedPoints +=
            Number(
              projectionValue,
            );

          projectedPickCount +=
            1;
        }

        return;
      }

      /*
       * Historical fallback if a finalized pick has its saved
       * points but no per-team record row.
       */
      if (
        pick.finalPoints !==
        null
      ) {
        points +=
          Number(
            pick.finalPoints,
          );
      }
    },
  );


  if (
    gamesPlayed === 0 &&
    standing.hasCompleteFinalPoints &&
    standing.finalTotal !==
      null
  ) {
    points =
      Number(
        standing.finalTotal,
      );

    gamesPlayed =
      fullSeasonGames;
  }


  const gamesLeft =
    standing.pickCount === teamsPerParticipant
      ? Math.max(
          fullSeasonGames -
            gamesPlayed,
          0,
        )
      : 0;


  const accuracy =
    gamesPlayed > 0
      ? (
          points /
          gamesPlayed
        ) *
        100
      : null;


  const pace =
    accuracy !== null
      ? (
          accuracy /
          100
        ) *
        fullSeasonGames
      : null;


  /*
   * Projected is intentionally NOT the same as Pace.
   *
   * Pace:
   *   current Skins accuracy extrapolated across the configured
   *   full-season team-games.
   *
   * Projected:
   *   sum ESPN BPI projected final wins for each Wins pick
   *   and projected final losses for each Losses pick.
   *
   * A completed season resolves to the actual score.
   */
  const projected =
    gamesLeft === 0 &&
    standing.pickCount === teamsPerParticipant
      ? points
      : (
          standing.pickCount ===
            teamsPerParticipant &&
          projectedPickCount ===
            teamsPerParticipant
        )
        ? projectedPoints
        : null;


  return {
    ...standing,

    points,

    gamesPlayed,

    gamesLeft,

    accuracy,

    pace,

    projected,

    possible:
      points +
      gamesLeft,
  };
}


export default function NbaSkinsHomePage() {
  const { groupContext } = useGroupContext();
  const [expansion, setExpansion] = useState<{ scope: string; ids: Array<number | string> }>({ scope: "", ids: [] });
  const [
    data,
    setData,
  ] =
    useState<
      StandingsResponse | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState("");


  const viewing = useViewingContext({ game: "nba-skins",
    options: data?.availableSeasons.map(row => ({ value: row.season, label: seasonLabel(row.season) })),
    fallback: data?.selectedSeason?.season ?? null });

  useEffect(() => {
    if (!viewing.hydrated) return;
    let cancelled =
      false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response =
          await fetch(
            `/api/nba-skins/standings?home=1${viewing.value ? `&season=${viewing.value}` : ""}`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await response.json() as StandingsResponse;

        if (!response.ok) {
          throw new Error(
            result.error ??
              "Failed to load NBA Skins standings.",
          );
        }

        if (!cancelled) {
          setData(
            result,
          );
        }
      } catch (
        loadError
      ) {
        if (!cancelled) {
          setError(
            loadError instanceof
            Error
              ? loadError.message
              : "Failed to load NBA Skins.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(
            false,
          );
        }
      }
    }

    void load();

    return () => {
      cancelled =
        true;
    };
  }, [viewing.value, viewing.hydrated]);


  const season =
    data?.selectedSeason ??
    null;


  const teamsPerParticipant =
    season?.nbaTeamsPerParticipant ??
    data?.rules.nbaTeamsPerParticipant ??
    getDefaultNbaSkinsRules().nbaTeamsPerParticipant;


  const rows =
    useMemo(
      () =>
        (
          data?.standings ??
          []
        )
          .filter(
            (standing) =>
              standing.pickCount >
              0,
          )
          .map(
            (standing) => rowMetrics(standing, teamsPerParticipant),
          )
          .sort(
            (a, b) => {
              if (
                b.points !==
                a.points
              ) {
                return (
                  b.points -
                  a.points
                );
              }

              return (
                (
                  b.accuracy ??
                  -1
                ) -
                (
                  a.accuracy ??
                  -1
                )
              );
            },
          ),
      [data, teamsPerParticipant],
    );


  const newestAvailableSeason =
    data?.availableSeasons
      .reduce(
        (
          newest,
          entry,
        ) =>
          Math.max(
            newest,
            entry.season,
          ),
        0,
      ) ??
    0;


  const showingPreviousSeason =
    season !== null &&
    newestAvailableSeason >
      season.season;


  const expansionScope = `${groupContext?.group.id}:${season?.id}`;
  const expandedIds = expansion.scope === expansionScope ? expansion.ids : [];
  if (expansion.scope !== expansionScope) {
    setExpansion({ scope: expansionScope, ids: [] });
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-3 py-3 pb-24 text-[var(--app-text)] sm:px-4 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-3">
        <AppNav />

        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-lg font-bold">NBA Skins</h1>
          <ViewingContextSelector label="Season" value={viewing.value}
            options={data?.availableSeasons.map(row => ({ value: row.season, label: seasonLabel(row.season) })) ?? []}
            onChange={viewing.select} disabled={!viewing.ready} />
          {season ? (
            <p className="text-xs text-[var(--app-text-muted)]">
              {seasonLabel(season.season)} · <span className="capitalize">{season.status}</span>
            </p>
          ) : null}
          <p className="w-full text-xs leading-5 text-[var(--app-text-muted)]">
            {showingPreviousSeason
              ? `Showing ${seasonLabel(season!.season)} until the ${seasonLabel(newestAvailableSeason)} draft is saved.`
              : "Points earned from each participant’s Wins / Losses selections."}
          </p>
        </header>

        {error || viewing.missingGroup ? (
          <p role="alert" className="py-3 text-sm text-red-600 dark:text-red-300">{error || "No active Group is available."}</p>
        ) : loading || (viewing.ready && viewing.value !== (data?.selectedSeason?.season ?? null)) ? (
          <p className="py-4 text-sm text-[var(--app-text-muted)]">Loading NBA Skins…</p>
        ) : !season ? (
          <p className="py-4 text-sm text-[var(--app-text-muted)]">No NBA Skins season exists yet.</p>
        ) : rows.length === 0 ? (
          <div className="py-4 text-sm">
            <p className="font-semibold">No draft saved yet</p>
            <p className="mt-1 text-[var(--app-text-muted)]">The standings table will populate as soon as the season’s draft is saved.</p>
          </div>
        ) : (
          <section aria-label="NBA Skins season standings">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-2 border-b border-[var(--app-border)] px-1 py-1 text-xs text-[var(--app-text-muted)]">
              <span>Team</span><span className="text-right">Points</span><span className="sr-only">Details</span>
            </div>
            {rows.map((row, index) => {
              const teamId = row.leagueTeamId ?? `pick-${row.picks[0]?.id ?? index}`;
              const expanded = expandedIds.includes(teamId);
              const detailsId = `skins-metrics-${teamId}`;
              const toggleId = `skins-metrics-toggle-${teamId}`;
              const profileHref = row.leagueTeamId
                ? `/nba-skins/profile?teamId=${row.leagueTeamId}`
                : "/nba-skins/profile";
              return (
                <article key={teamId} className={`scores-standing${index === 0 ? " scores-standing--leader" : ""}`}>
                  <div className={`grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-2 px-1 py-1${index === 0 ? " bg-[var(--app-surface-soft)]" : ""}`}>
                    <Link href={profileHref} aria-label={`View ${row.ownerName}'s NBA Skins profile`}
                      className="flex min-h-11 min-w-0 items-center gap-2 rounded font-bold hover:text-[var(--app-blue)] focus-visible:outline-2 focus-visible:outline-[var(--app-blue)]">
                      <span aria-hidden="true"><TeamAvatar teamName={row.ownerName} avatarUrl={row.avatarUrl} size="xs" /></span>
                      <span className="truncate text-sm" title={row.ownerName}>{row.ownerName}</span>
                      <span aria-hidden="true" className="text-xs text-[var(--app-text-muted)]">›</span>
                    </Link>
                    <strong className="text-right tabular-nums">{row.points}</strong>
                    <button type="button" id={toggleId} aria-label={`${expanded ? "Collapse" : "Expand"} ${row.ownerName}'s metrics`}
                      aria-expanded={expanded} aria-controls={detailsId}
                      onClick={() => setExpansion({ scope: expansionScope,
                        ids: expanded ? expandedIds.filter((id) => id !== teamId) : [...expandedIds, teamId] })}
                      className="flex h-11 w-11 items-center justify-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-surface-soft)] focus-visible:outline-2 focus-visible:outline-[var(--app-blue)]">
                      <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
                    </button>
                  </div>
                  <div id={detailsId} role="region" aria-labelledby={toggleId} hidden={!expanded}>
                    {expanded ? (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--app-border)] px-2 py-2 text-xs sm:grid-cols-5">
                        {[
                          ["Accuracy", row.accuracy === null ? "—" : `${formatNumber(row.accuracy, 1)}%`],
                          ["Pace", formatNumber(row.pace, 1)],
                          ["Projected", formatNumber(row.projected, 1)],
                          ["Possible", row.possible],
                          ["Games Left", row.gamesLeft],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-[var(--app-text-muted)]">{label}</dt>
                            <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                </article>
              );
            })}
            <p className="pt-2 text-xs leading-5 text-[var(--app-text-muted)]">
              <strong>Pace</strong> extrapolates current accuracy across the season’s {teamsPerParticipant * 82} team-games.{" "}
              <strong>Projected</strong> uses ESPN BPI projected final NBA team records for each drafted Wins / Losses selection.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
