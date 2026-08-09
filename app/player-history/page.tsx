"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import AppNav from "@/components/AppNav";
import ReadOnlyPlayerModal from "@/components/lineups/ReadOnlyPlayerModal";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import type {
  Player,
} from "@/components/lineups/types";
import {
  useSelectedSport,
} from "@/components/providers/SportProvider";

type PlayerHistoryRow = {
  player_id: number;
  player_name: string;

  nba_player_id: number | null;
  nfl_player_id: number | null;

  espn_golf_player_id?: string | null;
  headshot_url?: string | null;
  country?: string | null;
  owgr_rank?: number | null;

  times_drafted: number;

  avg_score: number;
  high_score: number;
  low_score: number;

  winning_lineups: number;
  runner_up_lineups: number;
  podium_lineups?: number;

  avg_finish: number | null;

  cuts_made?: number;
  cut_opportunities?: number;
  cuts_made_pct?: number | null;

  completed_rounds?: number;
  rounds_under_par?: number;

  birdies?: number;
  eagles?: number;
  albatrosses?: number;
  holes_in_one?: number;
  pars?: number;
  bogeys?: number;
  double_bogeys_or_worse?: number;
};

type SortKey =
  | "player_name"
  | "times_drafted"
  | "avg_score"
  | "high_score"
  | "low_score"
  | "winning_lineups"
  | "runner_up_lineups"
  | "podium_lineups"
  | "avg_finish"
  | "cuts_made_pct"
  | "birdies"
  | "eagles"
  | "albatrosses"
  | "holes_in_one"
  | "rounds_under_par";

type SortDirection =
  | "asc"
  | "desc";

type ApiResponse = {
  success: boolean;
  season: number | "all";
  sport?: string;
  playerHistory:
    PlayerHistoryRow[];
};

type GolfProfile = {
  success: boolean;

  selectedSeason:
    number | "all";

  player: {
    id: number;
    name: string;
    position_group:
      string | null;

    country?: string | null;

    owgrRank?:
      number | null;

    owgrUpdatedAt?:
      string | null;

    espnGolfPlayerId?:
      string | null;

    headshotUrl?:
      string | null;
  };

  summary: {
    timesDrafted: number;

    wins: number;
    runnerUps: number;
    podiums?: number;

    winRate:
      number | null;

    draftedMostBy: {
      teamName: string;
      count: number;
    } | null;

    draftedByBreakdown:
      Array<{
        teamName: string;
        count: number;
      }>;

    averageFantasyPoints:
      number | null;

    bestFantasyPoints:
      number | null;

    worstFantasyPoints:
      number | null;

    averageFinish:
      number | null;

    cutsMade?: number;
    cutOpportunities?: number;
    cutsMadePct?:
      number | null;

    birdies?: number;
    eagles?: number;
    albatrosses?: number;
    holesInOne?: number;

    pars?: number;
    bogeys?: number;
    doubleBogeysOrWorse?:
      number;

    roundsUnderPar?: number;
    completedRounds?: number;
  };

  recentHistory:
    Array<{
      slateId:
        number;

      slateLabel:
        string;

      teamName:
        string;

      finishPosition:
        number | null;

      fantasyPoints:
        number | null;

      golferScore?:
        number | null;

      status?:
        string | null;

      madeCut?:
        boolean | null;

      stats?: {
        birdies?: number;
        eagles?: number;
        albatrosses?: number;
        holesInOne?: number;

        pars?: number;
        bogeys?: number;
        doubleBogeysOrWorse?:
          number;

        roundsUnderPar?:
          number;

        completedRounds?:
          number;
      };
    }>;
};

function golfScore(
  value:
    number | null | undefined,
  digits = 1,
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(value),
    )
  ) {
    return "—";
  }

  const numeric =
    Number(value);

  const rounded =
    Number(
      numeric.toFixed(
        digits,
      ),
    );

  if (rounded === 0) {
    return "E";
  }

  if (rounded > 0) {
    return `+${rounded}`;
  }

  return String(
    rounded,
  );
}

function fmt(
  value:
    number | null | undefined,
  digits = 1,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return Number(
    value,
  ).toFixed(
    digits,
  );
}

function ordinal(
  position:
    number | null | undefined,
) {
  if (!position) {
    return "—";
  }

  const mod100 =
    position % 100;

  if (
    mod100 >= 11 &&
    mod100 <= 13
  ) {
    return `${position}th`;
  }

  const mod10 =
    position % 10;

  if (mod10 === 1) {
    return `${position}st`;
  }

  if (mod10 === 2) {
    return `${position}nd`;
  }

  if (mod10 === 3) {
    return `${position}rd`;
  }

  return `${position}th`;
}

function cutDisplay(
  made:
    number | undefined,
  opportunities:
    number | undefined,
) {
  const safeMade =
    made ?? 0;

  const safeOpportunities =
    opportunities ?? 0;

  if (
    safeOpportunities === 0
  ) {
    return "—";
  }

  return (
    `${safeMade}/` +
    `${safeOpportunities}`
  );
}

function GolfStatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value:
    string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>

      <div className="mt-1 text-2xl font-black text-slate-950">
        {value}
      </div>

      {detail ? (
        <div className="mt-1 text-xs text-slate-500">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function GolfPlayerHistoryModal({
  row,
  season,
  onClose,
}: {
  row:
    PlayerHistoryRow | null;

  season:
    number | "all";

  onClose: () => void;
}) {
  const [
    profile,
    setProfile,
  ] =
    useState<GolfProfile | null>(
      null,
    );

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  useEffect(() => {
    if (!row) {
      setProfile(null);
      setError("");
      return;
    }

    let isActive =
      true;

    async function loadProfile() {
      try {
        setIsLoading(true);
        setError("");

        const response =
          await fetch(
            `/api/player-league-profile?playerId=${row?.player_id}&season=${season}&sport=golf`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await response.json();

        if (!isActive) {
          return;
        }

        if (
          !response.ok
        ) {
          setError(
            result.error ??
              "Unable to load golfer history.",
          );

          setProfile(null);
          return;
        }

        setProfile(
          result as GolfProfile,
        );
      } catch (
        loadError
      ) {
        console.error(
          loadError,
        );

        if (
          isActive
        ) {
          setError(
            "Unable to load golfer history.",
          );

          setProfile(
            null,
          );
        }
      } finally {
        if (
          isActive
        ) {
          setIsLoading(
            false,
          );
        }
      }
    }

    void loadProfile();

    return () => {
      isActive =
        false;
    };
  }, [
    row,
    season,
  ]);

  useEffect(() => {
    if (!row) {
      return;
    }

    function handleKeyDown(
      event:
        KeyboardEvent,
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    row,
    onClose,
  ]);

  if (!row) {
    return null;
  }

  const summary =
    profile?.summary;

  const player =
    profile?.player;

  const headshotUrl =
    player?.headshotUrl ??
    row.headshot_url ??
    (
      row.espn_golf_player_id
        ? `https://a.espncdn.com/i/headshots/golf/players/full/${row.espn_golf_player_id}.png`
        : null
    );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={
        (
          event,
        ) => {
          if (
            event.target ===
            event.currentTarget
          ) {
            onClose();
          }
        }
      }
    >
      <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-[28px] bg-slate-50 shadow-2xl sm:max-w-4xl sm:rounded-[28px]">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
              Golfer History
            </div>

            <button
              type="button"
              onClick={
                onClose
              }
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-600 transition hover:bg-slate-200"
              aria-label="Close golfer history"
            >
              ×
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Loading golfer history...
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
              {error}
            </div>
          </div>
        ) : profile ? (
          <div className="space-y-5 p-4 pb-10 sm:p-6">
            <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-950 via-emerald-900 to-slate-950 p-5 text-white shadow-lg sm:p-6">
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-white/20 bg-white/10 sm:h-24 sm:w-24">
                  {headshotUrl ? (
                    <img
                      src={
                        headshotUrl
                      }
                      alt={
                        player?.name ??
                        row.player_name
                      }
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl">
                      ⛳
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                    {season ===
                    "all"
                      ? "All-Time"
                      : `${season} Season`}
                  </div>

                  <h2 className="mt-1 truncate text-2xl font-black sm:text-3xl">
                    {player?.name ??
                      row.player_name}
                  </h2>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-emerald-100">
                    {player?.country ? (
                      <span>
                        {
                          player.country
                        }
                      </span>
                    ) : null}

                    {player?.owgrRank ? (
                      <span>
                        OWGR #
                        {
                          player.owgrRank
                        }
                      </span>
                    ) : null}

                    <span>
                      Drafted{" "}
                      {
                        summary?.timesDrafted ??
                        row.times_drafted
                      }
                      x
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className="mb-3">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  League Impact
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <GolfStatCard
                  label="Wins"
                  value={
                    summary?.wins ??
                    0
                  }
                  detail="Team won when drafted"
                />

                <GolfStatCard
                  label="Podiums"
                  value={
                    summary?.podiums ??
                    0
                  }
                  detail="Top-3 team finishes"
                />

                <GolfStatCard
                  label="Avg Finish"
                  value={
                    summary?.averageFinish ===
                    null
                      ? "—"
                      : ordinal(
                          Math.round(
                            Number(
                              summary?.averageFinish ??
                                0,
                            ),
                          ),
                        )
                  }
                  detail={
                    summary?.averageFinish !==
                    null
                      ? `Exact: ${fmt(
                          summary?.averageFinish,
                          1,
                        )}`
                      : "Finalized tournaments"
                  }
                />

                <GolfStatCard
                  label="Win Rate"
                  value={
                    summary?.winRate ===
                    null
                      ? "—"
                      : `${fmt(
                          summary?.winRate,
                          0,
                        )}%`
                  }
                  detail="Finalized tournaments"
                />
              </div>
            </section>

            <section>
              <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                Golfer Performance
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <GolfStatCard
                  label="Avg Score"
                  value={
                    golfScore(
                      summary?.averageFantasyPoints,
                    )
                  }
                  detail="When drafted"
                />

                <GolfStatCard
                  label="Best Score"
                  value={
                    golfScore(
                      summary?.bestFantasyPoints,
                    )
                  }
                  detail="Lowest tournament score"
                />

                <GolfStatCard
                  label="Cuts Made"
                  value={
                    cutDisplay(
                      summary?.cutsMade,
                      summary?.cutOpportunities,
                    )
                  }
                  detail={
                    summary?.cutsMadePct ===
                    null ||
                    summary?.cutsMadePct ===
                    undefined
                      ? "No cut decisions yet"
                      : `${fmt(
                          summary.cutsMadePct,
                          0,
                        )}%`
                  }
                />

                <GolfStatCard
                  label="Rounds Under Par"
                  value={
                    `${summary?.roundsUnderPar ?? 0}/${summary?.completedRounds ?? 0}`
                  }
                  detail="Completed rounds"
                />
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Scoring Breakdown
                </div>

                <div className="mt-1 text-sm text-slate-500">
                  Hole results across tournaments where this golfer was drafted.
                </div>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2 text-center sm:grid-cols-8">
                {[
                  [
                    "Birdies",
                    summary?.birdies ??
                      0,
                  ],
                  [
                    "Eagles",
                    summary?.eagles ??
                      0,
                  ],
                  [
                    "Albatross",
                    summary?.albatrosses ??
                      0,
                  ],
                  [
                    "Aces",
                    summary?.holesInOne ??
                      0,
                  ],
                  [
                    "Pars",
                    summary?.pars ??
                      0,
                  ],
                  [
                    "Bogeys",
                    summary?.bogeys ??
                      0,
                  ],
                  [
                    "Double+",
                    summary?.doubleBogeysOrWorse ??
                      0,
                  ],
                  [
                    "Under Par",
                    summary?.roundsUnderPar ??
                      0,
                  ],
                ].map(
                  (
                    [
                      label,
                      value,
                    ],
                  ) => (
                    <div
                      key={
                        String(
                          label,
                        )
                      }
                      className="rounded-2xl bg-slate-50 px-2 py-3"
                    >
                      <div className="text-xl font-black text-slate-900">
                        {
                          value
                        }
                      </div>

                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {
                          label
                        }
                      </div>
                    </div>
                  ),
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Drafted By
                  </div>

                  <div className="mt-1 text-sm text-slate-500">
                    League ownership history.
                  </div>
                </div>

                {summary?.draftedMostBy ? (
                  <div className="text-right text-xs text-slate-500">
                    Most:{" "}
                    <strong className="text-slate-900">
                      {
                        summary.draftedMostBy.teamName
                      }
                    </strong>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {summary?.draftedByBreakdown?.length ? (
                  summary.draftedByBreakdown.map(
                    (
                      owner,
                    ) => (
                      <div
                        key={
                          owner.teamName
                        }
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900"
                      >
                        {
                          owner.teamName
                        }{" "}
                        ·{" "}
                        {
                          owner.count
                        }
                        x
                      </div>
                    ),
                  )
                ) : (
                  <div className="text-sm text-slate-500">
                    No draft history yet.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Tournament History
                </div>

                <div className="mt-1 text-sm text-slate-500">
                  Most recent tournaments where this golfer was drafted.
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {profile.recentHistory.length ===
                0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                    No tournament history yet.
                  </div>
                ) : (
                  profile.recentHistory.map(
                    (
                      history,
                    ) => {
                      const stats =
                        history.stats;

                      const isFinal =
                        history.finishPosition !==
                        null;

                      const status =
                        String(
                          history.status ??
                            "",
                        ).toLowerCase();

                      const isCut =
                        history.madeCut ===
                          false ||
                        status ===
                          "cut";

                      return (
                        <div
                          key={`${history.slateId}-${history.teamName}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="truncate font-bold text-slate-950">
                                {
                                  history.slateLabel
                                }
                              </div>

                              <div className="mt-1 text-xs text-slate-500">
                                Drafted by{" "}
                                <strong>
                                  {
                                    history.teamName
                                  }
                                </strong>
                              </div>
                            </div>

                            <div className="shrink-0 text-right">
                              <div className="text-xl font-black text-slate-950">
                                {golfScore(
                                  history.golferScore ??
                                    history.fantasyPoints,
                                )}
                              </div>

                              <div className="mt-1 text-xs font-bold">
                                {isFinal ? (
                                  <span className="text-slate-700">
                                    Team{" "}
                                    {ordinal(
                                      history.finishPosition,
                                    )}
                                  </span>
                                ) : isCut ? (
                                  <span className="text-red-600">
                                    CUT
                                  </span>
                                ) : (
                                  <span className="text-emerald-700">
                                    LIVE
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {stats ? (
                            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-200 pt-3 text-xs text-slate-500">
                              <span>
                                {
                                  stats.birdies ??
                                  0
                                }{" "}
                                birdies
                              </span>

                              <span>
                                {
                                  stats.eagles ??
                                  0
                                }{" "}
                                eagles
                              </span>

                              {(stats.albatrosses ??
                                0) >
                              0 ? (
                                <span className="font-bold text-violet-700">
                                  {
                                    stats.albatrosses
                                  }{" "}
                                  albatross
                                </span>
                              ) : null}

                              {(stats.holesInOne ??
                                0) >
                              0 ? (
                                <span className="font-bold text-amber-700">
                                  {
                                    stats.holesInOne
                                  }{" "}
                                  ace
                                </span>
                              ) : null}

                              <span>
                                {
                                  stats.bogeys ??
                                  0
                                }{" "}
                                bogeys
                              </span>

                              <span>
                                {
                                  stats.roundsUnderPar ??
                                  0
                                }{" "}
                                rounds under par
                              </span>
                            </div>
                          ) : null}
                        </div>
                      );
                    },
                  )
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GolfCompareModal({
  rows,
  onClose,
}: {
  rows:
    PlayerHistoryRow[];
  onClose: () => void;
}) {
  if (
    rows.length <
    2
  ) {
    return null;
  }

  type CompareMetric = {
    label: string;
    value:
      (
        row:
          PlayerHistoryRow,
      ) =>
        number | null;
    display:
      (
        row:
          PlayerHistoryRow,
      ) =>
        string;
    better:
      "high" | "low";
  };

  const metrics:
    CompareMetric[] = [
      {
        label:
          "Avg Score",
        value:
          (row) =>
            row.avg_score,
        display:
          (row) =>
            golfScore(
              row.avg_score,
            ),
        better:
          "low",
      },
      {
        label:
          "Best Score",
        value:
          (row) =>
            row.high_score,
        display:
          (row) =>
            golfScore(
              row.high_score,
            ),
        better:
          "low",
      },
      {
        label:
          "Times Drafted",
        value:
          (row) =>
            row.times_drafted,
        display:
          (row) =>
            String(
              row.times_drafted,
            ),
        better:
          "high",
      },
      {
        label:
          "Wins",
        value:
          (row) =>
            row.winning_lineups,
        display:
          (row) =>
            String(
              row.winning_lineups,
            ),
        better:
          "high",
      },
      {
        label:
          "Podiums",
        value:
          (row) =>
            row.podium_lineups ??
            0,
        display:
          (row) =>
            String(
              row.podium_lineups ??
                0,
            ),
        better:
          "high",
      },
      {
        label:
          "Avg Finish",
        value:
          (row) =>
            row.avg_finish,
        display:
          (row) =>
            row.avg_finish ===
            null
              ? "—"
              : fmt(
                  row.avg_finish,
                  1,
                ),
        better:
          "low",
      },
      {
        label:
          "Cuts",
        value:
          (row) =>
            row.cuts_made_pct ??
            null,
        display:
          (row) =>
            row.cut_opportunities
              ? `${row.cuts_made ?? 0}/${row.cut_opportunities} · ${fmt(
                  row.cuts_made_pct,
                  0,
                )}%`
              : "—",
        better:
          "high",
      },
      {
        label:
          "Rounds Under Par",
        value:
          (row) =>
            row.rounds_under_par ??
            0,
        display:
          (row) =>
            `${row.rounds_under_par ?? 0}/${row.completed_rounds ?? 0}`,
        better:
          "high",
      },
      {
        label:
          "Birdies",
        value:
          (row) =>
            row.birdies ??
            0,
        display:
          (row) =>
            String(
              row.birdies ??
                0,
            ),
        better:
          "high",
      },
      {
        label:
          "Eagles",
        value:
          (row) =>
            row.eagles ??
            0,
        display:
          (row) =>
            String(
              row.eagles ??
                0,
            ),
        better:
          "high",
      },
      {
        label:
          "Albatrosses",
        value:
          (row) =>
            row.albatrosses ??
            0,
        display:
          (row) =>
            String(
              row.albatrosses ??
                0,
            ),
        better:
          "high",
      },
      {
        label:
          "Aces",
        value:
          (row) =>
            row.holes_in_one ??
            0,
        display:
          (row) =>
            String(
              row.holes_in_one ??
                0,
            ),
        better:
          "high",
      },
      {
        label:
          "Bogeys",
        value:
          (row) =>
            row.bogeys ??
            0,
        display:
          (row) =>
            String(
              row.bogeys ??
                0,
            ),
        better:
          "low",
      },
      {
        label:
          "Double+",
        value:
          (row) =>
            row.double_bogeys_or_worse ??
            0,
        display:
          (row) =>
            String(
              row.double_bogeys_or_worse ??
                0,
            ),
        better:
          "low",
      },
    ];

  function isBest(
    metric:
      CompareMetric,
    row:
      PlayerHistoryRow,
  ) {
    const value =
      metric.value(
        row,
      );

    if (
      value === null ||
      !Number.isFinite(
        Number(value),
      )
    ) {
      return false;
    }

    const validValues =
      rows
        .map(
          (candidate) =>
            metric.value(
              candidate,
            ),
        )
        .filter(
          (
            candidate,
          ): candidate is number =>
            candidate !==
              null &&
            Number.isFinite(
              Number(
                candidate,
              ),
            ),
        );

    if (
      validValues.length ===
      0
    ) {
      return false;
    }

    const best =
      metric.better ===
      "low"
        ? Math.min(
            ...validValues,
          )
        : Math.max(
            ...validValues,
          );

    return (
      Number(value) ===
      best
    );
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={
        (
          event,
        ) => {
          if (
            event.target ===
            event.currentTarget
          ) {
            onClose();
          }
        }
      }
    >
      <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-[28px] bg-slate-50 shadow-2xl sm:max-w-5xl sm:rounded-[28px]">
        <div className="sticky top-0 z-20 border-b border-emerald-800/50 bg-slate-950/95 px-4 py-4 text-white backdrop-blur sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
                Head-to-Head
              </div>

              <h2 className="mt-1 text-xl font-black text-white">
                Compare Golfers
              </h2>
            </div>

            <button
              type="button"
              onClick={
                onClose
              }
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-xl font-bold text-slate-200 hover:bg-slate-700"
              aria-label="Close comparison"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-4 pb-10 sm:p-6">
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns:
                `110px repeat(${rows.length}, minmax(0, 1fr))`,
            }}
          >
            <div
              aria-hidden="true"
              className="min-w-0"
            />

            {rows.map(
              (
                row,
              ) => (
                <div
                  key={
                    row.player_id
                  }
                  className="min-w-0 rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-950 to-slate-950 px-2 py-3 text-center text-white sm:p-4"
                >
                  <div className="mx-auto h-12 w-12 overflow-hidden rounded-full bg-white/10 sm:h-16 sm:w-16">
                    {row.headshot_url ||
                    row.espn_golf_player_id ? (
                      <img
                        src={
                          row.headshot_url ??
                          `https://a.espncdn.com/i/headshots/golf/players/full/${row.espn_golf_player_id}.png`
                        }
                        alt={
                          row.player_name
                        }
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        ⛳
                      </div>
                    )}
                  </div>

                  <div className="mt-2 min-h-[32px] px-1 text-center text-[11px] font-black leading-tight text-white sm:min-h-0 sm:text-sm">
                    {
                      row.player_name
                    }
                  </div>

                  <div className="mt-1 text-[10px] text-emerald-200 sm:text-xs">
                    {row.owgr_rank
                      ? `OWGR #${row.owgr_rank}`
                      : "OWGR —"}
                  </div>
                </div>
              ),
            )}
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {metrics.map(
              (
                metric,
                metricIndex,
              ) => (
                <div
                  key={
                    metric.label
                  }
                  className={`grid items-stretch ${
                    metricIndex >
                    0
                      ? "border-t border-slate-100"
                      : ""
                  }`}
                  style={{
                    gridTemplateColumns:
                      `110px repeat(${rows.length}, minmax(0, 1fr))`,
                  }}
                >
                  <div className="flex items-center px-3 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-500 sm:px-4 sm:text-xs">
                    {
                      metric.label
                    }
                  </div>

                  {rows.map(
                    (
                      row,
                    ) => {
                      const best =
                        isBest(
                          metric,
                          row,
                        );

                      return (
                        <div
                          key={`${metric.label}-${row.player_id}`}
                          className={`flex items-center justify-center border-l border-slate-100 px-1 py-3 text-center text-sm font-black sm:px-3 sm:text-base ${
                            best
                              ? "bg-emerald-50 text-emerald-800"
                              : "text-slate-900"
                          }`}
                        >
                          <span>
                            {
                              metric.display(
                                row,
                              )
                            }
                          </span>

                          {best ? (
                            <span className="ml-1 text-[10px] text-emerald-600">
                              ✓
                            </span>
                          ) : null}
                        </div>
                      );
                    },
                  )}
                </div>
              ),
            )}
          </div>

          <div className="mt-3 text-center text-xs text-slate-500">
            Highlighted values are best among the selected golfers.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlayerHistoryPage() {
  const {
    selectedSport,
    isHydrated,
  } =
    useSelectedSport();

  const isGolf =
    selectedSport ===
    "golf";

  const [
    playerProjections,
    setPlayerProjections,
  ] =
    useState<
      Record<
        number,
        any
      >
    >({});

  const [
    rows,
    setRows,
  ] =
    useState<
      PlayerHistoryRow[]
    >([]);

  const [
    season,
    setSeason,
  ] =
    useState<
      number | "all"
    >(2026);

  const [
    searchTerm,
    setSearchTerm,
  ] =
    useState("");

  const [
    minTimesDrafted,
    setMinTimesDrafted,
  ] =
    useState<number>(
      0,
    );

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(true);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    sortKey,
    setSortKey,
  ] =
    useState<SortKey>(
      "times_drafted",
    );

  const [
    sortDirection,
    setSortDirection,
  ] =
    useState<SortDirection>(
      "desc",
    );

  const [
    profilePlayer,
    setProfilePlayer,
  ] =
    useState<Player | null>(
      null,
    );

  const [
    golfProfileRow,
    setGolfProfileRow,
  ] =
    useState<PlayerHistoryRow | null>(
      null,
    );

  const [
    compareMode,
    setCompareMode,
  ] =
    useState(false);

  const [
    comparePlayerIds,
    setComparePlayerIds,
  ] =
    useState<number[]>(
      [],
    );

  const [
    compareOpen,
    setCompareOpen,
  ] =
    useState(false);

  useEffect(() => {
    if (
      !isHydrated
    ) {
      return;
    }

    void loadPlayerHistory();
  }, [
    isHydrated,
    selectedSport,
    season,
  ]);

  useEffect(() => {
    setProfilePlayer(
      null,
    );

    setGolfProfileRow(
      null,
    );

    setCompareMode(
      false,
    );

    setComparePlayerIds(
      [],
    );

    setCompareOpen(
      false,
    );

    setSortKey(
      "times_drafted",
    );

    setSortDirection(
      "desc",
    );
  }, [
    selectedSport,
  ]);

  useEffect(() => {
    if (
      !isHydrated
    ) {
      return;
    }

    if (
      selectedSport !==
      "nba"
    ) {
      setPlayerProjections(
        {},
      );

      return;
    }

    async function loadPlayerProjections() {
      try {
        const response =
          await fetch(
            `/api/player-projections?season=${
              season ===
              "all"
                ? 2026
                : season
            }`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await response.json();

        setPlayerProjections(
          result.projections ??
            {},
        );
      } catch (
        error
      ) {
        console.error(
          error,
        );
      }
    }

    void loadPlayerProjections();
  }, [
    isHydrated,
    selectedSport,
    season,
  ]);

  async function loadPlayerHistory() {
    try {
      setIsLoading(
        true,
      );

      setMessage("");

      const response =
        await fetch(
          `/api/player-history?season=${season}&sport=${selectedSport}`,
          {
            cache:
              "no-store",
          },
        );

      const result =
        (
          await response.json()
        ) as
          | ApiResponse
          | {
              error?: string;
            };

      if (
        !response.ok
      ) {
        setMessage(
          "error" in
            result &&
            result.error
            ? result.error
            : "Failed to load player history.",
        );

        return;
      }

      const safeResult =
        result as ApiResponse;

      setRows(
        safeResult.playerHistory ??
          [],
      );
    } catch (
      error
    ) {
      console.error(
        error,
      );

      setMessage(
        "Something went wrong while loading player history.",
      );
    } finally {
      setIsLoading(
        false,
      );
    }
  }

  function defaultDirection(
    key:
      SortKey,
  ): SortDirection {
    if (
      key ===
      "player_name"
    ) {
      return "asc";
    }

    if (
      isGolf &&
      [
        "avg_score",
        "high_score",
        "low_score",
        "avg_finish",
      ].includes(
        key,
      )
    ) {
      return "asc";
    }

    return "desc";
  }

  function handleSort(
    nextKey:
      SortKey,
  ) {
    if (
      sortKey ===
      nextKey
    ) {
      setSortDirection(
        (
          previous,
        ) =>
          previous ===
          "asc"
            ? "desc"
            : "asc",
      );

      return;
    }

    setSortKey(
      nextKey,
    );

    setSortDirection(
      defaultDirection(
        nextKey,
      ),
    );
  }

  const filteredRows =
    useMemo(() => {
      const normalizedSearch =
        searchTerm
          .trim()
          .toLowerCase();

      const filtered =
        rows.filter(
          (row) => {
            const matchesSearch =
              !normalizedSearch ||
              row.player_name
                .toLowerCase()
                .includes(
                  normalizedSearch,
                );

            const matchesMinDrafted =
              row.times_drafted >=
              minTimesDrafted;

            return (
              matchesSearch &&
              matchesMinDrafted
            );
          },
        );

      filtered.sort(
        (a, b) => {
          let comparison =
            0;

          switch (
            sortKey
          ) {
            case "player_name":
              comparison =
                a.player_name.localeCompare(
                  b.player_name,
                );
              break;

            case "times_drafted":
              comparison =
                a.times_drafted -
                b.times_drafted;
              break;

            case "avg_score":
              comparison =
                a.avg_score -
                b.avg_score;
              break;

            case "high_score":
              comparison =
                a.high_score -
                b.high_score;
              break;

            case "low_score":
              comparison =
                a.low_score -
                b.low_score;
              break;

            case "winning_lineups":
              comparison =
                a.winning_lineups -
                b.winning_lineups;
              break;

            case "runner_up_lineups":
              comparison =
                a.runner_up_lineups -
                b.runner_up_lineups;
              break;

            case "podium_lineups":
              comparison =
                (
                  a.podium_lineups ??
                  0
                ) -
                (
                  b.podium_lineups ??
                  0
                );
              break;

            case "avg_finish":
              comparison =
                (
                  a.avg_finish ??
                  999
                ) -
                (
                  b.avg_finish ??
                  999
                );
              break;

            case "cuts_made_pct":
              comparison =
                (
                  a.cuts_made_pct ??
                  -1
                ) -
                (
                  b.cuts_made_pct ??
                  -1
                );
              break;

            case "birdies":
              comparison =
                (
                  a.birdies ??
                  0
                ) -
                (
                  b.birdies ??
                  0
                );
              break;

            case "eagles":
              comparison =
                (
                  a.eagles ??
                  0
                ) -
                (
                  b.eagles ??
                  0
                );
              break;

            case "albatrosses":
              comparison =
                (
                  a.albatrosses ??
                  0
                ) -
                (
                  b.albatrosses ??
                  0
                );
              break;

            case "holes_in_one":
              comparison =
                (
                  a.holes_in_one ??
                  0
                ) -
                (
                  b.holes_in_one ??
                  0
                );
              break;

            case "rounds_under_par":
              comparison =
                (
                  a.rounds_under_par ??
                  0
                ) -
                (
                  b.rounds_under_par ??
                  0
                );
              break;
          }

          if (
            comparison ===
            0
          ) {
            comparison =
              a.player_name.localeCompare(
                b.player_name,
              );
          }

          return (
            sortDirection ===
            "asc"
              ? comparison
              : -comparison
          );
        },
      );

      return filtered;
    }, [
      rows,
      searchTerm,
      minTimesDrafted,
      sortKey,
      sortDirection,
    ]);

  const playerAverageMap =
    useMemo(() => {
      const map =
        new Map<
          number,
          number
        >();

      rows.forEach(
        (row) => {
          map.set(
            row.player_id,
            row.avg_score,
          );
        },
      );

      return map;
    }, [
      rows,
    ]);

  function sortIndicator(
    key:
      SortKey,
  ) {
    if (
      sortKey !==
      key
    ) {
      return "";
    }

    return (
      sortDirection ===
      "asc"
        ? " ↑"
        : " ↓"
    );
  }

  function headerButton(
    label:
      string,
    key:
      SortKey,
  ) {
    return (
      <button
        type="button"
        onClick={() =>
          handleSort(
            key,
          )
        }
        className="whitespace-nowrap text-left font-semibold transition hover:text-emerald-700"
      >
        {label}
        {sortIndicator(
          key,
        )}
      </button>
    );
  }

  const compareRows =
    useMemo(
      () =>
        comparePlayerIds
          .map(
            (playerId) =>
              rows.find(
                (row) =>
                  row.player_id ===
                  playerId,
              ),
          )
          .filter(
            (
              row,
            ): row is PlayerHistoryRow =>
              Boolean(
                row,
              ),
          ),
      [
        comparePlayerIds,
        rows,
      ],
    );

  function toggleComparePlayer(
    row:
      PlayerHistoryRow,
  ) {
    setComparePlayerIds(
      (
        previous,
      ) => {
        if (
          previous.includes(
            row.player_id,
          )
        ) {
          return previous.filter(
            (playerId) =>
              playerId !==
              row.player_id,
          );
        }

        if (
          previous.length >=
          3
        ) {
          return previous;
        }

        return [
          ...previous,
          row.player_id,
        ];
      },
    );
  }

  function handleGolfRowClick(
    row:
      PlayerHistoryRow,
  ) {
    if (
      compareMode
    ) {
      toggleComparePlayer(
        row,
      );

      return;
    }

    openPlayerProfile(
      row,
    );
  }

  function cancelCompareMode() {
    setCompareMode(
      false,
    );

    setComparePlayerIds(
      [],
    );

    setCompareOpen(
      false,
    );
  }

  function isCompareSelected(
    row:
      PlayerHistoryRow,
  ) {
    return comparePlayerIds.includes(
      row.player_id,
    );
  }

  function isVisibleSortSlotActive(
    slot:
      | "avg"
      | "best"
      | "wins"
      | "cuts"
      | "dynamic",
  ) {
    if (
      slot ===
      "avg"
    ) {
      return (
        sortKey ===
        "avg_score"
      );
    }

    if (
      slot ===
      "best"
    ) {
      return (
        sortKey ===
        "high_score"
      );
    }

    if (
      slot ===
      "wins"
    ) {
      return (
        sortKey ===
        "winning_lineups"
      );
    }

    if (
      slot ===
      "cuts"
    ) {
      return (
        sortKey ===
        "cuts_made_pct"
      );
    }

    return ![
      "avg_score",
      "high_score",
      "winning_lineups",
      "cuts_made_pct",
      "player_name",
    ].includes(
      sortKey,
    );
  }

  function getGolfMobileDynamicStat(
    row:
      PlayerHistoryRow,
  ) {
    switch (
      sortKey
    ) {
      case "times_drafted":
        return {
          value:
            row.times_drafted,
          label:
            "Drafted",
        };

      case "podium_lineups":
        return {
          value:
            row.podium_lineups ??
            0,
          label:
            (
              row.podium_lineups ??
              0
            ) === 1
              ? "Podium"
              : "Podiums",
        };

      case "avg_finish":
        return {
          value:
            row.avg_finish ===
            null
              ? "—"
              : fmt(
                  row.avg_finish,
                  1,
                ),
          label:
            "Avg Finish",
        };

      case "cuts_made_pct":
        return {
          value:
            row.cuts_made_pct ===
              null ||
            row.cuts_made_pct ===
              undefined
              ? "—"
              : `${fmt(
                  row.cuts_made_pct,
                  0,
                )}%`,
          label:
            "Cuts",
        };

      case "birdies":
        return {
          value:
            row.birdies ??
            0,
          label:
            "Birdies",
        };

      case "eagles":
        return {
          value:
            row.eagles ??
            0,
          label:
            (
              row.eagles ??
              0
            ) === 1
              ? "Eagle"
              : "Eagles",
        };

      case "albatrosses":
        return {
          value:
            row.albatrosses ??
            0,
          label:
            (
              row.albatrosses ??
              0
            ) === 1
              ? "Albatross"
              : "Albatrosses",
        };

      case "holes_in_one":
        return {
          value:
            row.holes_in_one ??
            0,
          label:
            (
              row.holes_in_one ??
              0
            ) === 1
              ? "Ace"
              : "Aces",
        };

      case "rounds_under_par":
        return {
          value:
            row.rounds_under_par ??
            0,
          label:
            "Rds Under",
        };

      /*
       * Avg Score is already prominent in the upper-right.
       * Best Score and Wins already have permanent slots.
       * Name sorting also does not need a duplicate metric.
       */
      case "avg_score":
      case "high_score":
      case "winning_lineups":
      case "player_name":
      default:
        return {
          value:
            row.times_drafted,
          label:
            "Drafted",
        };
    }
  }

  function openPlayerProfile(
    row:
      PlayerHistoryRow,
  ) {
    if (
      isGolf
    ) {
      setGolfProfileRow(
        row,
      );

      return;
    }

    setProfilePlayer({
      id:
        row.player_id,
      name:
        row.player_name,
      nba_player_id:
        row.nba_player_id,
      nfl_player_id:
        row.nfl_player_id,
      position_group:
        "G",
      is_active:
        true,
      is_playing_today:
        null,
    });
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section
          className={`rounded-3xl border px-5 py-6 shadow-sm ${
            isGolf
              ? "border-emerald-200 bg-gradient-to-br from-emerald-950 via-emerald-900 to-slate-950 text-white"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p
                className={`text-sm font-bold uppercase tracking-[0.18em] ${
                  isGolf
                    ? "text-emerald-300"
                    : "text-sky-700"
                }`}
              >
                {isGolf
                  ? "Golfer History"
                  : "Player History"}
              </p>

              <h1 className="mt-2 text-3xl font-black tracking-tight">
                {isGolf
                  ? "Golfer Stats"
                  : "Player Stats"}
              </h1>

              <p
                className={`mt-2 max-w-2xl text-sm ${
                  isGolf
                    ? "text-emerald-100"
                    : "text-slate-600"
                }`}
              >
                {isGolf
                  ? "Career performance, league impact, cuts, and scoring history for every drafted golfer."
                  : "Explore past performance and trends for all players."}
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                void loadPlayerHistory()
              }
              className={
                isGolf
                  ? "rounded-xl border border-emerald-300/40 bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/20"
                  : "rounded-xl border border-sky-300 bg-sky-100 px-4 py-3 text-sm font-medium text-sky-900 transition hover:bg-sky-200"
              }
            >
              Refresh{" "}
              {isGolf
                ? "Golfer"
                : "Player"}{" "}
              History
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-3">
            <div>
              <label
                htmlFor="player-search"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Search{" "}
                {isGolf
                  ? "golfers"
                  : "players"}
              </label>

              <input
                id="player-search"
                type="text"
                value={
                  searchTerm
                }
                onChange={
                  (
                    event,
                  ) =>
                    setSearchTerm(
                      event.target.value,
                    )
                }
                placeholder={
                  isGolf
                    ? "Search by golfer name"
                    : "Search by player name"
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="min-times-drafted"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Min Drafted
                </label>

                <select
                  id="min-times-drafted"
                  value={
                    minTimesDrafted
                  }
                  onChange={
                    (
                      event,
                    ) =>
                      setMinTimesDrafted(
                        Number(
                          event.target.value,
                        ),
                      )
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-300"
                >
                  <option value={0}>
                    Any
                  </option>
                  <option value={2}>
                    2+
                  </option>
                  <option value={3}>
                    3+
                  </option>
                  <option value={5}>
                    5+
                  </option>
                  <option value={10}>
                    10+
                  </option>
                  <option value={15}>
                    15+
                  </option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="season-select"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Season
                </label>

                <select
                  id="season-select"
                  value={
                    season
                  }
                  onChange={
                    (
                      event,
                    ) =>
                      setSeason(
                        event.target.value ===
                          "all"
                          ? "all"
                          : Number(
                              event.target.value,
                            ),
                      )
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-300"
                >
                  <option value="all">
                    All-Time
                  </option>

                  {[
                    2026,
                    2025,
                    2024,
                    2023,
                  ].map(
                    (
                      year,
                    ) => (
                      <option
                        key={
                          year
                        }
                        value={
                          year
                        }
                      >
                        {
                          year
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>
          </div>

          {message ? (
            <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              {message}
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          {!isLoading ? (
            <div className="mb-3 text-sm text-slate-500">
              Showing{" "}
              {
                filteredRows.length
              }{" "}
              of{" "}
              {
                rows.length
              }{" "}
              {isGolf
                ? "golfers"
                : "players"}
              {minTimesDrafted >
              0
                ? ` with ${minTimesDrafted}+ drafts`
                : ""}
              .
            </div>
          ) : null}

          {isGolf &&
          !isLoading &&
          filteredRows.length >
            0 ? (
            <div className="mb-4 rounded-2xl border border-emerald-700/50 bg-slate-900/80 p-3">
              {!compareMode ? (
                <button
                  type="button"
                  onClick={() => {
                    setCompareMode(
                      true,
                    );

                    setComparePlayerIds(
                      [],
                    );
                  }}
                  className="w-full rounded-xl border border-emerald-300 bg-white px-4 py-3 text-sm font-black text-emerald-800 transition hover:bg-emerald-50 sm:w-auto"
                >
                  ⇄ Compare Golfers
                </button>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-black text-white">
                      Select 2–3 golfers
                    </div>

                    <div className="mt-0.5 text-xs text-emerald-300">
                      Tap a golfer to add or remove them.
                      {" "}
                      {
                        comparePlayerIds.length
                      }
                      /3 selected
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={
                        cancelCompareMode
                      }
                      className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700 sm:px-4 sm:py-2.5"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      disabled={
                        comparePlayerIds.length <
                        2
                      }
                      onClick={() =>
                        setCompareOpen(
                          true,
                        )
                      }
                      className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white transition enabled:hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:py-2.5"
                    >
                      Compare (
                      {
                        comparePlayerIds.length
                      }
                      )
                    </button>
                  </div>
                </div>
              )}

              {compareMode &&
              compareRows.length >
                0 ? (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-emerald-800/60 pt-3">
                  {compareRows.map(
                    (
                      row,
                    ) => (
                      <button
                        key={
                          row.player_id
                        }
                        type="button"
                        onClick={() =>
                          toggleComparePlayer(
                            row,
                          )
                        }
                        className="rounded-full bg-emerald-800 px-3 py-1.5 text-xs font-bold text-white"
                      >
                        {
                          row.player_name
                        }{" "}
                        ×
                      </button>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {isLoading ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading{" "}
              {isGolf
                ? "golfer"
                : "player"}{" "}
              history...
            </div>
          ) : filteredRows.length ===
            0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No{" "}
              {isGolf
                ? "golfer"
                : "player"}{" "}
              history found.
            </div>
          ) : isGolf ? (
            <>
              <div className="mb-4 flex items-end gap-2 md:hidden">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="golf-mobile-sort"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    Sort by
                  </label>

                  <select
                    id="golf-mobile-sort"
                    value={
                      sortKey
                    }
                    onChange={
                      (
                        event,
                      ) => {
                        const nextKey =
                          event.target.value as SortKey;

                        setSortKey(
                          nextKey,
                        );

                        setSortDirection(
                          defaultDirection(
                            nextKey,
                          ),
                        );
                      }
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-emerald-300"
                  >
                    <option value="times_drafted">
                      Times Drafted
                    </option>

                    <option value="avg_score">
                      Avg Score
                    </option>

                    <option value="high_score">
                      Best Score
                    </option>

                    <option value="winning_lineups">
                      Wins
                    </option>

                    <option value="podium_lineups">
                      Podiums
                    </option>

                    <option value="avg_finish">
                      Avg Finish
                    </option>

                    <option value="cuts_made_pct">
                      Cuts %
                    </option>

                    <option value="birdies">
                      Birdies
                    </option>

                    <option value="eagles">
                      Eagles
                    </option>

                    <option value="albatrosses">
                      Albatrosses
                    </option>

                    <option value="holes_in_one">
                      Aces
                    </option>

                    <option value="rounds_under_par">
                      Rounds Under Par
                    </option>

                    <option value="player_name">
                      Golfer Name
                    </option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSortDirection(
                      (
                        previous,
                      ) =>
                        previous ===
                        "asc"
                          ? "desc"
                          : "asc",
                    )
                  }
                  className="flex h-[46px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-xl font-black text-emerald-800 transition hover:bg-emerald-50"
                  aria-label={
                    sortDirection ===
                    "asc"
                      ? "Sort descending"
                      : "Sort ascending"
                  }
                  title={
                    sortDirection ===
                    "asc"
                      ? "Ascending"
                      : "Descending"
                  }
                >
                  {sortDirection ===
                  "asc"
                    ? "↑"
                    : "↓"}
                </button>
              </div>

              <div className="space-y-3 md:hidden">
                {filteredRows.map(
                  (
                    row,
                  ) => (
                    <button
                      key={
                        row.player_id
                      }
                      type="button"
                      onClick={() =>
                        handleGolfRowClick(
                          row,
                        )
                      }
                      className={`relative w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
                        isCompareSelected(
                          row,
                        )
                          ? "border-emerald-400 ring-2 ring-emerald-300/50"
                          : "border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40"
                      }`}
                    >
                      {compareMode &&
                      isCompareSelected(
                        row,
                      ) ? (
                        <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-black text-white">
                          ✓
                        </div>
                      ) : null}

                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-slate-100">
                          {row.headshot_url ||
                          row.espn_golf_player_id ? (
                            <img
                              src={
                                row.headshot_url ??
                                `https://a.espncdn.com/i/headshots/golf/players/full/${row.espn_golf_player_id}.png`
                              }
                              alt={
                                row.player_name
                              }
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              ⛳
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-black text-slate-950">
                            {
                              row.player_name
                            }
                          </div>

                          <div className="mt-0.5 text-xs text-slate-500">
                            Drafted{" "}
                            {
                              row.times_drafted
                            }
                            x
                            {row.owgr_rank
                              ? ` · OWGR #${row.owgr_rank}`
                              : ""}
                          </div>
                        </div>

                        <div
                          className={`rounded-xl px-2 py-1 text-right ${
                            isVisibleSortSlotActive(
                              "avg",
                            )
                              ? "border border-emerald-300/60 bg-emerald-50"
                              : ""
                          }`}
                        >
                          <div
                            className={`text-xl font-black ${
                              isVisibleSortSlotActive(
                                "avg",
                              )
                                ? "text-emerald-800"
                                : "text-emerald-800"
                            }`}
                          >
                            {golfScore(
                              row.avg_score,
                            )}
                          </div>

                          <div
                            className={`text-[10px] font-bold uppercase tracking-wide ${
                              isVisibleSortSlotActive(
                                "avg",
                              )
                                ? "text-emerald-700"
                                : "text-slate-400"
                            }`}
                          >
                            Avg
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3 text-center">
                        <div
                          className={`rounded-xl px-1.5 py-1.5 ${
                            isVisibleSortSlotActive(
                              "best",
                            )
                              ? "border border-emerald-300/60 bg-emerald-50"
                              : ""
                          }`}
                        >
                          <div
                            className={`font-black ${
                              isVisibleSortSlotActive(
                                "best",
                              )
                                ? "text-emerald-800"
                                : "text-slate-900"
                            }`}
                          >
                            {golfScore(
                              row.high_score,
                            )}
                          </div>

                          <div
                            className={`text-[10px] uppercase ${
                              isVisibleSortSlotActive(
                                "best",
                              )
                                ? "font-bold text-emerald-700"
                                : "text-slate-400"
                            }`}
                          >
                            Best
                          </div>
                        </div>

                        <div
                          className={`rounded-xl px-1.5 py-1.5 ${
                            isVisibleSortSlotActive(
                              "wins",
                            )
                              ? "border border-emerald-300/60 bg-emerald-50"
                              : ""
                          }`}
                        >
                          <div
                            className={`font-black ${
                              isVisibleSortSlotActive(
                                "wins",
                              )
                                ? "text-emerald-800"
                                : "text-slate-900"
                            }`}
                          >
                            {
                              row.winning_lineups
                            }
                          </div>

                          <div
                            className={`text-[10px] uppercase ${
                              isVisibleSortSlotActive(
                                "wins",
                              )
                                ? "font-bold text-emerald-700"
                                : "text-slate-400"
                            }`}
                          >
                            Wins
                          </div>
                        </div>

                        <div
                          className={`rounded-xl px-1.5 py-1.5 ${
                            isVisibleSortSlotActive(
                              "cuts",
                            )
                              ? "border border-emerald-300/60 bg-emerald-50"
                              : ""
                          }`}
                        >
                          <div
                            className={`font-black ${
                              isVisibleSortSlotActive(
                                "cuts",
                              )
                                ? "text-emerald-800"
                                : "text-slate-900"
                            }`}
                          >
                            {cutDisplay(
                              row.cuts_made,
                              row.cut_opportunities,
                            )}
                          </div>

                          <div
                            className={`text-[10px] uppercase ${
                              isVisibleSortSlotActive(
                                "cuts",
                              )
                                ? "font-bold text-emerald-700"
                                : "text-slate-400"
                            }`}
                          >
                            Cuts
                          </div>
                        </div>

                        <div
                          className={`rounded-xl px-1.5 py-1.5 ${
                            isVisibleSortSlotActive(
                              "dynamic",
                            )
                              ? "border border-emerald-300/60 bg-emerald-50"
                              : ""
                          }`}
                        >
                          <div
                            className={`font-black ${
                              isVisibleSortSlotActive(
                                "dynamic",
                              )
                                ? "text-emerald-800"
                                : "text-slate-900"
                            }`}
                          >
                            {
                              getGolfMobileDynamicStat(
                                row,
                              ).value
                            }
                          </div>

                          <div
                            className={`text-[10px] uppercase ${
                              isVisibleSortSlotActive(
                                "dynamic",
                              )
                                ? "font-bold text-emerald-700"
                                : "text-slate-400"
                            }`}
                          >
                            {
                              getGolfMobileDynamicStat(
                                row,
                              ).label
                            }
                          </div>
                        </div>
                      </div>

                      {(row.albatrosses ??
                        0) >
                        0 ||
                      (row.holes_in_one ??
                        0) >
                        0 ? (
                        <div className="mt-3 flex gap-2">
                          {(row.albatrosses ??
                            0) >
                          0 ? (
                            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-800">
                              🦅{" "}
                              {
                                row.albatrosses
                              }{" "}
                              Albatross
                            </span>
                          ) : null}

                          {(row.holes_in_one ??
                            0) >
                          0 ? (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                              ⛳{" "}
                              {
                                row.holes_in_one
                              }{" "}
                              Ace
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </button>
                  ),
                )}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-[1250px] border-collapse text-sm">
                  <thead className="bg-emerald-50 text-slate-700">
                    <tr className="text-left">
                      <th className="px-4 py-3">
                        {headerButton(
                          "Golfer",
                          "player_name",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Drafted",
                          "times_drafted",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Avg",
                          "avg_score",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Best",
                          "high_score",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Wins",
                          "winning_lineups",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Podiums",
                          "podium_lineups",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Avg Finish",
                          "avg_finish",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Cuts",
                          "cuts_made_pct",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Birdies",
                          "birdies",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Eagles",
                          "eagles",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Albatross",
                          "albatrosses",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Aces",
                          "holes_in_one",
                        )}
                      </th>

                      <th className="px-3 py-3">
                        {headerButton(
                          "Rds Under",
                          "rounds_under_par",
                        )}
                      </th>
                    </tr>
                  </thead>

                  <tbody className="bg-white text-slate-800">
                    {filteredRows.map(
                      (
                        row,
                      ) => (
                        <tr
                          key={
                            row.player_id
                          }
                          className="border-t border-slate-100 transition hover:bg-emerald-50/40"
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                handleGolfRowClick(
                                  row,
                                )
                              }
                              className={`flex items-center gap-3 rounded-xl px-2 py-1 text-left font-bold transition ${
                                isCompareSelected(
                                  row,
                                )
                                  ? "bg-emerald-100 text-emerald-950 ring-2 ring-emerald-300"
                                  : "text-emerald-800 hover:text-emerald-950"
                              }`}
                            >
                              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-slate-100">
                                {row.headshot_url ||
                                row.espn_golf_player_id ? (
                                  <img
                                    src={
                                      row.headshot_url ??
                                      `https://a.espncdn.com/i/headshots/golf/players/full/${row.espn_golf_player_id}.png`
                                    }
                                    alt={
                                      row.player_name
                                    }
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-sm">
                                    ⛳
                                  </div>
                                )}
                              </div>

                              <div>
                                <div>
                                  {
                                    row.player_name
                                  }
                                </div>

                                {row.owgr_rank ? (
                                  <div className="text-[10px] font-medium text-slate-400">
                                    OWGR #
                                    {
                                      row.owgr_rank
                                    }
                                  </div>
                                ) : null}
                              </div>
                            </button>
                          </td>

                          <td className="px-3 py-3 font-semibold">
                            {
                              row.times_drafted
                            }
                          </td>

                          <td className="px-3 py-3 font-black text-emerald-800">
                            {golfScore(
                              row.avg_score,
                            )}
                          </td>

                          <td className="px-3 py-3">
                            {golfScore(
                              row.high_score,
                            )}
                          </td>

                          <td className="px-3 py-3 font-bold">
                            {
                              row.winning_lineups
                            }
                          </td>

                          <td className="px-3 py-3">
                            {
                              row.podium_lineups ??
                              0
                            }
                          </td>

                          <td className="px-3 py-3">
                            {row.avg_finish ===
                            null
                              ? "—"
                              : fmt(
                                  row.avg_finish,
                                  1,
                                )}
                          </td>

                          <td className="px-3 py-3">
                            {cutDisplay(
                              row.cuts_made,
                              row.cut_opportunities,
                            )}
                          </td>

                          <td className="px-3 py-3">
                            {
                              row.birdies ??
                              0
                            }
                          </td>

                          <td className="px-3 py-3">
                            {
                              row.eagles ??
                              0
                            }
                          </td>

                          <td
                            className={`px-3 py-3 ${
                              (
                                row.albatrosses ??
                                0
                              ) >
                              0
                                ? "font-black text-violet-700"
                                : ""
                            }`}
                          >
                            {
                              row.albatrosses ??
                              0
                            }
                          </td>

                          <td
                            className={`px-3 py-3 ${
                              (
                                row.holes_in_one ??
                                0
                              ) >
                              0
                                ? "font-black text-amber-700"
                                : ""
                            }`}
                          >
                            {
                              row.holes_in_one ??
                              0
                            }
                          </td>

                          <td className="px-3 py-3">
                            {
                              row.rounds_under_par ??
                              0
                            }
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="text-left">
                    <th className="px-4 py-3">
                      {headerButton(
                        "Player",
                        "player_name",
                      )}
                    </th>

                    <th className="px-4 py-3">
                      {headerButton(
                        "Times Drafted",
                        "times_drafted",
                      )}
                    </th>

                    <th className="px-4 py-3">
                      {headerButton(
                        "Avg Score",
                        "avg_score",
                      )}
                    </th>

                    <th className="px-4 py-3">
                      {headerButton(
                        "High Score",
                        "high_score",
                      )}
                    </th>

                    <th className="px-4 py-3">
                      {headerButton(
                        "Low Score",
                        "low_score",
                      )}
                    </th>

                    <th className="px-4 py-3">
                      {headerButton(
                        "Winning Lineups",
                        "winning_lineups",
                      )}
                    </th>

                    <th className="px-4 py-3">
                      {headerButton(
                        "Runner-up Lineups",
                        "runner_up_lineups",
                      )}
                    </th>

                    <th className="px-4 py-3">
                      {headerButton(
                        "Avg Finish",
                        "avg_finish",
                      )}
                    </th>
                  </tr>
                </thead>

                <tbody className="bg-white text-slate-800">
                  {filteredRows.map(
                    (
                      row,
                    ) => (
                      <tr
                        key={
                          row.player_id
                        }
                        className="border-t border-slate-100"
                      >
                        <td className="px-4 py-3 font-medium">
                          <button
                            type="button"
                            onClick={() =>
                              openPlayerProfile(
                                row,
                              )
                            }
                            className="flex items-center gap-2 font-medium text-sky-700 underline-offset-2 hover:text-sky-900 hover:underline"
                          >
                            <PlayerHeadshot
                              nbaPlayerId={
                                row.nba_player_id
                              }
                              nflPlayerId={
                                row.nfl_player_id
                              }
                              playerName={
                                row.player_name
                              }
                              size="xs"
                            />

                            <span>
                              {
                                row.player_name
                              }
                            </span>
                          </button>
                        </td>

                        <td className="px-4 py-3">
                          {
                            row.times_drafted
                          }
                        </td>

                        <td className="px-4 py-3">
                          {row.avg_score.toFixed(
                            2,
                          )}
                        </td>

                        <td className="px-4 py-3">
                          {row.high_score.toFixed(
                            2,
                          )}
                        </td>

                        <td className="px-4 py-3">
                          {row.low_score.toFixed(
                            2,
                          )}
                        </td>

                        <td className="px-4 py-3">
                          {
                            row.winning_lineups
                          }
                        </td>

                        <td className="px-4 py-3">
                          {
                            row.runner_up_lineups
                          }
                        </td>

                        <td className="px-4 py-3">
                          {row.avg_finish
                            ? row.avg_finish.toFixed(
                                2,
                              )
                            : "—"}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {!isGolf ? (
        <ReadOnlyPlayerModal
          player={
            profilePlayer
          }
          setPlayer={
            setProfilePlayer
          }
          playerAverageMap={
            playerAverageMap
          }
          playerProjections={
            playerProjections
          }
        />
      ) : null}

      <GolfPlayerHistoryModal
        row={
          golfProfileRow
        }
        season={
          season
        }
        onClose={() =>
          setGolfProfileRow(
            null,
          )
        }
      />

      {compareOpen ? (
        <GolfCompareModal
          rows={
            compareRows
          }
          onClose={() =>
            setCompareOpen(
              false,
            )
          }
        />
      ) : null}
    </main>
  );
}
