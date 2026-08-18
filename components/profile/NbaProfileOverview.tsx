"use client";

import { useState } from "react";
import SlateDetailModal from "@/components/profile/SlateDetailModal";

type SeasonValue = number | "all";

type ProfileOverviewData = {
  latestSeason: number;
  seasonSummary: {
    slatesPlayed: number;
    wins: number;
    runnerUps: number;
    podiumFinishes: number;
    winRate: number | null;
    avgFinish: number | null;
    avgScore: number | null;
    currentWinStreak: number;
    longestWinStreak: number;
  };
  careerSummary: {
    slatesPlayed: number;
    wins: number;
    runnerUps: number;
    podiumFinishes: number;
    winRate: number | null;
    avgFinish: number | null;
    avgScore: number | null;
    bestScore: number | null;
    worstScore: number | null;
    longestWinStreak: number;
    favoritePlayer: {
      playerName: string;
      count: number;
    } | null;
    bestAvgPlayer: {
      playerName: string;
      avg: number;
      count: number;
    } | null;
    bestPickEver: {
      playerName: string;
      fantasyPoints: number;
      slateLabel: string;
      finishPosition: number | null;
    } | null;
    bestSlate: {
      slateLabel: string;
      score: number;
      finishPosition: number | null;
    } | null;
    worstSlate: {
      slateLabel: string;
      score: number;
      finishPosition: number | null;
    } | null;
  };
  recentSlates: Array<{
    slateId: number;
    slateLabel: string;
    score: number;
    finishPosition: number | null;
    draftPosition: number | null;
    topPlayer: {
      playerName: string;
      fantasyPoints: number | null;
    } | null;
  }>;
};

type Props = {
  profile: ProfileOverviewData;
  teamId: number;
  season: SeasonValue;
  availableSeasons: number[];
  onSeasonChange: (season: SeasonValue) => void;
};

function fmt(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(digits);
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
  value: string | number;
  detail?: string;
  featured?: boolean;
}) {
  return (
    <article
      className={`profile-metric-card ${
        featured ? "profile-metric-card--featured" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="profile-metric-label">{label}</div>
        <div className="text-2xl" aria-hidden="true">
          {icon}
        </div>
      </div>

      <div className="profile-metric-value">{value}</div>

      {detail ? (
        <div className="profile-metric-detail">{detail}</div>
      ) : null}
    </article>
  );
}

function SpotlightCard({
  eyebrow,
  icon,
  title,
  primary,
  secondary,
}: {
  eyebrow: string;
  icon: string;
  title: string;
  primary: string;
  secondary?: string;
}) {
  return (
    <article className="profile-spotlight-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="profile-spotlight-eyebrow">{eyebrow}</div>
          <h3 className="profile-spotlight-title">{title}</h3>
        </div>

        <div className="text-3xl" aria-hidden="true">
          {icon}
        </div>
      </div>

      <div className="profile-spotlight-primary">{primary}</div>

      {secondary ? (
        <div className="profile-spotlight-secondary">{secondary}</div>
      ) : null}
    </article>
  );
}

function finishLabel(position: number | null) {
  if (!position) return "Result pending";
  if (position === 1) return "Winner";
  if (position === 2) return "Runner-up";
  if (position === 3) return "Podium";
  return `${position}th place`;
}

function finishIcon(position: number | null) {
  if (position === 1) return "🏆";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return "🏀";
}

export default function NbaProfileOverview({
  profile,
  teamId,
  season,
  availableSeasons,
  onSeasonChange,
}: Props) {
  const [selectedSlateId, setSelectedSlateId] =
    useState<number | null>(null);
  const career = profile.careerSummary;
  const selectedSummary =
    season === "all" ? profile.careerSummary : profile.seasonSummary;

  const isCareerView = season === "all";

  const selectedLabel = isCareerView
    ? "All-Time Career"
    : `${season} Season`;

  const resumeKicker = isCareerView
    ? "Career Résumé"
    : `${season} Season Résumé`;

  const resumeHeadline = isCareerView
    ? `${career.wins} career wins across ${career.slatesPlayed} slates`
    : `${profile.seasonSummary.wins} wins across ${profile.seasonSummary.slatesPlayed} slates in ${season}`;

  const resumeDescription = isCareerView
    ? "Career performance, signature picks, personal records, and recent form."
    : `Performance during the ${season} fantasy season, followed by permanent career records.`;

  return (
    <div className="space-y-5">
      <section className="profile-overview-hero">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="profile-overview-kicker">
              {resumeKicker}
            </div>

            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              {resumeHeadline}
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6">
              {resumeDescription}
            </p>
          </div>

          <label className="block w-full lg:w-auto">
            <span className="profile-overview-select-label">
              Stat view
            </span>

            <select
              value={season}
              onChange={(event) =>
                onSeasonChange(
                  event.target.value === "all"
                    ? "all"
                    : Number(event.target.value)
                )
              }
              className="profile-overview-select"
            >
              <option value="all">All-Time</option>

              {availableSeasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            icon="🏆"
            label="Wins"
            value={selectedSummary.wins}
            detail={selectedLabel}
            featured
          />

          <MetricCard
            icon="🥈"
            label="Runner-Ups"
            value={selectedSummary.runnerUps}
            detail={`${selectedSummary.podiumFinishes ?? 0} podium finishes`}
          />

          <MetricCard
            icon="🎯"
            label="Average Finish"
            value={fmt(selectedSummary.avgFinish)}
            detail={`${fmt(selectedSummary.winRate)}% win rate`}
          />

          <MetricCard
            icon="🔥"
            label="Average Score"
            value={fmt(selectedSummary.avgScore)}
            detail={`${selectedSummary.slatesPlayed} completed slates`}
          />
        </div>
      </section>

      <section className="profile-section-shell">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="profile-section-kicker">
              Career snapshot
            </div>

            <h2 className="profile-section-title">
              The numbers that define the résumé
            </h2>
          </div>

          <div className="profile-section-note">
            Updated after completed slates
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            icon="🚀"
            label="Career High"
            value={fmt(career.bestScore)}
            detail={career.bestSlate?.slateLabel}
            featured
          />

          <MetricCard
            icon="👑"
            label="Longest Streak"
            value={career.longestWinStreak}
            detail="Consecutive wins"
          />

          <MetricCard
            icon="📊"
            label="Career Win Rate"
            value={`${fmt(career.winRate)}%`}
            detail={`${career.wins} wins`}
          />

          <MetricCard
            icon="🏅"
            label="Podium Finishes"
            value={career.podiumFinishes}
            detail="Top-three finishes"
          />
        </div>
      </section>

      <section className="profile-section-shell">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="profile-section-kicker">
              Recent form
            </div>

            <h2 className="profile-section-title">
              Last eight completed slates
            </h2>

            <p className="profile-section-copy">
              Swipe through recent results on mobile.
            </p>
          </div>
        </div>

        {profile.recentSlates.length === 0 ? (
          <div className="profile-empty-state mt-5">
            No recent slate results found.
          </div>
        ) : (
          <div className="profile-results-strip mt-5">
            {profile.recentSlates.map((row) => (
              <button
                key={row.slateId}
                type="button"
                onClick={() => setSelectedSlateId(row.slateId)}
                className={`profile-result-card profile-result-card--button ${
                  row.finishPosition === 1
                    ? "profile-result-card--winner"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="profile-result-date">
                    {row.slateLabel}
                  </div>

                  <div className="text-2xl" aria-hidden="true">
                    {finishIcon(row.finishPosition)}
                  </div>
                </div>

                <div className="profile-result-finish">
                  {finishLabel(row.finishPosition)}
                </div>

                <div className="mt-4">
                  <div className="profile-result-label">Score</div>
                  <div className="profile-result-value">
                    {fmt(row.score)}
                  </div>
                </div>

                <div className="profile-result-divider" />

                <div className="profile-result-label">Top Player</div>

                <div className="profile-result-player">
                  {row.topPlayer?.playerName ?? "—"}
                </div>

                <div className="profile-result-player-score">
                  {row.topPlayer?.fantasyPoints !== null &&
                  row.topPlayer?.fantasyPoints !== undefined
                    ? `${fmt(row.topPlayer.fantasyPoints)} FP`
                    : "No score recorded"}
                </div>

                <div className="profile-result-open">
                  View slate details →
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="profile-section-shell">
        <div>
          <div className="profile-section-kicker">
            Player identity
          </div>

          <h2 className="profile-section-title">
            Signature picks
          </h2>

          <p className="profile-section-copy">
            The players most connected to this fantasy career.
          </p>
        </div>

        <div className="profile-signature-strip mt-5">
          <SpotlightCard
            eyebrow="Most Drafted"
            icon="⭐"
            title={career.favoritePlayer?.playerName ?? "No favorite yet"}
            primary={
              career.favoritePlayer
                ? `${career.favoritePlayer.count} drafts`
                : "No completed drafts"
            }
            secondary="The most frequently selected player"
          />

          <SpotlightCard
            eyebrow="Highest Average"
            icon="📈"
            title={career.bestAvgPlayer?.playerName ?? "No leader yet"}
            primary={
              career.bestAvgPlayer
                ? `${fmt(career.bestAvgPlayer.avg)} FP`
                : "No completed games"
            }
            secondary={
              career.bestAvgPlayer
                ? `Across ${career.bestAvgPlayer.count} games`
                : "Average will appear after completed games"
            }
          />

          <SpotlightCard
            eyebrow="Best Pick Ever"
            icon="💎"
            title={career.bestPickEver?.playerName ?? "No record yet"}
            primary={
              career.bestPickEver
                ? `${fmt(career.bestPickEver.fantasyPoints)} FP`
                : "No completed picks"
            }
            secondary={career.bestPickEver?.slateLabel}
          />
        </div>
      </section>

      {selectedSlateId !== null ? (
        <SlateDetailModal
          slateId={selectedSlateId}
          teamId={teamId}
          onClose={() => setSelectedSlateId(null)}
        />
      ) : null}
    </div>
  );
}
