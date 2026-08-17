"use client";

type SeasonValue =
  number | "all";

type PickSummary = {
  weeksPlayed: number;
  correct: number;
  incorrect: number;
  total: number;
  pickPct: number | null;
  perfectWeeks: number;
  currentCorrectStreak: number;
  longestCorrectStreak: number;

  bestWeek: {
    weekId: number;
    season: number;
    weekNumber: number;
    label: string;
    correct: number;
    total: number;
    pickPct: number | null;
  } | null;
};

type WeekRow = {
  weekId: number;
  season: number;
  weekNumber: number;
  label: string;
  correct: number;
  incorrect: number;
  total: number;
  pickPct: number | null;
  perfect: boolean;
  complete: boolean;
};

type Props = {
  profile: {
    ncaaPickEm?: {
      selectedSummary: PickSummary;
      careerSummary: PickSummary;
      recentWeeks: WeekRow[];
      availableSeasons: number[];
    };
  };

  season:
    SeasonValue;

  availableSeasons:
    number[];

  onSeasonChange:
    (
      season:
        SeasonValue,
    ) => void;
};

function percent(
  value:
    number | null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return `${Number(
    value,
  ).toFixed(1)}%`;
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  featured = false,
}: {
  icon: string;
  label: string;
  value:
    string | number;
  detail?: string;
  featured?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border p-4 shadow-sm ${
        featured
          ? "border-blue-300 bg-blue-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          {label}
        </div>

        <div className="text-2xl">
          {icon}
        </div>
      </div>

      <div className="mt-3 text-3xl font-black tracking-tight text-slate-950">
        {value}
      </div>

      {detail ? (
        <div className="mt-1 text-xs leading-5 text-slate-500">
          {detail}
        </div>
      ) : null}
    </article>
  );
}

export default function NcaaPickEmProfileOverview({
  profile,
  season,
  availableSeasons,
  onSeasonChange,
}: Props) {
  const ncaa =
    profile.ncaaPickEm;

  if (!ncaa) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
          NCAA Pick &apos;Em profile data is unavailable.
        </div>
      </section>
    );
  }

  const summary =
    ncaa.selectedSummary;

  const career =
    ncaa.careerSummary;

  const label =
    season === "all"
      ? "All-Time"
      : `${season} Season`;

  const seasons =
    ncaa.availableSeasons
      .length > 0
      ? ncaa.availableSeasons
      : availableSeasons;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-white via-blue-50 to-slate-100 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
              NCAA Pick &apos;Em Résumé
            </div>

            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              {summary.correct} correct across{" "}
              {summary.total} graded picks
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Accuracy, perfect weeks, streaks, and recent Pick &apos;Em form.
            </p>
          </div>

          <label className="block w-full lg:w-auto">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Stat view
            </span>

            <select
              value={
                season
              }
              onChange={(
                event,
              ) =>
                onSeasonChange(
                  event.target
                    .value ===
                    "all"
                    ? "all"
                    : Number(
                        event
                          .target
                          .value,
                      ),
                )
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 lg:min-w-[180px]"
            >
              <option value="all">
                All-Time
              </option>

              {seasons.map(
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
          </label>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            icon="✅"
            label="Correct"
            value={
              summary.correct
            }
            detail={label}
            featured
          />

          <MetricCard
            icon="❌"
            label="Incorrect"
            value={
              summary.incorrect
            }
            detail={`${summary.total} graded picks`}
          />

          <MetricCard
            icon="🎯"
            label="Pick %"
            value={percent(
              summary.pickPct,
            )}
            detail={label}
          />

          <MetricCard
            icon="💯"
            label="Perfect Weeks"
            value={
              summary.perfectWeeks
            }
            detail={`${summary.weeksPlayed} completed weeks`}
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">
            Streaks
          </div>

          <h2 className="mt-1 text-2xl font-black text-slate-950">
            How hot is the picker?
          </h2>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            icon="🔥"
            label="Current Streak"
            value={
              summary.currentCorrectStreak
            }
            detail="Correct picks in a row"
            featured
          />

          <MetricCard
            icon="👑"
            label="Best Streak"
            value={
              summary.longestCorrectStreak
            }
            detail="Longest correct-pick streak"
          />

          <MetricCard
            icon="📈"
            label="Career Pick %"
            value={percent(
              career.pickPct,
            )}
            detail={`${career.total} career graded picks`}
          />

          <MetricCard
            icon="🧹"
            label="Career Perfect Weeks"
            value={
              career.perfectWeeks
            }
            detail={`${career.weeksPlayed} completed weeks`}
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">
            Best Week
          </div>

          <h2 className="mt-1 text-2xl font-black text-slate-950">
            Peak Pick &apos;Em performance
          </h2>
        </div>

        {summary.bestWeek ? (
          <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-blue-700">
              {summary.bestWeek.season} ·{" "}
              {summary.bestWeek.label}
            </div>

            <div className="mt-2 text-4xl font-black text-slate-950">
              {summary.bestWeek.correct}
              <span className="text-xl text-slate-400">
                /{summary.bestWeek.total}
              </span>
            </div>

            <div className="mt-1 text-sm font-semibold text-slate-600">
              {percent(
                summary.bestWeek
                  .pickPct,
              )}{" "}
              correct
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            Best week will appear after completed Pick &apos;Em results are graded.
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">
            Recent Form
          </div>

          <h2 className="mt-1 text-2xl font-black text-slate-950">
            Last eight completed weeks
          </h2>
        </div>

        {ncaa.recentWeeks.length ===
        0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            No completed Pick &apos;Em weeks yet.
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ncaa.recentWeeks.map(
              (week) => (
                <article
                  key={
                    week.weekId
                  }
                  className={`rounded-2xl border p-4 ${
                    week.perfect
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {week.season}
                      </div>

                      <div className="mt-1 font-black text-slate-900">
                        {week.label}
                      </div>
                    </div>

                    <div className="text-2xl">
                      {week.perfect
                        ? "💯"
                        : "🏈"}
                    </div>
                  </div>

                  <div className="mt-4 text-3xl font-black text-slate-950">
                    {week.correct}
                    <span className="text-lg text-slate-400">
                      /{week.total}
                    </span>
                  </div>

                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {percent(
                      week.pickPct,
                    )}{" "}
                    correct
                  </div>
                </article>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
