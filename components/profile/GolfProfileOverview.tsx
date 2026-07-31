"use client";

type SeasonValue = number | "all";

type GolfProfile = {
  team: {
    id: number;
    name: string;
  };
  seasonSummary: {
    slatesPlayed: number;
    wins: number;
    runnerUps: number;
    podiumFinishes: number;
    winRate: number | null;
    avgFinish: number | null;
    avgScore: number | null;
  };
  careerSummary: {
    wins: number;
    avgFinish: number | null;
    avgScore: number | null;
    bestScore: number | null;
    worstScore: number | null;
    bestPickEver: {
      playerName: string;
      fantasyPoints: number;
      slateLabel: string;
    } | null;
  };
  golfSummary?: {
    tournamentsPlayed: number;
    favoriteGolfer: {
      playerName: string;
      count: number;
    } | null;
    bestAverageGolfer: {
      playerName: string;
      avgScore: number;
      count: number;
    } | null;
    cutsMade: number;
    cutOpportunities: number;
    cutsMadePct: number | null;
    birdies: number;
    eagles: number;
    pars: number;
    bogeys: number;
    doubleBogeys: number;
    roundsUnderPar: number;
    completedRounds: number;
  };
  recentSlates: Array<{
    slateId: number;
    slateLabel: string;
    score: number;
    finishPosition: number | null;
    topPlayer: {
      playerName: string;
      fantasyPoints: number | null;
    } | null;
  }>;
};

function golfScore(
  value: number | null | undefined,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  if (Number(value) === 0) {
    return "E";
  }

  return Number(value) > 0
    ? `+${Number(value)}`
    : String(Number(value));
}

function finishLabel(
  value: number | null,
) {
  if (!value) return "—";

  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";

  return `${value}th`;
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-emerald-900/60 bg-slate-900 p-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300/75">
        {label}
      </div>

      <div className="mt-2 text-2xl font-black text-white">
        {value}
      </div>

      {detail ? (
        <div className="mt-1 text-xs leading-5 text-slate-400">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export default function GolfProfileOverview({
  profile,
  season,
  availableSeasons,
  onSeasonChange,
}: {
  profile: GolfProfile;
  teamId: number;
  season: SeasonValue;
  availableSeasons: number[];
  onSeasonChange: (
    season: SeasonValue,
  ) => void;
}) {
  const golf =
    profile.golfSummary;

  return (
    <div className="space-y-5 text-slate-100">
      <section className="rounded-3xl border border-emerald-800/60 bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-950 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">
              Golf Profile
            </div>

            <h3 className="mt-1 text-xl font-bold text-white">
              Tournament Record
            </h3>
          </div>

          <select
            value={season}
            onChange={(event) => {
              const value =
                event.target.value;

              onSeasonChange(
                value === "all"
                  ? "all"
                  : Number(value),
              );
            }}
            className="rounded-xl border border-emerald-700/70 bg-slate-950 px-3 py-2 text-sm font-semibold text-emerald-100"
          >
            <option value="all">
              All Time
            </option>

            {availableSeasons.map(
              (year) => (
                <option
                  key={year}
                  value={year}
                >
                  {year}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Wins"
            value={
              profile.seasonSummary.wins
            }
            detail={`${profile.seasonSummary.slatesPlayed} tournaments`}
          />

          <StatCard
            label="Podiums"
            value={
              profile.seasonSummary
                .podiumFinishes
            }
            detail={
              profile.seasonSummary
                .winRate !== null
                ? `${profile.seasonSummary.winRate}% win rate`
                : "No completed tournaments"
            }
          />

          <StatCard
            label="Avg Finish"
            value={
              profile.seasonSummary
                .avgFinish ?? "—"
            }
          />

          <StatCard
            label="Avg Score"
            value={golfScore(
              profile.seasonSummary
                .avgScore,
            )}
            detail="Lower is better"
          />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Cuts Made"
          value={
            golf?.cutsMadePct !== null &&
            golf?.cutsMadePct !== undefined
              ? `${golf.cutsMadePct}%`
              : "—"
          }
          detail={
            golf
              ? `${golf.cutsMade}/${golf.cutOpportunities} settled golfers`
              : undefined
          }
        />

        <StatCard
          label="Rounds Under Par"
          value={
            golf?.roundsUnderPar ?? 0
          }
          detail={
            golf
              ? `${golf.completedRounds} completed rounds`
              : undefined
          }
        />

        <StatCard
          label="Birdies"
          value={golf?.birdies ?? 0}
        />

        <StatCard
          label="Eagles"
          value={golf?.eagles ?? 0}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Favorite Golfer
          </div>

          <div className="mt-2 text-xl font-bold text-white">
            {golf?.favoriteGolfer
              ?.playerName ?? "—"}
          </div>

          <div className="mt-1 text-sm text-slate-400">
            {golf?.favoriteGolfer
              ? `Drafted ${golf.favoriteGolfer.count} times`
              : "No Golf draft history yet"}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Best Average Golfer
          </div>

          <div className="mt-2 text-xl font-bold text-white">
            {golf?.bestAverageGolfer
              ?.playerName ?? "—"}
          </div>

          <div className="mt-1 text-sm text-slate-400">
            {golf?.bestAverageGolfer
              ? `${golfScore(
                  golf.bestAverageGolfer
                    .avgScore,
                )} average across ${
                  golf.bestAverageGolfer
                    .count
                } drafts`
              : "No completed golfer results"}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Best Pick
          </div>

          <div className="mt-2 text-xl font-bold text-white">
            {profile.careerSummary
              .bestPickEver
              ?.playerName ?? "—"}
          </div>

          <div className="mt-1 text-sm text-slate-400">
            {profile.careerSummary
              .bestPickEver
              ? `${golfScore(
                  profile.careerSummary
                    .bestPickEver
                    .fantasyPoints,
                )} at ${
                  profile.careerSummary
                    .bestPickEver
                    .slateLabel
                }`
              : "No completed golfer results"}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <div>
          <h3 className="text-xl font-bold text-white">
            Scoring Breakdown
          </h3>

          <p className="mt-1 text-sm text-slate-400">
            Hole results from every golfer drafted by this team.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {[
            {
              label: "Eagles",
              value: golf?.eagles ?? 0,
            },
            {
              label: "Birdies",
              value: golf?.birdies ?? 0,
            },
            {
              label: "Pars",
              value: golf?.pars ?? 0,
            },
            {
              label: "Bogeys",
              value: golf?.bogeys ?? 0,
            },
            {
              label: "Double+",
              value:
                golf?.doubleBogeys ?? 0,
            },
          ].map((row) => (
            <div
              key={row.label}
              className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-center"
            >
              <div className="text-xl font-black text-white">
                {row.value}
              </div>

              <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {row.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <div>
          <h3 className="text-xl font-bold text-white">
            Recent Tournaments
          </h3>

          <p className="mt-1 text-sm text-slate-400">
            The latest completed fantasy Golf results.
          </p>
        </div>

        {profile.recentSlates.length ===
        0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
            No completed Golf tournaments yet.
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800">
            {profile.recentSlates.map(
              (row) => (
                <div
                  key={row.slateId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-slate-800 bg-slate-950 px-4 py-3 first:border-t-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-white">
                      {row.slateLabel}
                    </div>

                    <div className="mt-0.5 truncate text-xs text-slate-400">
                      {row.topPlayer
                        ? `Best golfer: ${row.topPlayer.playerName} ${golfScore(
                            row.topPlayer
                              .fantasyPoints,
                          )}`
                        : "No golfer result"}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-black text-emerald-300">
                      {golfScore(
                        row.score,
                      )}
                    </div>

                    <div className="text-xs font-semibold text-slate-400">
                      {finishLabel(
                        row.finishPosition,
                      )}
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
