"use client";

import AppNav from "@/components/AppNav";
import Link from "next/link";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PushDeviceControls from "@/components/profile/PushDeviceControls";
import ChangePinForm from "@/components/profile/ChangePinForm";
import { useSelectedSport } from "@/components/providers/SportProvider";
import ProfilePictureSettings from "@/components/profile/ProfilePictureSettings";
import ProfileOverview from "@/components/profile/ProfileOverview";
import TrophyCase, {
  type LeagueAward,
  type TrophyMilestones,
  type MilestoneThresholds,
} from "@/components/profile/TrophyCase";

type CurrentUser = {
  id: string;
  teamId: number;
  displayName: string;
  role: "player" | "admin";
  avatarUrl: string | null;
};

type ProfileTab = "overview" | "awards" | "settings";
type SettingsTab =
  | "profile"
  | "notifications"
  | "security";

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
    avatarUrl: string | null;
  };
  latestSeason: number;
  selectedSeason: number | "all";
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

function ProfilePageContent() {
  const { selectedSport } = useSelectedSport();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [profile, setProfile] = useState<TeamProfile | null>(null);
  const [season, setSeason] = useState<number | "all">("all");
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<SettingsTab>("profile");
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [message, setMessage] = useState("");
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences | null>(null);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");

  useEffect(() => {
    const requestedTab = searchParams.get("tab");

    if (
      requestedTab === "overview" ||
      requestedTab === "awards" ||
      requestedTab === "settings"
    ) {
      setActiveTab(requestedTab);
    } else {
      setActiveTab("overview");
    }
  }, [searchParams]);

  function changeProfileTab(tab: ProfileTab) {
    setActiveTab(tab);

    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);

    router.replace(`${pathname}?${params.toString()}`, {
      scroll: false,
    });
  }

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
          `/api/team-profile?teamId=${currentUser.teamId}&season=${season}&sport=${selectedSport}`,
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
  }, [user, season, selectedSport]);


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

  const fallbackHeadshot = user
    ? TEAM_HEADSHOTS[user.displayName] ?? null
    : null;

  const headshot = user?.avatarUrl ?? fallbackHeadshot;

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
                  {
                    id: "awards",
                    label: "Trophy Case",
                    icon: "🏆",
                  },
                  { id: "settings", label: "Settings", icon: "⚙️" },
                ].map((tab) => {
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() =>
                        changeProfileTab(tab.id as ProfileTab)
                      }
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
                      slatesPlayed:
                        profile.careerSummary.slatesPlayed,
                    }}
                    milestones={profile.milestones}
                    leagueAwards={profile.leagueAwards}
                    thresholds={profile.milestoneThresholds}
                  />
                ) : null}

                {activeTab === "settings" ? (
                  <div className="space-y-5">
                    <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          {
                            id: "profile",
                            label: "Profile",
                            icon: "👤",
                          },
                          {
                            id: "notifications",
                            label: "Notifications",
                            icon: "🔔",
                          },
                          {
                            id: "security",
                            label: "Security",
                            icon: "🔐",
                          },
                        ].map((tab) => {
                          const isActive = activeSettingsTab === tab.id;

                          return (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() =>
                                setActiveSettingsTab(tab.id as SettingsTab)
                              }
                              className={`rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                                isActive
                                  ? "bg-sky-100 text-sky-900 shadow-sm"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              }`}
                            >
                              <span className="mr-1 hidden sm:inline">
                                {tab.icon}
                              </span>
                              {tab.label}
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    {activeSettingsTab === "profile" && user ? (
                      <ProfilePictureSettings
                        displayName={user.displayName}
                        avatarUrl={user.avatarUrl}
                        fallbackUrl={fallbackHeadshot}
                        onAvatarChanged={(avatarUrl) => {
                          setUser((current) =>
                            current
                              ? {
                                  ...current,
                                  avatarUrl,
                                }
                              : current
                          );

                          window.dispatchEvent(
                            new CustomEvent(
                              "profile-avatar-updated",
                              {
                                detail: {
                                  avatarUrl,
                                },
                              }
                            )
                          );
                        }}
                      />
                    ) : null}

                    {activeSettingsTab === "notifications" ? (
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
                          These choices are saved to your league account.
                          Push delivery also requires this device to be
                          registered.
                        </p>
                      </section>
                    ) : null}

                    {activeSettingsTab === "security" ? (
                      <ChangePinForm />
                    ) : null}
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


export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6">
          <div className="mx-auto max-w-7xl">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-sm text-slate-500">
                Loading profile...
              </div>
            </section>
          </div>
        </main>
      }
    >
      <ProfilePageContent />
    </Suspense>
  );
}
