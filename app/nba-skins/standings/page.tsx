"use client";

import AppNav from "@/components/AppNav";
import { useGroupContext } from "@/components/providers/GroupProvider";
import { useEffect, useMemo, useState } from "react";

type SeasonOption = {
  season: number;
  status: "open" | "locked" | "final";
  participantCount?: number;
  nbaTeamsPerParticipant?: number;
  totalPicks?: number;
};

type Pick = {
  id: number;
  nbaTeamAbbreviation: string;
  nbaTeamName: string;
  pickType: "wins" | "losses";
  draftRound: number | null;
  finalPoints: number | null;
  record: {
    wins: number;
    losses: number;
    gamesPlayed: number;
  } | null;
};

type Standing = {
  ownerName: string;
  leagueTeamId: number | null;
  pickCount: number;
  finalTotal: number | null;
  hasCompleteFinalPoints: boolean;
  rank: number | null;
  picks: Pick[];
};

type StandingsResponse = {
  availableSeasons: SeasonOption[];
  selectedSeason: SeasonOption | null;
  standings: Standing[];
  error?: string;
};

function formatSeasonLabel(season: number) {
  const end =
    String(season + 1).slice(-2);

  return `${season}-${end}`;
}

export default function NbaSkinsStandingsPage() {
  const { groupContext } = useGroupContext();
  const [expansion, setExpansion] = useState<{ scope: string; ids: Array<number | string> }>({ scope: "", ids: [] });
  const [data, setData] =
    useState<StandingsResponse | null>(null);

  const [selectedSeason, setSelectedSeason] =
    useState<number | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query =
          selectedSeason === null
            ? ""
            : `?season=${selectedSeason}`;

        const response =
          await fetch(
            `/api/nba-skins/standings${query}`,
            {
              cache: "no-store",
            },
          );

        const body =
          (await response.json()) as StandingsResponse;

        if (!response.ok) {
          throw new Error(
            body.error ??
              "Failed to load NBA Skins standings.",
          );
        }

        if (cancelled) {
          return;
        }

        setData(body);

        if (
          selectedSeason === null &&
          body.selectedSeason
        ) {
          setSelectedSeason(
            body.selectedSeason.season,
          );
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load NBA Skins standings.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedSeason]);

  const selectedSeasonData =
    data?.selectedSeason ?? null;

  const isCompleteSeason =
    useMemo(
      () =>
        Boolean(
          data?.standings.length &&
            data.standings.every(
              (standing) =>
                standing.hasCompleteFinalPoints,
            ),
        ),
      [data],
    );

  const expansionScope = `${groupContext?.group.id}:${selectedSeason}`;
  const expandedIds = expansion.scope === expansionScope ? expansion.ids : [];
  if (expansion.scope !== expansionScope) {
    setExpansion({ scope: expansionScope, ids: [] });
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-3 py-3 pb-24 text-[var(--app-text)] sm:px-4 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-3">
        <AppNav />

        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold">NBA Skins Standings</h1>
          {data?.availableSeasons.length ? (
            <label className="flex items-center gap-2 text-xs text-[var(--app-text-muted)]">
              <span>Season</span>
              <select
                value={selectedSeason ?? data.selectedSeason?.season ?? ""}
                onChange={(event) => setSelectedSeason(Number(event.target.value))}
                className="min-h-11 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2 text-sm font-semibold text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-[var(--app-blue)]"
              >
                {data.availableSeasons.map((season) => (
                  <option key={season.season} value={season.season}>
                    {formatSeasonLabel(season.season)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </header>

        {loading ? (
          <p className="py-4 text-sm text-[var(--app-text-muted)]">Loading NBA Skins standings…</p>
        ) : error ? (
          <div role="alert" className="py-3 text-sm text-red-600 dark:text-red-300">
            <p className="font-semibold">Couldn&apos;t load NBA Skins standings</p>
            <p>{error}</p>
          </div>
        ) : !data?.selectedSeason ? (
          <p className="py-4 text-sm text-[var(--app-text-muted)]">No NBA Skins seasons found.</p>
        ) : (
          <>
            {!isCompleteSeason ? (
              <p className="border-l-2 border-[var(--app-blue)] pl-3 text-xs leading-5 text-[var(--app-text-muted)]">
                {selectedSeasonData?.season === 2025
                  ? "2025 picks are imported, but final points are intentionally not populated yet. We’ll derive them from authoritative final NBA records."
                  : selectedSeasonData?.status === "open"
                    ? "This season is open. Final standings will appear as picks and results become available."
                    : "Complete final-point data is not available for this season yet."}
              </p>
            ) : null}

            <section className="scores-standings" aria-label="NBA Skins standings">
              {data.standings.length === 0 ? (
                <p className="py-4 text-sm text-[var(--app-text-muted)]">No participants found for this season.</p>
              ) : data.standings.map((standing, index) => {
                // The API supplies Group team IDs; pick IDs retain a legacy fallback without using names.
                const teamId = standing.leagueTeamId ?? `pick-${standing.picks[0]?.id ?? index}`;
                const expanded = expandedIds.includes(teamId);
                const headingId = `skins-standing-${teamId}`;
                const detailsId = `skins-picks-${teamId}`;
                return (
                  <article key={teamId} className={`scores-standing${expanded ? " scores-standing--expanded" : ""}`}>
                    <button
                      type="button"
                      id={headingId}
                      className="scores-standing-toggle min-h-11 !grid-cols-[1.5rem_minmax(0,1fr)_auto_1rem]"
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      onClick={() => setExpansion({
                        scope: expansionScope,
                        ids: expanded ? expandedIds.filter((id) => id !== teamId) : [...expandedIds, teamId],
                      })}
                    >
                      <span className="scores-standing-rank" aria-label={`Rank ${standing.rank ?? "unavailable"}`}>{standing.rank ?? "—"}</span>
                      <span className="scores-standing-name"><strong title={standing.ownerName}>{standing.ownerName}</strong></span>
                      <span className="scores-standing-score text-right tabular-nums" aria-label={`${standing.finalTotal ?? "Unavailable"} points`}>{standing.finalTotal ?? "—"}</span>
                      <span className="text-right text-[var(--app-text-muted)]" aria-hidden="true">{expanded ? "▴" : "▾"}</span>
                    </button>
                    <div id={detailsId} role="region" aria-labelledby={headingId} hidden={!expanded}>
                      {expanded ? standing.picks.length === 0 ? (
                        <p className="px-2 py-3 text-sm text-[var(--app-text-muted)]">No teams have been drafted for this season.</p>
                      ) : (
                        <div className="pb-2 text-xs">
                          <div aria-hidden="true" className="hidden grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem] gap-2 border-t border-[var(--app-border)] px-2 py-1.5 text-[var(--app-text-muted)] sm:grid">
                            <span>Round</span><span>NBA Team</span><span>Selection</span><span>Record</span><span className="text-right">Points</span>
                          </div>
                          {standing.picks.map((pick) => {
                            const round = selectedSeasonData && selectedSeasonData.season >= 2026 ? pick.draftRound : null;
                            const record = pick.record ? `${pick.record.wins}-${pick.record.losses}` : "—";
                            const selection = pick.pickType === "wins" ? "Wins" : "Losses";
                            return (
                              <div key={pick.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-t border-[var(--app-border)] px-2 py-2 sm:grid-cols-[3rem_minmax(0,1fr)_5rem_4rem_4rem]">
                                <span className="hidden text-[var(--app-text-muted)] sm:block">{round === null ? "—" : `R${round}`}</span>
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-baseline gap-2">
                                    <strong className="shrink-0">{pick.nbaTeamAbbreviation}</strong>
                                    <span className="truncate text-[var(--app-text-muted)]" title={pick.nbaTeamName}>{pick.nbaTeamName}</span>
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap gap-x-1 text-[var(--app-text-muted)] sm:hidden">
                                    {round !== null ? <span>R{round} ·</span> : null}
                                    <span>{selection} ·</span><span>{record}</span>
                                  </div>
                                </div>
                                <span className="hidden sm:block">{selection}</span>
                                <span className="hidden tabular-nums text-[var(--app-text-muted)] sm:block">{record}</span>
                                <strong className="text-right text-sm tabular-nums" aria-label={`${pick.finalPoints ?? "Unavailable"} points`}>{pick.finalPoints ?? "—"}</strong>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
