"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import PlayerHeadshot from "@/components/ui/PlayerHeadshot";

type Sport =
  | "nba"
  | "nfl"
  | "golf";

type Mode =
  | "season"
  | "league";

export type ResearchPlayer = {
  id: number;
  name: string;

  nbaPlayerId?: number | null;
  nflPlayerId?: number | null;
  espnGolfPlayerId?: string | null;

  headshotUrl?: string | null;

  positionGroup?: string | null;
  teamAbbreviation?: string | null;

  owgrRank?: number | null;
  country?: string | null;
};

type Props = {
  player:
    ResearchPlayer | null;

  sport:
    Sport;

  season:
    number | "all";

  defaultMode:
    Mode;

  onClose:
    () => void;
};

type LeagueProfile = {
  summary?: {
    timesDrafted?: number;
    wins?: number;
    runnerUps?: number;
    podiums?: number;

    winRate?:
      number | null;

    averageFantasyPoints?:
      number | null;

    bestFantasyPoints?:
      number | null;

    worstFantasyPoints?:
      number | null;

    averageFinish?:
      number | null;

    cutsMade?: number;
    cutOpportunities?: number;

    cutsMadePct?:
      number | null;

    roundsUnderPar?: number;
    completedRounds?: number;

    draftedMostBy?: {
      teamName: string;
      count: number;
    } | null;

    draftedByBreakdown?: Array<{
      teamName: string;
      count: number;
    }>;
  };

  recentHistory?: Array<{
    slateId?: number;
    slateLabel?: string;
    teamName?: string;

    finishPosition?:
      number | null;

    fantasyPoints?:
      number | null;

    golferScore?:
      number | null;
  }>;
};

function fmt(
  value:
    number |
    null |
    undefined,
  digits = 1,
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(
        value,
      ),
    )
  ) {
    return "—";
  }

  return Number(
    value,
  ).toFixed(
    digits,
  );
}

function pct(
  value:
    number |
    null |
    undefined,
  digits = 0,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return `${fmt(
    value,
    digits,
  )}%`;
}

function ordinal(
  value:
    number |
    null |
    undefined,
) {
  if (
    !value
  ) {
    return "—";
  }

  const mod100 =
    value % 100;

  if (
    mod100 >= 11 &&
    mod100 <= 13
  ) {
    return `${value}th`;
  }

  const suffix =
    value % 10 === 1
      ? "st"
      : value % 10 === 2
        ? "nd"
        : value % 10 === 3
          ? "rd"
          : "th";

  return `${value}${suffix}`;
}

function formatSlateLabel(
  value:
    string |
    null |
    undefined,
) {
  const label =
    String(
      value ??
      "",
    ).trim();

  if (!label) {
    return "Slate";
  }

  function formatSingleDate(
    raw:
      string,
  ) {
    const match =
      raw.match(
        /^(\d{4})-(\d{2})-(\d{2})$/,
      );

    if (!match) {
      return raw;
    }

    const [
      ,
      year,
      month,
      day,
    ] = match;

    const date =
      new Date(
        Number(
          year,
        ),
        Number(
          month,
        ) - 1,
        Number(
          day,
        ),
        12,
        0,
        0,
      );

    return date;
  }

  /*
   * Single-day slate:
   * 2026-05-10
   * → May 10, 2026
   */
  const single =
    formatSingleDate(
      label,
    );

  if (
    single instanceof
    Date
  ) {
    return single.toLocaleDateString(
      "en-US",
      {
        month:
          "long",
        day:
          "numeric",
        year:
          "numeric",
      },
    );
  }

  /*
   * Multi-day slate:
   * 2026-05-25 - 2026-05-26
   *
   * Same month/year:
   * → May 25–26, 2026
   *
   * Different months:
   * → May 31 – June 1, 2026
   *
   * Different years:
   * → December 31, 2025 – January 1, 2026
   */
  const rangeMatch =
    label.match(
      /^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/,
    );

  if (!rangeMatch) {
    return label;
  }

  const startDate =
    formatSingleDate(
      rangeMatch[1],
    );

  const endDate =
    formatSingleDate(
      rangeMatch[2],
    );

  if (
    !(
      startDate instanceof
      Date
    ) ||
    !(
      endDate instanceof
      Date
    )
  ) {
    return label;
  }

  const sameYear =
    startDate.getFullYear() ===
    endDate.getFullYear();

  const sameMonth =
    sameYear &&
    startDate.getMonth() ===
      endDate.getMonth();

  if (
    sameMonth
  ) {
    const month =
      startDate.toLocaleDateString(
        "en-US",
        {
          month:
            "long",
        },
      );

    return (
      `${month} ` +
      `${startDate.getDate()}–${endDate.getDate()}, ` +
      `${endDate.getFullYear()}`
    );
  }

  if (
    sameYear
  ) {
    const startText =
      startDate.toLocaleDateString(
        "en-US",
        {
          month:
            "long",
          day:
            "numeric",
        },
      );

    const endText =
      endDate.toLocaleDateString(
        "en-US",
        {
          month:
            "long",
          day:
            "numeric",
          year:
            "numeric",
        },
      );

    return (
      `${startText} – ${endText}`
    );
  }

  return (
    `${startDate.toLocaleDateString(
      "en-US",
      {
        month:
          "long",
        day:
          "numeric",
        year:
          "numeric",
      },
    )} – ` +
    `${endDate.toLocaleDateString(
      "en-US",
      {
        month:
          "long",
        day:
          "numeric",
        year:
          "numeric",
      },
    )}`
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value:
    string |
    number;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/85 p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>

      <div className="mt-1 text-xl font-black text-white">
        {value}
      </div>

      {detail ? (
        <div className="mt-1 text-[11px] text-slate-400">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export default function PlayerResearchModal({
  player,
  sport,
  season,
  defaultMode,
  onClose,
}: Props) {
  const [
    mode,
    setMode,
  ] =
    useState<Mode>(
      defaultMode,
    );

  const [
    seasonRow,
    setSeasonRow,
  ] =
    useState<any | null>(
      null,
    );

  const [
    leagueProfile,
    setLeagueProfile,
  ] =
    useState<LeagueProfile | null>(
      null,
    );

  const [
    seasonLoading,
    setSeasonLoading,
  ] =
    useState(false);

  const [
    leagueLoading,
    setLeagueLoading,
  ] =
    useState(false);

  const [
    seasonError,
    setSeasonError,
  ] =
    useState("");

  const [
    leagueError,
    setLeagueError,
  ] =
    useState("");

  const effectiveSeason =
    season ===
    "all"
      ? 2026
      : season;

  useEffect(() => {
    setMode(
      defaultMode,
    );
  }, [
    player?.id,
    defaultMode,
  ]);

  useEffect(() => {
    if (!player) {
      setSeasonRow(
        null,
      );

      return;
    }

    const currentPlayer =
      player;

    let active =
      true;

    async function loadSeason() {
      try {
        setSeasonLoading(
          true,
        );

        setSeasonError(
          "",
        );

        const response =
          await fetch(
            `/api/player-season-stats?season=${effectiveSeason}&sport=${sport}`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await response.json();

        if (!active) {
          return;
        }

        if (
          !response.ok ||
          result.available ===
            false
        ) {
          setSeasonRow(
            null,
          );

          setSeasonError(
            result.message ??
              result.error ??
              "Season statistics are not available.",
          );

          return;
        }

        const rows =
          result.playerStats ??
          result.playerSeasonStats ??
          result.players ??
          [];

        const match =
          Array.isArray(
            rows,
          )
            ? rows.find(
                (
                  row:
                    any,
                ) =>
                  Number(
                    row.player_id,
                  ) ===
                  currentPlayer.id,
              )
            : null;

        setSeasonRow(
          match ??
            null,
        );

        if (!match) {
          setSeasonError(
            "No professional season statistics were found for this player.",
          );
        }
      } catch (
        error
      ) {
        console.error(
          "Unable to load professional player profile",
          error,
        );

        if (active) {
          setSeasonRow(
            null,
          );

          setSeasonError(
            "Unable to load professional season statistics.",
          );
        }
      } finally {
        if (active) {
          setSeasonLoading(
            false,
          );
        }
      }
    }

    void loadSeason();

    return () => {
      active =
        false;
    };
  }, [
    player?.id,
    sport,
    effectiveSeason,
  ]);

  useEffect(() => {
    if (!player) {
      setLeagueProfile(
        null,
      );

      return;
    }

    const currentPlayer =
      player;

    let active =
      true;

    async function loadLeague() {
      try {
        setLeagueLoading(
          true,
        );

        setLeagueError(
          "",
        );

        const response =
          await fetch(
            `/api/player-league-profile?playerId=${currentPlayer.id}&season=${season}&sport=${sport}`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await response.json();

        if (!active) {
          return;
        }

        if (!response.ok) {
          setLeagueProfile(
            null,
          );

          setLeagueError(
            result.error ??
              "Unable to load 111 Sports history.",
          );

          return;
        }

        setLeagueProfile(
          result as LeagueProfile,
        );
      } catch (
        error
      ) {
        console.error(
          "Unable to load league player profile",
          error,
        );

        if (active) {
          setLeagueProfile(
            null,
          );

          setLeagueError(
            "Unable to load 111 Sports history.",
          );
        }
      } finally {
        if (active) {
          setLeagueLoading(
            false,
          );
        }
      }
    }

    void loadLeague();

    return () => {
      active =
        false;
    };
  }, [
    player?.id,
    sport,
    season,
  ]);

  useEffect(() => {
    if (!player) {
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

    return () =>
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
  }, [
    player,
    onClose,
  ]);

  const leagueSummary =
    leagueProfile?.summary;

  const seasonSubtitle =
    sport ===
    "golf"
      ? `${effectiveSeason} PGA Season`
      : sport ===
          "nfl"
        ? `${effectiveSeason} NFL Season`
        : `${effectiveSeason} NBA Season`;

  const identitySecondary =
    useMemo(
      () =>
        [
          player?.teamAbbreviation,
          player?.positionGroup,
        ]
          .filter(
            Boolean,
          )
          .join(
            " · ",
          ),
      [
        player?.teamAbbreviation,
        player?.positionGroup,
      ],
    );

  if (!player) {
    return null;
  }

  const currentPlayer =
    player;

  function renderNbaSeason() {
    if (!seasonRow) {
      return null;
    }

    return (
      <>
        <section>
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-sky-300">
            Season Box Score
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Fantasy Points"
              value={
                fmt(
                  seasonRow.fantasy_points,
                  1,
                )
              }
              detail="111 scoring"
            />

            <StatCard
              label="Points"
              value={
                fmt(
                  seasonRow.points,
                  1,
                )
              }
            />

            <StatCard
              label="Rebounds"
              value={
                fmt(
                  seasonRow.rebounds,
                  1,
                )
              }
            />

            <StatCard
              label="Assists"
              value={
                fmt(
                  seasonRow.assists,
                  1,
                )
              }
            />

            <StatCard
              label="Steals"
              value={
                fmt(
                  seasonRow.steals,
                  1,
                )
              }
            />

            <StatCard
              label="Blocks"
              value={
                fmt(
                  seasonRow.blocks,
                  1,
                )
              }
            />

            <StatCard
              label="Turnovers"
              value={
                fmt(
                  seasonRow.turnovers,
                  1,
                )
              }
            />

            <StatCard
              label="Games"
              value={
                seasonRow.games_played ??
                "—"
              }
            />
          </div>
        </section>
      </>
    );
  }

  function renderNflSeason() {
    if (!seasonRow) {
      return null;
    }

    const position =
      String(
        seasonRow.position_group ??
        seasonRow.position ??
        currentPlayer.positionGroup ??
        "",
      ).toUpperCase();

    const isQuarterback =
      position ===
      "QB";

    return (
      <div className="space-y-5">
        <section>
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-sky-300">
            Season Production
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Fantasy Points / Game"
              value={
                fmt(
                  seasonRow.fantasy_points_per_game,
                  2,
                )
              }
              detail="111 scoring"
            />

            <StatCard
              label="Games"
              value={
                seasonRow.games_played ??
                "—"
              }
            />

            {isQuarterback ? (
              <>
                <StatCard
                  label="Pass Yards / Game"
                  value={
                    fmt(
                      seasonRow.passing_yards_per_game,
                      1,
                    )
                  }
                />

                <StatCard
                  label="Pass TD / Game"
                  value={
                    fmt(
                      seasonRow.passing_tds_per_game,
                      2,
                    )
                  }
                />

                <StatCard
                  label="INT / Game"
                  value={
                    fmt(
                      seasonRow.passing_ints_per_game,
                      2,
                    )
                  }
                />
              </>
            ) : null}

            <StatCard
              label="Rush Yards / Game"
              value={
                fmt(
                  seasonRow.rushing_yards_per_game,
                  1,
                )
              }
            />

            <StatCard
              label="Rush TD / Game"
              value={
                fmt(
                  seasonRow.rushing_tds_per_game,
                  2,
                )
              }
            />

            {!isQuarterback ? (
              <>
                <StatCard
                  label="Targets / Game"
                  value={
                    fmt(
                      seasonRow.receiving_targets_per_game,
                      2,
                    )
                  }
                />

                <StatCard
                  label="Receptions / Game"
                  value={
                    fmt(
                      seasonRow.receptions_per_game,
                      2,
                    )
                  }
                />

                <StatCard
                  label="Receiving Yards / Game"
                  value={
                    fmt(
                      seasonRow.receiving_yards_per_game,
                      1,
                    )
                  }
                />

                <StatCard
                  label="Receiving TD / Game"
                  value={
                    fmt(
                      seasonRow.receiving_tds_per_game,
                      2,
                    )
                  }
                />
              </>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  function renderGolfSeason() {
    if (!seasonRow) {
      return null;
    }

    const hasDetailed =
      Boolean(
        seasonRow.has_detailed_stats,
      );

    return (
      <div className="space-y-5">
        <section>
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
            PGA Results
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Scoring Average"
              value={
                fmt(
                  seasonRow.scoring_average,
                  2,
                )
              }
            />

            <StatCard
              label="Cuts Made"
              value={
                seasonRow.cuts_made_pct ===
                  null ||
                seasonRow.cuts_made_pct ===
                  undefined
                  ? `${seasonRow.cuts_made ?? 0}`
                  : `${seasonRow.cuts_made ?? 0}/${seasonRow.tournaments_played ?? 0}`
              }
              detail={
                seasonRow.cuts_made_pct ===
                  null ||
                seasonRow.cuts_made_pct ===
                  undefined
                  ? "Partial PGA record"
                  : pct(
                      seasonRow.cuts_made_pct,
                      1,
                    )
              }
            />

            <StatCard
              label="Wins"
              value={
                seasonRow.wins ??
                0
              }
            />

            <StatCard
              label="Top 5"
              value={
                seasonRow.top_5_finishes ??
                0
              }
            />

            <StatCard
              label="Top 10"
              value={
                seasonRow.top_10_finishes ??
                0
              }
            />

            <StatCard
              label="Events"
              value={
                seasonRow.tournaments_played ??
                0
              }
            />
          </div>
        </section>

        {hasDetailed ? (
          <>
            <section>
              <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                Scoring Profile
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="Birdies / Round"
                  value={
                    fmt(
                      seasonRow.birdies_per_round,
                      2,
                    )
                  }
                />

                <StatCard
                  label="Birdie %"
                  value={
                    pct(
                      seasonRow.birdie_rate,
                      1,
                    )
                  }
                />

                <StatCard
                  label="Bogey %"
                  value={
                    pct(
                      seasonRow.bogey_rate,
                      1,
                    )
                  }
                />

                <StatCard
                  label="Rounds"
                  value={
                    seasonRow.rounds_played ??
                    "—"
                  }
                />
              </div>
            </section>

            <section>
              <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                Ball Striking & Putting
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="GIR"
                  value={
                    pct(
                      seasonRow.greens_in_reg_pct,
                      1,
                    )
                  }
                />

                <StatCard
                  label="Driving Accuracy"
                  value={
                    pct(
                      seasonRow.driving_accuracy_pct,
                      1,
                    )
                  }
                />

                <StatCard
                  label="Driving Distance"
                  value={
                    seasonRow.driving_distance ===
                      null ||
                    seasonRow.driving_distance ===
                      undefined
                      ? "—"
                      : `${fmt(
                          seasonRow.driving_distance,
                          1,
                        )} yd`
                  }
                />

                <StatCard
                  label="Putts / GIR"
                  value={
                    fmt(
                      seasonRow.putts_per_gir,
                      2,
                    )
                  }
                />
              </div>
            </section>
          </>
        ) : (
          <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            ESPN has results for this golfer, but detailed PGA performance statistics are not available for this season.
          </div>
        )}
      </div>
    );
  }

  function renderSeasonProfile() {
    if (
      seasonLoading
    ) {
      return (
        <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-8 text-center text-sm text-slate-400">
          Loading professional season statistics…
        </div>
      );
    }

    if (
      seasonError ||
      !seasonRow
    ) {
      return (
        <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-8 text-center text-sm text-slate-400">
          {seasonError ||
            "No professional season statistics are available."}
        </div>
      );
    }

    if (
      sport ===
      "golf"
    ) {
      return renderGolfSeason();
    }

    if (
      sport ===
      "nfl"
    ) {
      return renderNflSeason();
    }

    return renderNbaSeason();
  }

  function renderLeagueProfile() {
    if (
      leagueLoading
    ) {
      return (
        <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-8 text-center text-sm text-slate-400">
          Loading 111 Sports history…
        </div>
      );
    }

    if (
      leagueError ||
      !leagueProfile
    ) {
      return (
        <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-8 text-center text-sm text-slate-400">
          {leagueError ||
            "No 111 Sports history is available."}
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <section>
          <div
            className={`mb-3 text-xs font-black uppercase tracking-[0.18em] ${
              sport ===
              "golf"
                ? "text-emerald-300"
                : "text-sky-300"
            }`}
          >
            League Impact
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Drafted"
              value={
                leagueSummary?.timesDrafted ??
                0
              }
            />

            <StatCard
              label="Wins"
              value={
                leagueSummary?.wins ??
                0
              }
            />

            <StatCard
              label={
                sport ===
                "golf"
                  ? "Podiums"
                  : "Runner-Ups"
              }
              value={
                sport ===
                "golf"
                  ? leagueSummary?.podiums ??
                    0
                  : leagueSummary?.runnerUps ??
                    0
              }
            />

            <StatCard
              label="Win Rate"
              value={
                leagueSummary?.winRate ===
                  null ||
                leagueSummary?.winRate ===
                  undefined
                  ? "—"
                  : pct(
                      leagueSummary.winRate,
                      0,
                    )
              }
            />

            <StatCard
              label={
                sport ===
                "golf"
                  ? "Avg Score"
                  : "Avg FP"
              }
              value={
                fmt(
                  leagueSummary?.averageFantasyPoints,
                  sport ===
                    "golf"
                    ? 1
                    : 1,
                )
              }
            />

            <StatCard
              label={
                sport ===
                "golf"
                  ? "Best Score"
                  : "Best FP"
              }
              value={
                fmt(
                  leagueSummary?.bestFantasyPoints,
                  1,
                )
              }
            />

            <StatCard
              label="Avg Finish"
              value={
                leagueSummary?.averageFinish ===
                  null ||
                leagueSummary?.averageFinish ===
                  undefined
                  ? "—"
                  : ordinal(
                      Math.round(
                        leagueSummary.averageFinish,
                      ),
                    )
              }
            />

            <StatCard
              label="Most Drafted By"
              value={
                leagueSummary?.draftedMostBy?.teamName ??
                "—"
              }
              detail={
                leagueSummary?.draftedMostBy
                  ? `${leagueSummary.draftedMostBy.count} drafts`
                  : undefined
              }
            />
          </div>
        </section>

        {(leagueProfile.recentHistory ??
          []).length >
        0 ? (
          <section>
            <div
              className={`mb-3 text-xs font-black uppercase tracking-[0.18em] ${
                sport ===
                "golf"
                  ? "text-emerald-300"
                  : "text-sky-300"
              }`}
            >
              Recent Drafts
            </div>

            <div className="space-y-2">
              {(
                leagueProfile.recentHistory ??
                []
              )
                .slice(
                  0,
                  8,
                )
                .map(
                  (
                    history,
                    index,
                  ) => (
                    <div
                      key={`${history.slateId ?? history.slateLabel ?? index}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-white">
                          {formatSlateLabel(
                            history.slateLabel,
                          )}
                        </div>

                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {history.teamName
                            ? `Drafted by ${history.teamName}`
                            : "111 Sports"}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="font-black text-white">
                          {fmt(
                            sport ===
                              "golf"
                              ? history.golferScore ??
                                  history.fantasyPoints
                              : history.fantasyPoints,
                            1,
                          )}
                        </div>

                        <div className="text-[10px] uppercase text-slate-400">
                          {history.finishPosition
                            ? ordinal(
                                history.finishPosition,
                              )
                            : sport ===
                                "golf"
                              ? "Score"
                              : "FP"}
                        </div>
                      </div>
                    </div>
                  ),
                )}
            </div>
          </section>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
            This player has not been drafted in this view yet.
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[12000] flex items-start justify-center bg-slate-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-6"
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
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${player.name} profile`}
        className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-slate-950 text-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-4xl sm:rounded-[30px] sm:border sm:border-slate-700"
      >
        <header
          className={`shrink-0 border-b bg-slate-950/95 px-5 py-4 backdrop-blur ${
            sport ===
            "golf"
              ? "border-emerald-900"
              : "border-sky-900"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div
                className={`text-xs font-black uppercase tracking-[0.22em] ${
                  sport ===
                  "golf"
                    ? "text-emerald-300"
                    : "text-sky-300"
                }`}
              >
                Player Profile
              </div>

              <div className="mt-1 text-xs text-slate-500">
                {mode ===
                "season"
                  ? seasonSubtitle
                  : "111 Sports League History"}
              </div>
            </div>

            <button
              type="button"
              onClick={
                onClose
              }
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-xl font-bold text-slate-300 transition hover:bg-slate-700"
              aria-label="Close player profile"
            >
              ×
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 p-4 pb-28 sm:p-6 sm:pb-8">
            <section
              className={`overflow-hidden rounded-3xl border bg-gradient-to-br p-5 ${
                sport ===
                "golf"
                  ? "border-emerald-700 from-emerald-950 via-emerald-900 to-slate-950"
                  : "border-sky-800 from-sky-950 via-slate-900 to-slate-950"
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-white/10 bg-white/10">
                  {sport ===
                  "golf" ? (
                    player.headshotUrl ||
                    player.espnGolfPlayerId ? (
                      <img
                        src={
                          player.headshotUrl ??
                          `https://a.espncdn.com/i/headshots/golf/players/full/${player.espnGolfPlayerId}.png`
                        }
                        alt={
                          player.name
                        }
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-3xl">
                        ⛳
                      </div>
                    )
                  ) : (
                    <PlayerHeadshot
                      nbaPlayerId={
                        player.nbaPlayerId ??
                        null
                      }
                      nflPlayerId={
                        player.nflPlayerId ??
                        null
                      }
                      playerName={
                        player.name
                      }
                      size="xl"
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={`text-xs font-black uppercase tracking-[0.18em] ${
                      sport ===
                      "golf"
                        ? "text-emerald-300"
                        : "text-sky-300"
                    }`}
                  >
                    {mode ===
                    "season"
                      ? seasonSubtitle
                      : "111 Sports"}
                  </div>

                  <h2 className="mt-1 text-2xl font-black leading-tight text-white sm:text-3xl">
                    {
                      player.name
                    }
                  </h2>

                  <div className="mt-2 text-sm text-slate-300">
                    {sport ===
                    "golf"
                      ? [
                          player.owgrRank
                            ? `OWGR #${player.owgrRank}`
                            : null,
                          player.country,
                        ]
                          .filter(
                            Boolean,
                          )
                          .join(
                            " · ",
                          ) ||
                        "PGA"
                      : identitySecondary ||
                        sport.toUpperCase()}
                  </div>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-700 bg-slate-900 p-1">
              <button
                type="button"
                onClick={() =>
                  setMode(
                    "season",
                  )
                }
                className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${
                  mode ===
                  "season"
                    ? sport ===
                        "golf"
                      ? "bg-emerald-700 text-white shadow"
                      : "bg-sky-700 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Season Stats
              </button>

              <button
                type="button"
                onClick={() =>
                  setMode(
                    "league",
                  )
                }
                className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${
                  mode ===
                  "league"
                    ? sport ===
                        "golf"
                      ? "bg-emerald-700 text-white shadow"
                      : "bg-sky-700 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                League History
              </button>
            </div>

            {mode ===
            "season"
              ? renderSeasonProfile()
              : renderLeagueProfile()}
          </div>
        </div>
      </section>
    </div>
  );
}
