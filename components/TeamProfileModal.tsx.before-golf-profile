"use client";

import { useEffect, useState } from "react";
import ProfileOverview from "@/components/profile/ProfileOverview";
import TrophyCase, {
  type LeagueAward,
  type TrophyMilestones,
  type MilestoneThresholds,
} from "@/components/profile/TrophyCase";
import { useSelectedSport } from "@/components/providers/SportProvider";

type SeasonValue = number | "all";
type ProfileTab = "overview" | "awards";

type TeamProfile = {
  success: boolean;
  team: {
    id: number;
    name: string;
    avatarUrl: string | null;
  };
  latestSeason: number;
  selectedSeason: SeasonValue;
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
  milestones: TrophyMilestones;
  milestoneThresholds: MilestoneThresholds;
  leagueAwards: LeagueAward[];
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

type TeamReference = {
  id: number;
  name: string;
};

type Props = {
  team: TeamReference | null;
  setTeam: (team: TeamReference | null) => void;
};

const TEAM_HEADSHOTS: Record<string, string> = {
  Andy: "/team-headshots/andy.jpg",
  Jon: "/team-headshots/jon.jpg",
  Josh: "/team-headshots/josh.jpg",
  Mark: "/team-headshots/mark.jpg",
};

export default function TeamProfileModal({ team, setTeam }: Props) {
  const { selectedSport } = useSelectedSport();
  const [profile, setProfile] = useState<TeamProfile | null>(null);
  const [season, setSeason] = useState<SeasonValue>("all");
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!team) {
      setProfile(null);
      setSeason("all");
      setActiveTab("overview");
      setMessage("");
      setIsLoading(false);
      return;
    }

    setProfile(null);
    setSeason("all");
    setActiveTab("overview");
    setMessage("");
  }, [team?.id]);

  useEffect(() => {
    if (!team) return;

    const currentTeam = team;
    let active = true;

    async function loadProfile() {
      try {
        setIsLoading(true);
        setMessage("");

        const response = await fetch(
          `/api/team-profile?teamId=${currentTeam.id}&season=${season}&sport=${selectedSport}`,
          {
            cache: "no-store",
          }
        );

        const result = await response.json();

        if (!response.ok) {
          if (active) {
            setProfile(null);
            setMessage(
              result.error || `Unable to load ${currentTeam.name}'s profile.`
            );
          }

          return;
        }

        if (active) {
          setProfile(result as TeamProfile);
        }
      } catch (error) {
        console.error("Failed to load viewed team profile", error);

        if (active) {
          setProfile(null);
          setMessage(`Unable to load ${currentTeam.name}'s profile.`);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [team, season, selectedSport]);

  useEffect(() => {
    if (!team) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTeam(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [team, setTeam]);

  if (!team) return null;

  const availableSeasons = profile
    ? Array.from(
        { length: Math.max(profile.latestSeason - 2023 + 1, 1) },
        (_, index) => profile.latestSeason - index
      )
    : [2026, 2025, 2024, 2023];

  const fallbackHeadshot = TEAM_HEADSHOTS[team.name] ?? null;
  const headshot = profile?.team.avatarUrl ?? fallbackHeadshot;
  const displayName = profile?.team.name ?? team.name;

  return (
    <div
      className="mobile-modal-safe fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 px-2 py-2 backdrop-blur-sm sm:items-center sm:px-4 sm:py-5"
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName} league profile`}
      onClick={() => setTeam(null)}
    >
      <div
        className="mobile-modal-panel-safe flex max-h-[96dvh] w-full max-w-7xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-slate-50 text-slate-900 shadow-2xl sm:max-h-[94dvh] sm:rounded-3xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6 dark:border-slate-700 dark:bg-slate-900/95">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              {headshot ? (
                <img
                  src={headshot}
                  alt={`${displayName} profile`}
                  className="h-16 w-16 shrink-0 rounded-2xl border border-slate-200 object-cover shadow-sm sm:h-24 sm:w-24 sm:rounded-3xl dark:border-slate-700"
                />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-2xl font-bold text-slate-500 sm:h-24 sm:w-24 sm:rounded-3xl sm:text-3xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {displayName.slice(0, 1)}
                </div>
              )}

              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                  League Profile
                </div>

                <h2 className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">
                  {displayName}
                </h2>

                <p className="mt-1 hidden text-sm text-slate-500 sm:block dark:text-slate-400">
                  Career stats, awards, and league history.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setTeam(null)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-xl font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:h-auto sm:w-auto sm:px-4 sm:py-2 sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
              aria-label="Close team profile"
            >
              <span className="sm:hidden" aria-hidden="true">
                ×
              </span>
              <span className="hidden sm:inline">Close</span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-28 sm:px-5 sm:py-5 sm:pb-6">
          <div className="mx-auto max-w-7xl space-y-5">
            <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    id: "overview",
                    label: "Overview",
                    icon: "📊",
                  },
                  {
                    id: "awards",
                    label: "Trophy Case",
                    icon: "🏆",
                  },
                ].map((tab) => {
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as ProfileTab)}
                      className={`rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                        isActive
                          ? "bg-sky-100 text-sky-900 shadow-sm dark:bg-sky-700 dark:text-white"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                      }`}
                    >
                      <span className="mr-1 hidden sm:inline">{tab.icon}</span>
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {message ? (
              <section className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 shadow-sm dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200">
                {message}
              </section>
            ) : null}

            {isLoading || !profile ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
                  {message
                    ? "Profile unavailable."
                    : `Loading ${displayName}'s profile...`}
                </div>
              </section>
            ) : (
              <>
                {activeTab === "overview" ? (
                  <ProfileOverview
                    profile={profile}
                    teamId={profile.team.id}
                    season={season}
                    availableSeasons={availableSeasons}
                    onSeasonChange={setSeason}
                  />
                ) : null}

                {activeTab === "awards" ? (
                  <TrophyCase
                    key={profile.team.id}
                    teamName={profile.team.name}
                    career={{
                      wins: profile.careerSummary.wins,
                      runnerUps: profile.careerSummary.runnerUps,
                      podiumFinishes:
                        profile.careerSummary.podiumFinishes,
                      bestScore: profile.careerSummary.bestScore,
                      avgFinish: profile.careerSummary.avgFinish,
                      longestWinStreak:
                        profile.careerSummary.longestWinStreak,
                      slatesPlayed: profile.careerSummary.slatesPlayed,
                    }}
                    milestones={profile.milestones}
                    leagueAwards={profile.leagueAwards}
                    thresholds={profile.milestoneThresholds}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
