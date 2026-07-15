"use client";

import { useState } from "react";
import CollectibleCard from "@/components/collectibles/CollectibleCard";

type TrophyTab = "career" | "milestones" | "seasons";
type Rarity = "common" | "rare" | "epic" | "legendary";

export type LeagueAward = {
  id: number;
  season: number;
  team_id: number;
  title: string;
  emoji: string;
  description: string | null;
  rarity: Rarity;
  display_order: number;
  featured: boolean;
};

export type TrophyMilestones = {
  score175: number;
  score200: number;
  score225: number;
  score250: number;

  backToBackWins: number;
  threePeats: number;
  longestPodiumStreak: number;

  photoFinishWins: number;
  statementWins: number;

  closestWinningMargin: number | null;
  largestWinningMargin: number | null;
};

type Props = {
  teamName: string;
  career: {
    wins: number;
    runnerUps: number;
    podiumFinishes: number;
    bestScore: number | null;
    avgFinish: number | null;
    longestWinStreak: number;
    slatesPlayed: number;
  };
  milestones: TrophyMilestones;
  leagueAwards: LeagueAward[];
};

type BadgeDefinition = {
  id: string;
  emoji: string;
  name: string;
  description: string;
  rarity: Rarity;
  unlocked: boolean;
  count?: number;
  progress?: string;
  detail?: string;
};

const rarityLabels: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

function formatNumber(value: number | null, digits = 1) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(digits);
}

function HardwareItem({
  emoji,
  value,
  label,
  detail,
  featured = false,
}: {
  emoji: string;
  value: string | number;
  label: string;
  detail?: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`hardware-card relative flex min-h-[185px] flex-col items-center justify-center overflow-hidden rounded-3xl border px-4 py-5 text-center ${
        featured
          ? "hardware-card--featured"
          : "hardware-card--standard"
      }`}
    >
      <div
        aria-hidden="true"
        className={`absolute inset-x-5 bottom-3 h-3 rounded-full blur-md ${
          featured
            ? "hardware-card-glow--featured"
            : "hardware-card-glow--standard"
        }`}
      />

      <div className="relative text-5xl drop-shadow-sm">{emoji}</div>

      <div className="hardware-card-value relative mt-3 text-3xl font-black tracking-tight">
        {value}
      </div>

      <div className="hardware-card-label relative mt-1 text-xs font-bold uppercase tracking-[0.16em]">
        {label}
      </div>

      {detail ? (
        <div className="hardware-card-detail relative mt-2 text-xs leading-5">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function MilestoneBadge({ badge }: { badge: BadgeDefinition }) {
  return (
    <CollectibleCard
      rarity={badge.rarity}
      locked={!badge.unlocked}
      className="relative min-h-[235px] overflow-hidden p-5 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
            badge.unlocked
              ? "collectible-pill"
              : "collectible-pill collectible-pill--locked"
          }`}
        >
          {badge.unlocked ? rarityLabels[badge.rarity] : "Locked"}
        </span>

        {badge.unlocked && badge.count && badge.count > 1 ? (
          <span className="collectible-count">
            ×{badge.count}
          </span>
        ) : null}
      </div>

      <div className="mt-5 text-center">
        <div className="text-5xl drop-shadow-sm">
          {badge.unlocked ? badge.emoji : "🔒"}
        </div>

        <h3 className="collectible-title mt-4 text-lg font-black uppercase tracking-[0.12em]">
          {badge.name}
        </h3>

        <p className="collectible-copy mx-auto mt-2 max-w-[240px] text-xs leading-5">
          {badge.description}
        </p>
      </div>

      <div className="collectible-divider mt-5 border-t pt-4 text-center">
        {badge.unlocked ? (
          <>
            <div className="collectible-title text-sm font-bold">
              Achievement Unlocked
            </div>

            {badge.detail ? (
              <div className="collectible-meta mt-1 text-xs">
                {badge.detail}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="collectible-meta text-sm font-bold">
              Still within reach
            </div>

            {badge.progress ? (
              <div className="collectible-muted mt-1 text-xs">
                {badge.progress}
              </div>
            ) : null}
          </>
        )}
      </div>
    </CollectibleCard>
  );
}

export default function TrophyCase({
  teamName,
  career,
  milestones,
  leagueAwards,
}: Props) {
  const [activeTab, setActiveTab] =
    useState<TrophyTab>("milestones");

  const availableAwardSeasons = [
    ...new Set(leagueAwards.map((award) => award.season)),
  ].sort((a, b) => b - a);

  const [awardSeason, setAwardSeason] = useState<number | null>(
    availableAwardSeasons[0] ?? null
  );

  const selectedAwards = awardSeason
    ? leagueAwards.filter(
        (award) => award.season === awardSeason
      )
    : [];

  const careerBest = Number(career.bestScore ?? 0);

  const scoreBadges: BadgeDefinition[] = [
    {
      id: "score-175",
      emoji: "💯",
      name: "175 Club",
      description: "Score at least 175 fantasy points in a completed slate.",
      rarity: "common",
      unlocked: milestones.score175 > 0,
      count: milestones.score175,
      detail: `${milestones.score175} qualifying slate${
        milestones.score175 === 1 ? "" : "s"
      }`,
      progress: `Career best: ${formatNumber(career.bestScore)}`,
    },
    {
      id: "score-200",
      emoji: "🔥",
      name: "200 Club",
      description: "Break the 200-point barrier in a completed slate.",
      rarity: "rare",
      unlocked: milestones.score200 > 0,
      count: milestones.score200,
      detail: `${milestones.score200} qualifying slate${
        milestones.score200 === 1 ? "" : "s"
      }`,
      progress:
        careerBest > 0
          ? `${formatNumber(Math.max(200 - careerBest, 0))} points away`
          : "No completed slate yet",
    },
    {
      id: "score-225",
      emoji: "🚀",
      name: "225 Club",
      description: "Reach the elite 225-point scoring tier.",
      rarity: "epic",
      unlocked: milestones.score225 > 0,
      count: milestones.score225,
      detail: `${milestones.score225} qualifying slate${
        milestones.score225 === 1 ? "" : "s"
      }`,
      progress:
        careerBest > 0
          ? `${formatNumber(Math.max(225 - careerBest, 0))} points away`
          : "No completed slate yet",
    },
    {
      id: "score-250",
      emoji: "🌋",
      name: "250 Club",
      description: "Deliver a legendary 250-point slate.",
      rarity: "legendary",
      unlocked: milestones.score250 > 0,
      count: milestones.score250,
      detail: `${milestones.score250} qualifying slate${
        milestones.score250 === 1 ? "" : "s"
      }`,
      progress:
        careerBest > 0
          ? `${formatNumber(Math.max(250 - careerBest, 0))} points away`
          : "No completed slate yet",
    },
  ];

  const achievementBadges: BadgeDefinition[] = [
    {
      id: "back-to-back",
      emoji: "👑",
      name: "Back-to-Back",
      description: "Win two consecutive completed slates.",
      rarity: "rare",
      unlocked: milestones.backToBackWins > 0,
      count: milestones.backToBackWins,
      detail: `${milestones.backToBackWins} winning sequence${
        milestones.backToBackWins === 1 ? "" : "s"
      }`,
      progress: `Longest win streak: ${career.longestWinStreak}`,
    },
    {
      id: "three-peat",
      emoji: "💎",
      name: "Three-Peat",
      description: "Win three consecutive completed slates.",
      rarity: "legendary",
      unlocked: milestones.threePeats > 0,
      count: milestones.threePeats,
      detail: `${milestones.threePeats} three-peat${
        milestones.threePeats === 1 ? "" : "s"
      }`,
      progress: `Longest win streak: ${career.longestWinStreak}`,
    },
    {
      id: "podium-streak",
      emoji: "📈",
      name: "Podium Streak",
      description: "Finish first or second in three consecutive slates.",
      rarity: "epic",
      unlocked: milestones.longestPodiumStreak >= 3,
      detail: `Best streak: ${milestones.longestPodiumStreak}`,
      progress: `Best streak: ${milestones.longestPodiumStreak} of 3`,
    },
    {
      id: "photo-finish",
      emoji: "📸",
      name: "Photo Finish",
      description: "Win a completed slate by fewer than two points.",
      rarity: "epic",
      unlocked: milestones.photoFinishWins > 0,
      count: milestones.photoFinishWins,
      detail:
        milestones.closestWinningMargin !== null
          ? `Closest win: ${formatNumber(
              milestones.closestWinningMargin
            )} points`
          : undefined,
      progress: "Win by fewer than 2.0 points",
    },
    {
      id: "statement-win",
      emoji: "💪",
      name: "Statement Win",
      description: "Win a completed slate by at least 30 points.",
      rarity: "rare",
      unlocked: milestones.statementWins > 0,
      count: milestones.statementWins,
      detail:
        milestones.largestWinningMargin !== null
          ? `Largest win: ${formatNumber(
              milestones.largestWinningMargin
            )} points`
          : undefined,
      progress: "Win by at least 30.0 points",
    },
  ];

  const allBadges = [...scoreBadges, ...achievementBadges];
  const unlockedCount = allBadges.filter((badge) => badge.unlocked).length;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950 p-5 text-white shadow-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">
              111 Hall of Fame
            </div>

            <h2 className="mt-2 text-3xl font-black tracking-tight">
              {teamName}&apos;s Trophy Case
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-300">
              Career hardware, rare achievements, and seasonal honors.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-center backdrop-blur">
            <div className="text-2xl font-black">
              {unlockedCount}/{allBadges.length}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
              Milestones Unlocked
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-3 gap-2">
          {[
            {
              id: "milestones",
              label: "Milestones",
              icon: "🏅",
            },
            {
              id: "seasons",
              label: "League Awards",
              icon: "🏆",
            },
            {
              id: "career",
              label: "Career",
              icon: "📈",
            },
          ].map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TrophyTab)}
                className={`rounded-2xl px-2 py-2.5 text-sm font-semibold transition ${
                  isActive
                    ? "bg-amber-100 text-amber-950 shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className="mr-1 hidden sm:inline">{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === "career" ? (
        <section className="trophy-content-section rounded-3xl border p-5 shadow-sm">
          <div className="mb-5">
            <div className="trophy-section-kicker trophy-section-kicker--gold text-xs font-bold uppercase tracking-[0.2em]">
              Career Hardware
            </div>

            <h3 className="trophy-section-title mt-1 text-2xl font-black">
              The top shelf
            </h3>

            <p className="trophy-section-copy mt-1 text-sm">
              Permanent accomplishments from all completed league slates.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <HardwareItem
              emoji="🏆"
              value={career.wins}
              label="Championships"
              detail={`${career.slatesPlayed} career slates`}
              featured
            />

            <HardwareItem
              emoji="🥈"
              value={career.runnerUps}
              label="Runner-Ups"
              detail="Second-place finishes"
            />

            <HardwareItem
              emoji="🥉"
              value={career.podiumFinishes}
              label="Podiums"
              detail="Top-three finishes"
            />

            <HardwareItem
              emoji="🔥"
              value={formatNumber(career.bestScore)}
              label="Career High"
              detail="Best single-slate score"
              featured
            />

            <HardwareItem
              emoji="👑"
              value={career.longestWinStreak}
              label="Win Streak"
              detail="Longest consecutive run"
            />

            <HardwareItem
              emoji="🎯"
              value={formatNumber(career.avgFinish)}
              label="Avg Finish"
              detail="Career finishing position"
            />
          </div>
        </section>
      ) : null}

      {activeTab === "milestones" ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-violet-700">
                Achievement Collection
              </div>

              <h3 className="mt-1 text-2xl font-black text-slate-900">
                Milestone badges
              </h3>

              <p className="mt-1 text-sm text-slate-600">
                Locked badges become full-color collectibles once earned.
              </p>
            </div>

            <div className="text-sm font-bold text-slate-700">
              {unlockedCount} unlocked
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {allBadges.map((badge) => (
              <MilestoneBadge key={badge.id} badge={badge} />
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "seasons" ? (
        <section className="trophy-content-section rounded-3xl border p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="trophy-section-kicker trophy-section-kicker--gold text-xs font-bold uppercase tracking-[0.2em]">
                Commissioner Honors
              </div>

              <h3 className="trophy-section-title mt-1 text-2xl font-black">
                League Awards
              </h3>

              <p className="trophy-section-copy mt-1 text-sm">
                Custom awards earned throughout league history.
              </p>
            </div>

            {availableAwardSeasons.length > 0 ? (
              <label className="block">
                <span className="trophy-section-label mb-1 block text-xs font-semibold">
                  Season
                </span>

                <select
                  value={awardSeason ?? ""}
                  onChange={(event) =>
                    setAwardSeason(Number(event.target.value))
                  }
                  className="trophy-season-select min-w-[140px] rounded-xl border px-3 py-2.5 text-sm outline-none"
                >
                  {availableAwardSeasons.map((season) => (
                    <option key={season} value={season}>
                      {season}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {selectedAwards.length === 0 ? (
            <div className="trophy-empty-state mt-5 rounded-2xl border border-dashed px-5 py-10 text-center">
              <div className="text-4xl">🏛️</div>

              <div className="trophy-empty-title mt-3 font-bold">
                No league awards yet
              </div>

              <div className="trophy-empty-copy mt-1 text-sm">
                Commissioner-created honors will appear here.
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {selectedAwards.map((award) => (
                <CollectibleCard
                  key={award.id}
                  rarity={award.rarity}
                  featured={award.featured}
                  className={`relative overflow-hidden p-6 text-center ${
                    award.featured
                      ? "md:col-span-2 min-h-[330px]"
                      : "min-h-[275px]"
                  }`}
                >
                  {award.featured ? (
                    <div className="absolute right-4 top-4 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-800">
                      Featured
                    </div>
                  ) : null}

                  <div className="collectible-rarity">
                    {rarityLabels[award.rarity]}
                  </div>

                  <div className="mt-6 text-6xl drop-shadow-sm">
                    {award.emoji}
                  </div>

                  <h4 className="collectible-title mt-5 text-2xl font-black">
                    {award.title}
                  </h4>

                  <div className="collectible-meta mt-2 text-sm font-bold">
                    {award.season}
                  </div>

                  {award.description ? (
                    <p className="collectible-copy mx-auto mt-4 max-w-xl text-sm leading-6">
                      {award.description}
                    </p>
                  ) : null}
                </CollectibleCard>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
