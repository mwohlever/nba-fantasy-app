"use client";

import AppNav from "@/components/AppNav";
import Link from "next/link";
import { useEffect, useState } from "react";
import PushDeviceControls from "@/components/profile/PushDeviceControls";

type CurrentUser = {
  id: string;
  teamId: number;
  displayName: string;
  role: "player" | "admin";
};

type ProfileTab = "overview" | "awards" | "settings";

type NotificationPreferences = {
  notificationsEnabled: boolean;
  draftTurnEnabled: boolean;
  playerFinishedEnabled: boolean;
  slateFinalEnabled: boolean;
};

type TeamProfile = {
  success: boolean;
  team: {
    id: number;
    name: string;
  };
  latestSeason: number;
  selectedSeason: number | "all";
  seasonSummary: {
    slatesPlayed: number;
    wins: number;
    runnerUps: number;
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

const TEAM_HEADSHOTS: Record<string, string> = {
  Andy: "/team-headshots/andy.jpg",
  Jon: "/team-headshots/jon.jpg",
  Josh: "/team-headshots/josh.jpg",
  Mark: "/team-headshots/mark.jpg",
};

function fmt(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(digits);
}

function SettingToggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-slate-100 py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div>
        <div className="font-semibold text-slate-900">{label}</div>
        <div className="mt-1 text-sm leading-5 text-slate-500">
          {description}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? "bg-sky-600" : "bg-slate-300"
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "neutral" | "green" | "orange" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "orange"
        ? "border-orange-200 bg-orange-50"
        : tone === "red"
          ? "border-red-200 bg-red-50"
          : "border-slate-200 bg-white";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-2 text-2xl font-bold text-slate-900">
        {value}
      </div>

      {detail ? (
        <div className="mt-1 text-xs leading-5 text-slate-500">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export default function ProfilePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [profile, setProfile] = useState<TeamProfile | null>(null);
  const [season, setSeason] = useState<number | "all">("all");
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [message, setMessage] = useState("");
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences | null>(null);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");

  useEffect(() => {
    async function loadUser() {
      try {
        const response = await fetch("/api/me", {
          cache: "no-store",
        });

        const result = await response.json();

        if (response.ok && result.authenticated && result.user) {
          setUser(result.user as CurrentUser);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Failed to load current user", error);
        setMessage("Unable to load your profile.");
      } finally {
        setIsLoadingUser(false);
      }
    }

    void loadUser();
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    const currentUser = user;
    let active = true;

    async function loadProfile() {
      try {
        setIsLoadingProfile(true);
        setMessage("");

        const response = await fetch(
          `/api/team-profile?teamId=${currentUser.teamId}&season=${season}`,
          {
            cache: "no-store",
          }
        );

        const result = await response.json();

        if (!response.ok) {
          if (active) {
            setMessage(result.error || "Unable to load your profile.");
            setProfile(null);
          }
          return;
        }

        if (active) {
          setProfile(result as TeamProfile);
        }
      } catch (error) {
        console.error("Failed to load team profile", error);

        if (active) {
          setMessage("Unable to load your profile.");
          setProfile(null);
        }
      } finally {
        if (active) {
          setIsLoadingProfile(false);
        }
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [user, season]);


  useEffect(() => {
    if (!user || activeTab !== "settings") return;

    let active = true;

    async function loadPreferences() {
      try {
        setIsLoadingPreferences(true);
        setPreferenceMessage("");

        const response = await fetch("/api/notification-preferences", {
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
          if (active) {
            setPreferenceMessage(
              result.error || "Unable to load notification settings."
            );
          }
          return;
        }

        if (active) {
          setNotificationPreferences(
            result.preferences as NotificationPreferences
          );
        }
      } catch (error) {
        console.error("Failed to load notification preferences", error);

        if (active) {
          setPreferenceMessage("Unable to load notification settings.");
        }
      } finally {
        if (active) {
          setIsLoadingPreferences(false);
        }
      }
    }

    void loadPreferences();

    return () => {
      active = false;
    };
  }, [user, activeTab]);

  async function updateNotificationPreferences(
    nextPreferences: NotificationPreferences
  ) {
    const previousPreferences = notificationPreferences;

    try {
      setNotificationPreferences(nextPreferences);
      setIsSavingPreferences(true);
      setPreferenceMessage("");

      const response = await fetch("/api/notification-preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nextPreferences),
      });

      const result = await response.json();

      if (!response.ok) {
        setNotificationPreferences(previousPreferences);
        setPreferenceMessage(
          result.error || "Unable to save notification settings."
        );
        return;
      }

      setNotificationPreferences(
        result.preferences as NotificationPreferences
      );
      setPreferenceMessage("Notification settings saved.");
    } catch (error) {
      console.error("Failed to update notification preferences", error);
      setNotificationPreferences(previousPreferences);
      setPreferenceMessage("Unable to save notification settings.");
    } finally {
      setIsSavingPreferences(false);
    }
  }

  const availableSeasons = profile
    ? Array.from(
        { length: Math.max(profile.latestSeason - 2023 + 1, 1) },
        (_, index) => profile.latestSeason - index
      )
    : [2026, 2025, 2024, 2023];

  const headshot = user
    ? TEAM_HEADSHOTS[user.displayName]
    : null;

  const hasDraftPosition =
    profile?.recentSlates.some((row) => row.draftPosition !== null) ?? false;

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        {isLoadingUser ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm text-slate-500">Loading profile...</div>
          </section>
        ) : !user ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="text-4xl">🔒</div>

            <h1 className="mt-4 text-2xl font-bold">
              Login required
            </h1>

            <p className="mt-2 text-sm text-slate-600">
              Sign in to view your league profile.
            </p>

            <Link
              href="/login"
              className="mt-5 inline-block rounded-xl bg-sky-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-800"
            >
              Go to Login
            </Link>
          </section>
        ) : (
          <>
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-4">
                {headshot ? (
                  <img
                    src={headshot}
                    alt={`${user.displayName} profile`}
                    className="h-24 w-24 rounded-3xl border border-slate-200 object-cover shadow-sm"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-slate-200 bg-slate-100 text-3xl font-bold text-slate-500">
                    {user.displayName.slice(0, 1)}
                  </div>
                )}

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                    League Profile
                  </div>

                  <h1 className="mt-1 text-3xl font-bold tracking-tight">
                    {user.displayName}
                  </h1>

                  <p className="mt-1 text-sm text-slate-500">
                    Career stats, awards, and account settings.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "overview", label: "Overview", icon: "📊" },
                  { id: "awards", label: "Awards", icon: "🏆" },
                  { id: "settings", label: "Settings", icon: "⚙️" },
                ].map((tab) => {
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as ProfileTab)}
                      className={`rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                        isActive
                          ? "bg-sky-100 text-sky-900 shadow-sm"
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

            {message ? (
              <section className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 shadow-sm">
                {message}
              </section>
            ) : null}

            {isLoadingProfile || !profile ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  Loading profile stats...
                </div>
              </section>
            ) : (
              <>
                {activeTab === "overview" ? (
                  <>
                    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <h2 className="text-2xl font-bold text-slate-900">
                            Team Stats
                          </h2>
                          <p className="mt-1 text-sm text-slate-500">
                            Explore your career or a single season.
                          </p>
                        </div>

                        <div className="w-full sm:w-auto">
                          <label
                            htmlFor="profile-season"
                            className="mb-1 block text-xs font-medium text-slate-500"
                          >
                            View
                          </label>

                          <select
                            id="profile-season"
                            value={season}
                            onChange={(event) =>
                              setSeason(
                                event.target.value === "all"
                                  ? "all"
                                  : Number(event.target.value)
                              )
                            }
                            className="w-full min-w-[150px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-300"
                          >
                            <option value="all">All-Time</option>

                            {availableSeasons.map((year) => (
                              <option key={year} value={year}>
                                {year}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </section>

                    {season !== "all" ? (
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4">
                      <h2 className="text-2xl font-bold">
                        {season} Season
                      </h2>

                      <p className="mt-1 text-sm text-slate-500">
                        Performance during the selected season.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                      <StatCard
                        label="Wins"
                        value={profile.seasonSummary.wins}
                        tone="green"
                      />

                      <StatCard
                        label="Runner-ups"
                        value={profile.seasonSummary.runnerUps}
                        tone="orange"
                      />

                      <StatCard
                        label="Win Rate"
                        value={`${fmt(profile.seasonSummary.winRate)}%`}
                      />

                      <StatCard
                        label="Avg Finish"
                        value={fmt(profile.seasonSummary.avgFinish)}
                      />

                      <StatCard
                        label="Avg Score"
                        value={fmt(profile.seasonSummary.avgScore)}
                      />

                      <StatCard
                        label="Win Streak"
                        value={profile.seasonSummary.currentWinStreak}
                        detail={`Best: ${profile.seasonSummary.longestWinStreak}`}
                      />
                    </div>
                  </section>
                ) : null}

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4">
                    <h2 className="text-2xl font-bold">
                      Career Stats
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      All completed recorded slates.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard
                      label="Career Wins"
                      value={profile.careerSummary.wins}
                      tone="green"
                    />

                    <StatCard
                      label="Runner-ups"
                      value={profile.careerSummary.runnerUps}
                      tone="orange"
                    />

                    <StatCard
                      label="Avg Finish"
                      value={fmt(profile.careerSummary.avgFinish)}
                    />

                    <StatCard
                      label="Avg Score"
                      value={fmt(profile.careerSummary.avgScore)}
                    />

                    <StatCard
                      label="Favorite Player"
                      value={
                        profile.careerSummary.favoritePlayer?.playerName ?? "—"
                      }
                      detail={
                        profile.careerSummary.favoritePlayer
                          ? `${profile.careerSummary.favoritePlayer.count} drafts`
                          : undefined
                      }
                    />

                    <StatCard
                      label="Highest Avg Player"
                      value={
                        profile.careerSummary.bestAvgPlayer?.playerName ?? "—"
                      }
                      detail={
                        profile.careerSummary.bestAvgPlayer
                          ? `${fmt(profile.careerSummary.bestAvgPlayer.avg)} FP • ${profile.careerSummary.bestAvgPlayer.count} games`
                          : undefined
                      }
                    />

                    <StatCard
                      label="Best Pick Ever"
                      value={
                        profile.careerSummary.bestPickEver?.playerName ?? "—"
                      }
                      detail={
                        profile.careerSummary.bestPickEver
                          ? `${fmt(profile.careerSummary.bestPickEver.fantasyPoints)} FP • ${profile.careerSummary.bestPickEver.slateLabel}`
                          : undefined
                      }
                      tone="green"
                    />

                    <StatCard
                      label="Longest Win Streak"
                      value={profile.careerSummary.longestWinStreak}
                    />

                    <StatCard
                      label="Best Slate"
                      value={
                        profile.careerSummary.bestSlate
                          ? fmt(profile.careerSummary.bestSlate.score)
                          : "—"
                      }
                      detail={profile.careerSummary.bestSlate?.slateLabel}
                      tone="green"
                    />

                    <StatCard
                      label="Worst Slate"
                      value={
                        profile.careerSummary.worstSlate
                          ? fmt(profile.careerSummary.worstSlate.score)
                          : "—"
                      }
                      detail={profile.careerSummary.worstSlate?.slateLabel}
                      tone="red"
                    />

                    <StatCard
                      label="Career Win Rate"
                      value={`${fmt(profile.careerSummary.winRate)}%`}
                    />

                    <StatCard
                      label="Slates Played"
                      value={profile.careerSummary.slatesPlayed}
                    />
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4">
                    <h2 className="text-2xl font-bold">
                      Recent Results
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      Your eight most recent completed slates.
                    </p>
                  </div>

                  {profile.recentSlates.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                      No recent slate results found.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-100 text-slate-700">
                            <tr className="text-left">
                              <th className="px-3 py-3">Slate</th>
                              <th className="px-3 py-3">Finish</th>
                              <th className="px-3 py-3 text-right">Score</th>

                              {hasDraftPosition ? (
                                <th className="px-3 py-3 text-right">
                                  Draft
                                </th>
                              ) : null}

                              <th className="px-3 py-3">
                                Top Player
                              </th>

                              <th className="px-3 py-3 text-right">
                                FP
                              </th>
                            </tr>
                          </thead>

                          <tbody className="bg-white">
                            {profile.recentSlates.map((row) => (
                              <tr
                                key={row.slateId}
                                className="border-t border-slate-100"
                              >
                                <td className="whitespace-nowrap px-3 py-3">
                                  {row.slateLabel}
                                </td>

                                <td className="px-3 py-3 font-semibold">
                                  {row.finishPosition
                                    ? `#${row.finishPosition}`
                                    : "—"}
                                </td>

                                <td className="px-3 py-3 text-right font-semibold">
                                  {fmt(row.score)}
                                </td>

                                {hasDraftPosition ? (
                                  <td className="px-3 py-3 text-right">
                                    {row.draftPosition
                                      ? `#${row.draftPosition}`
                                      : "—"}
                                  </td>
                                ) : null}

                                <td className="whitespace-nowrap px-3 py-3">
                                  {row.topPlayer?.playerName ?? "—"}
                                </td>

                                <td className="px-3 py-3 text-right">
                                  {row.topPlayer?.fantasyPoints !== null &&
                                  row.topPlayer?.fantasyPoints !== undefined
                                    ? fmt(row.topPlayer.fantasyPoints)
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>

                  </>
                ) : null}

                {activeTab === "awards" ? (
                  <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 text-center shadow-sm">
                    <div className="text-5xl">🏆</div>

                    <h2 className="mt-4 text-2xl font-bold text-slate-900">
                      Trophy Case Coming Soon
                    </h2>

                    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      Season awards, championships, and future All-111 honors will
                      live here.
                    </p>
                  </section>
                ) : null}

                {activeTab === "settings" ? (
                  <div className="space-y-6">
                    <section className="rounded-3xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
                      <div>
                        <h2 className="text-xl font-bold text-slate-900">
                          Notification Settings
                        </h2>

                        <p className="mt-1 text-sm text-slate-600">
                          Choose which league alerts you want to receive.
                        </p>
                      </div>

                      <div className="mt-5">
                        <PushDeviceControls />
                      </div>

                      {preferenceMessage ? (
                        <div className="mt-4 rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-sky-800">
                          {preferenceMessage}
                        </div>
                      ) : null}

                      {isLoadingPreferences || !notificationPreferences ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-sky-300 bg-white/70 px-4 py-8 text-center text-sm text-slate-500">
                          Loading notification settings...
                        </div>
                      ) : (
                        <div className="mt-5 rounded-2xl border border-sky-200 bg-white p-4">
                          <SettingToggle
                            label="Enable Notifications"
                            description="Master switch for all push notifications."
                            checked={
                              notificationPreferences.notificationsEnabled
                            }
                            disabled={isSavingPreferences}
                            onChange={(checked) =>
                              void updateNotificationPreferences({
                                ...notificationPreferences,
                                notificationsEnabled: checked,
                              })
                            }
                          />

                          <SettingToggle
                            label="Draft Turn"
                            description="Notify me when it is my turn to make a pick."
                            checked={
                              notificationPreferences.draftTurnEnabled
                            }
                            disabled={
                              isSavingPreferences ||
                              !notificationPreferences.notificationsEnabled
                            }
                            onChange={(checked) =>
                              void updateNotificationPreferences({
                                ...notificationPreferences,
                                draftTurnEnabled: checked,
                              })
                            }
                          />

                          <SettingToggle
                            label="Player Finished"
                            description="Notify me when one of my drafted players finishes."
                            checked={
                              notificationPreferences.playerFinishedEnabled
                            }
                            disabled={
                              isSavingPreferences ||
                              !notificationPreferences.notificationsEnabled
                            }
                            onChange={(checked) =>
                              void updateNotificationPreferences({
                                ...notificationPreferences,
                                playerFinishedEnabled: checked,
                              })
                            }
                          />

                          <SettingToggle
                            label="Slate Final"
                            description="Notify me when the slate standings become final."
                            checked={
                              notificationPreferences.slateFinalEnabled
                            }
                            disabled={
                              isSavingPreferences ||
                              !notificationPreferences.notificationsEnabled
                            }
                            onChange={(checked) =>
                              void updateNotificationPreferences({
                                ...notificationPreferences,
                                slateFinalEnabled: checked,
                              })
                            }
                          />
                        </div>
                      )}

                      <p className="mt-4 text-xs leading-5 text-slate-500">
                        These choices are saved now. Push delivery will be enabled
                        after this device is registered.
                      </p>
                    </section>

                    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h2 className="text-xl font-bold text-slate-900">
                        Account
                      </h2>

                      <p className="mt-1 text-sm text-slate-600">
                        Change your PIN and manage signed-in devices here later.
                      </p>

                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
                        Account controls coming soon.
                      </div>
                    </section>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
