"use client";

type Milestones = {
  fiveStraight: boolean;
  tenStraight: boolean;
  firstPerfectWeek: boolean;
  twoPerfectWeeks: boolean;
  fivePerfectWeeks: boolean;
  accuracy75: boolean;

  accuracy75Progress: {
    correct: number;
    total: number;
    pickPct: number | null;
    minimumPicks: number;
  };
};

type Championship = {
  season: number;
  correct: number;
  total: number;
  pickPct: number | null;
};

type Props = {
  teamName: string;

  profile: {
    ncaaPickEm?: {
      careerSummary: {
        correct: number;
        total: number;
        pickPct: number | null;
        perfectWeeks: number;
        longestCorrectStreak: number;
      };

      milestones:
        Milestones;

      seasonChampionships:
        Championship[];
    };
  };
};

type Badge = {
  id: string;
  emoji: string;
  name: string;
  description: string;
  unlocked: boolean;
  rarity:
    | "Common"
    | "Rare"
    | "Epic"
    | "Legendary";
  progress: string;
};

function pct(
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

function MilestoneCard({
  badge,
}: {
  badge: Badge;
}) {
  const rarityClass =
    badge.rarity ===
    "Legendary"
      ? "border-amber-300 bg-gradient-to-br from-amber-50 to-yellow-100"
      : badge.rarity ===
          "Epic"
        ? "border-violet-300 bg-gradient-to-br from-violet-50 to-purple-100"
        : badge.rarity ===
            "Rare"
          ? "border-blue-300 bg-gradient-to-br from-blue-50 to-sky-100"
          : "border-slate-200 bg-white";

  return (
    <article
      className={`relative min-h-[235px] overflow-hidden rounded-3xl border p-5 shadow-sm ${rarityClass} ${
        badge.unlocked
          ? ""
          : "opacity-65 grayscale-[25%]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-full border border-black/10 bg-white/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-700">
          {badge.unlocked
            ? badge.rarity
            : "Locked"}
        </span>

        <span className="text-3xl">
          {badge.unlocked
            ? badge.emoji
            : "🔒"}
        </span>
      </div>

      <h3 className="mt-5 text-lg font-black uppercase tracking-[0.08em] text-slate-950">
        {badge.name}
      </h3>

      <p className="mt-2 text-xs leading-5 text-slate-600">
        {badge.description}
      </p>

      <div className="mt-5 border-t border-black/10 pt-4 text-xs font-semibold text-slate-600">
        {badge.unlocked
          ? "Achievement unlocked"
          : badge.progress}
      </div>
    </article>
  );
}

export default function NcaaPickEmTrophyCase({
  teamName,
  profile,
}: Props) {
  const data =
    profile.ncaaPickEm;

  if (!data) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        NCAA Trophy Case unavailable.
      </section>
    );
  }

  const {
    milestones,
    careerSummary,
    seasonChampionships,
  } = data;

  const badges:
    Badge[] = [
      {
        id:
          "five-straight",
        emoji:
          "🔥",
        name:
          "Heating Up",
        description:
          "Pick five consecutive games correctly.",
        unlocked:
          milestones.fiveStraight,
        rarity:
          "Common",
        progress:
          `Best streak: ${careerSummary.longestCorrectStreak} of 5`,
      },

      {
        id:
          "ten-straight",
        emoji:
          "🎯",
        name:
          "Dialed In",
        description:
          "Pick ten consecutive games correctly.",
        unlocked:
          milestones.tenStraight,
        rarity:
          "Rare",
        progress:
          `Best streak: ${careerSummary.longestCorrectStreak} of 10`,
      },

      {
        id:
          "perfect-week",
        emoji:
          "💯",
        name:
          "Perfect Week",
        description:
          "Go undefeated across an entire completed Pick 'Em week.",
        unlocked:
          milestones.firstPerfectWeek,
        rarity:
          "Rare",
        progress:
          `${careerSummary.perfectWeeks} perfect weeks`,
      },

      {
        id:
          "two-perfect",
        emoji:
          "🧹",
        name:
          "Double Sweep",
        description:
          "Record two perfect Pick 'Em weeks.",
        unlocked:
          milestones.twoPerfectWeeks,
        rarity:
          "Epic",
        progress:
          `${careerSummary.perfectWeeks} of 2 perfect weeks`,
      },

      {
        id:
          "five-perfect",
        emoji:
          "👑",
        name:
          "Perfectionist",
        description:
          "Record five perfect Pick 'Em weeks.",
        unlocked:
          milestones.fivePerfectWeeks,
        rarity:
          "Legendary",
        progress:
          `${careerSummary.perfectWeeks} of 5 perfect weeks`,
      },

      {
        id:
          "accuracy-75",
        emoji:
          "🎯",
        name:
          "Sharpshooter",
        description:
          "Maintain at least 75% accuracy across 20 or more graded picks.",
        unlocked:
          milestones.accuracy75,
        rarity:
          "Epic",
        progress:
          `${pct(
            milestones
              .accuracy75Progress
              .pickPct,
          )} across ${
            milestones
              .accuracy75Progress
              .total
          } of 20 required picks`,
      },
    ];

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 p-6 text-white shadow-lg">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
          NCAA Pick &apos;Em Hardware
        </div>

        <h2 className="mt-2 text-3xl font-black tracking-tight">
          {teamName}&apos;s Trophy Case
        </h2>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
          Season championships are the hardware. Milestones track the memorable runs along the way.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Championships
            </div>

            <div className="mt-2 text-3xl font-black">
              {
                seasonChampionships.length
              }
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Perfect Weeks
            </div>

            <div className="mt-2 text-3xl font-black">
              {
                careerSummary.perfectWeeks
              }
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Pick %
            </div>

            <div className="mt-2 text-3xl font-black">
              {pct(
                careerSummary.pickPct,
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">
          Season Championships
        </div>

        <h2 className="mt-1 text-2xl font-black text-slate-950">
          The hardware
        </h2>

        {seasonChampionships.length ===
        0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center">
            <div className="text-4xl">
              🏆
            </div>

            <div className="mt-3 font-black text-slate-900">
              No NCAA championships yet
            </div>

            <div className="mt-1 text-sm text-slate-500">
              The season champion trophy appears only after the full Pick &apos;Em season is final.
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {seasonChampionships.map(
              (
                championship,
              ) => (
                <article
                  key={
                    championship.season
                  }
                  className="relative overflow-hidden rounded-3xl border border-amber-300 bg-gradient-to-br from-amber-50 via-yellow-50 to-white p-5 text-center shadow-md"
                >
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">
                    NCAA Pick &apos;Em
                  </div>

                  <div className="mt-4 text-6xl drop-shadow-sm">
                    🏆
                  </div>

                  <div className="mt-3 text-2xl font-black text-slate-950">
                    {
                      championship.season
                    } Champion
                  </div>

                  <div className="mt-3 rounded-full border border-amber-200 bg-white/70 px-3 py-1.5 text-sm font-black text-amber-900">
                    {
                      championship.correct
                    }
                    /{
                      championship.total
                    } ·{" "}
                    {pct(
                      championship.pickPct,
                    )}
                  </div>
                </article>
              ),
            )}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">
          Milestones
        </div>

        <h2 className="mt-1 text-2xl font-black text-slate-950">
          Pick &apos;Em achievements
        </h2>

        <p className="mt-1 text-sm text-slate-500">
          These unlock automatically as graded results accumulate.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map(
            (badge) => (
              <MilestoneCard
                key={
                  badge.id
                }
                badge={
                  badge
                }
              />
            ),
          )}
        </div>
      </section>
    </div>
  );
}
