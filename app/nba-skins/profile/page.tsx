"use client";

import AppNav from "@/components/AppNav";
import {
  useEffect,
  useMemo,
  useState,
} from "react";


type CurrentUser = {
  id: string;
  teamId: number;
  displayName: string;
  role:
    | "player"
    | "admin";
  avatarUrl:
    | string
    | null;
};


type PickSummary = {
  picks: number;
  points: number;
  average:
    | number
    | null;
};


type ProfilePick = {
  id: number;
  nbaTeamAbbreviation: string;
  nbaTeamName: string;
  pickType:
    | "wins"
    | "losses";
  points: number;
  season: number;
};


type SeasonHistory = {
  season: number;
  finish:
    | number
    | null;
  points: number;

  picks: Array<{
    id: number;
    nbaTeamAbbreviation: string;
    nbaTeamName: string;
    pickType:
      | "wins"
      | "losses";
    points: number;
  }>;
};


type ProfileResponse = {
  success: boolean;

  team: {
    id: number;
    name: string;
  };

  availableSeasons:
    number[];

  career: {
    seasonsPlayed: number;
    championships: number;
    runnerUps: number;
    podiumFinishes: number;
    careerPoints: number;
    avgPoints:
      | number
      | null;
    avgFinish:
      | number
      | null;

    bestSeason:
      | {
          season: number;
          points: number;
          finish:
            | number
            | null;
        }
      | null;

    bestPick:
      | ProfilePick
      | null;

    worstPick:
      | ProfilePick
      | null;

    winsPicks:
      PickSummary;

    lossesPicks:
      PickSummary;
  };

  seasonHistory:
    SeasonHistory[];

  error?: string;
};


const TEAM_HEADSHOTS: Record<
  string,
  string
> = {
  Andy:
    "/team-headshots/andy.jpg",

  Jon:
    "/team-headshots/jon.jpg",

  Josh:
    "/team-headshots/josh.jpg",

  Mark:
    "/team-headshots/mark.jpg",
};


function seasonLabel(
  season: number,
) {
  return `${season}-${String(
    season + 1,
  ).slice(-2)}`;
}


function ordinal(
  value:
    | number
    | null,
) {
  if (value === null) {
    return "—";
  }

  const lastTwo =
    value % 100;

  if (
    lastTwo >= 11 &&
    lastTwo <= 13
  ) {
    return `${value}th`;
  }

  if (
    value % 10 === 1
  ) {
    return `${value}st`;
  }

  if (
    value % 10 === 2
  ) {
    return `${value}nd`;
  }

  if (
    value % 10 === 3
  ) {
    return `${value}rd`;
  }

  return `${value}th`;
}


function StatCard({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value:
    | string
    | number;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-2xl border border-blue-500/30 bg-gradient-to-br from-slate-900 to-blue-950/70 p-4"
          : "rounded-2xl border border-slate-700 bg-slate-900 p-4"
      }
    >
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">
        {label}
      </div>

      <div className="mt-2 text-2xl font-black tabular-nums text-white">
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


export default function NbaSkinsProfilePage() {
  const [
    user,
    setUser,
  ] =
    useState<
      CurrentUser | null
    >(null);

  const [
    profile,
    setProfile,
  ] =
    useState<
      ProfileResponse | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);


  useEffect(() => {
    let cancelled =
      false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const meResponse =
          await fetch(
            "/api/me",
            {
              cache:
                "no-store",
            },
          );

        const me =
          await meResponse.json();

        if (
          !meResponse.ok ||
          !me?.authenticated ||
          !me?.user
        ) {
          throw new Error(
            "Login required to view your NBA Skins profile.",
          );
        }

        const currentUser =
          me.user as CurrentUser;

        const activeGroupTeamId =
          Number(
            me.groupContext?.team?.id,
          );

        if (
          !Number.isInteger(
            activeGroupTeamId,
          ) ||
          activeGroupTeamId <= 0
        ) {
          throw new Error(
            "Your active Group team could not be resolved.",
          );
        }

        const groupScopedUser = {
          ...currentUser,
          teamId:
            activeGroupTeamId,
        };

        if (cancelled) {
          return;
        }

        setUser(
          groupScopedUser,
        );

        const requestedTeamId =
          Number(
            new URLSearchParams(
              window.location.search,
            ).get(
              "teamId",
            ),
          );

        const profileTeamId =
          Number.isInteger(
            requestedTeamId,
          ) &&
          requestedTeamId > 0
            ? requestedTeamId
            : activeGroupTeamId;

        const profileResponse =
          await fetch(
            `/api/nba-skins/profile?teamId=${profileTeamId}`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await profileResponse.json() as ProfileResponse;

        if (
          !profileResponse.ok
        ) {
          throw new Error(
            result.error ??
              "Unable to load NBA Skins profile.",
          );
        }

        if (!cancelled) {
          setProfile(
            result,
          );
        }
      } catch (
        loadError
      ) {
        if (!cancelled) {
          setError(
            loadError instanceof
            Error
              ? loadError.message
              : "Unable to load NBA Skins profile.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(
            false,
          );
        }
      }
    }

    void load();

    return () => {
      cancelled =
        true;
    };
  }, []);


  const headshot =
    useMemo(
      () => {
        const profileName =
          profile?.team.name ??
          user?.displayName ??
          "";

        const viewingSelf =
          profile?.team.id ===
          user?.teamId;

        return (
          (
            viewingSelf
              ? user?.avatarUrl
              : null
          ) ??
          TEAM_HEADSHOTS[
            profileName
          ] ??
          null
        );
      },
      [
        profile,
        user,
      ],
    );


  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <AppNav />

        <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-6">
          <div className="flex items-center gap-4">
            {headshot ? (
              <img
                src={headshot}
                alt={
                  profile
                    ? `${profile.team.name} profile`
                    : user
                      ? `${user.displayName} profile`
                      : "NBA Skins profile"
                }
                className="h-20 w-20 rounded-2xl border border-blue-500/25 object-cover shadow-sm sm:h-24 sm:w-24"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-blue-500/25 bg-blue-950/50 text-3xl font-black text-blue-200 sm:h-24 sm:w-24">
                {user?.displayName
                  ?.slice(
                    0,
                    1,
                  ) ??
                  "?"}
              </div>
            )}

            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
                NBA Skins Profile
              </div>

              <h1 className="mt-1 text-3xl font-black tracking-tight text-white">
                {profile?.team.name ??
                  user?.displayName ??
                  "Profile"}
              </h1>

              <p className="mt-1 text-sm text-slate-400">
                Career results, picks, and season history.
              </p>
            </div>
          </div>
        </section>


        {loading ? (
          <section className="rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center text-sm text-slate-400">
            Loading NBA Skins profile…
          </section>
        ) : error ? (
          <section className="rounded-3xl border border-red-500/30 bg-red-950/20 p-6 text-sm text-red-200">
            {error}
          </section>
        ) : profile ? (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Championships"
                value={
                  profile.career
                    .championships
                }
                detail={`${profile.career.seasonsPlayed} seasons played`}
                accent
              />

              <StatCard
                label="Runner-Ups"
                value={
                  profile.career
                    .runnerUps
                }
                detail={`${profile.career.podiumFinishes} podium finishes`}
              />

              <StatCard
                label="Career Points"
                value={
                  profile.career
                    .careerPoints
                }
                detail={
                  profile.career
                    .avgPoints !==
                  null
                    ? `${profile.career.avgPoints} per season`
                    : undefined
                }
              />

              <StatCard
                label="Average Finish"
                value={
                  profile.career
                    .avgFinish !==
                  null
                    ? profile.career
                        .avgFinish
                    : "—"
                }
                detail={
                  profile.career
                    .bestSeason
                    ? `Best season: ${seasonLabel(
                        profile
                          .career
                          .bestSeason
                          .season,
                      )}`
                    : undefined
                }
              />
            </section>


            <section className="grid gap-3 md:grid-cols-3">
              <article className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
                  Best Season
                </div>

                {profile.career
                  .bestSeason ? (
                  <>
                    <div className="mt-2 text-2xl font-black text-white">
                      {seasonLabel(
                        profile
                          .career
                          .bestSeason
                          .season,
                      )}
                    </div>

                    <div className="mt-1 text-sm text-slate-400">
                      {
                        profile
                          .career
                          .bestSeason
                          .points
                      }{" "}
                      points ·{" "}
                      {ordinal(
                        profile
                          .career
                          .bestSeason
                          .finish,
                      )}{" "}
                      place
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">
                    No completed seasons.
                  </div>
                )}
              </article>


              <article className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
                  Best Pick
                </div>

                {profile.career
                  .bestPick ? (
                  <>
                    <div className="mt-2 text-2xl font-black text-white">
                      {
                        profile
                          .career
                          .bestPick
                          .nbaTeamAbbreviation
                      }{" "}
                      <span className="text-blue-300">
                        {
                          profile
                            .career
                            .bestPick
                            .points
                        }
                      </span>
                    </div>

                    <div className="mt-1 text-sm text-slate-400">
                      {
                        profile
                          .career
                          .bestPick
                          .nbaTeamName
                      }{" "}
                      ·{" "}
                      {
                        profile
                          .career
                          .bestPick
                          .pickType
                      }{" "}
                      ·{" "}
                      {seasonLabel(
                        profile
                          .career
                          .bestPick
                          .season,
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">
                    No completed picks.
                  </div>
                )}
              </article>


              <article className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
                  Lowest Pick
                </div>

                {profile.career
                  .worstPick ? (
                  <>
                    <div className="mt-2 text-2xl font-black text-white">
                      {
                        profile
                          .career
                          .worstPick
                          .nbaTeamAbbreviation
                      }{" "}
                      <span className="text-slate-400">
                        {
                          profile
                            .career
                            .worstPick
                            .points
                        }
                      </span>
                    </div>

                    <div className="mt-1 text-sm text-slate-400">
                      {
                        profile
                          .career
                          .worstPick
                          .nbaTeamName
                      }{" "}
                      ·{" "}
                      {
                        profile
                          .career
                          .worstPick
                          .pickType
                      }{" "}
                      ·{" "}
                      {seasonLabel(
                        profile
                          .career
                          .worstPick
                          .season,
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">
                    No completed picks.
                  </div>
                )}
              </article>
            </section>


            <section className="grid gap-3 sm:grid-cols-2">
              <article className="rounded-3xl border border-emerald-500/20 bg-emerald-950/15 p-5">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                  Wins Picks
                </div>

                <div className="mt-2 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-2xl font-black text-white">
                      {
                        profile.career
                          .winsPicks
                          .points
                      }
                    </div>

                    <div className="text-xs text-slate-400">
                      {
                        profile.career
                          .winsPicks
                          .picks
                      }{" "}
                      picks
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xl font-black text-emerald-300">
                      {profile.career
                        .winsPicks
                        .average ??
                        "—"}
                    </div>

                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Avg / Pick
                    </div>
                  </div>
                </div>
              </article>


              <article className="rounded-3xl border border-rose-500/20 bg-rose-950/15 p-5">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-300">
                  Losses Picks
                </div>

                <div className="mt-2 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-2xl font-black text-white">
                      {
                        profile.career
                          .lossesPicks
                          .points
                      }
                    </div>

                    <div className="text-xs text-slate-400">
                      {
                        profile.career
                          .lossesPicks
                          .picks
                      }{" "}
                      picks
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xl font-black text-rose-300">
                      {profile.career
                        .lossesPicks
                        .average ??
                        "—"}
                    </div>

                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Avg / Pick
                    </div>
                  </div>
                </div>
              </article>
            </section>


            <section
              id="trophy-case"
              className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/20 p-5 sm:p-6"
            >
              <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                Trophy Case
              </div>

              <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-black text-white">
                    Championship Shelf
                  </h2>

                  <p className="mt-1 text-sm text-slate-400">
                    NBA Skins season championships only.
                  </p>
                </div>

                <div className="text-sm font-bold text-amber-300">
                  {profile.career.championships} championship
                  {profile.career.championships === 1 ? "" : "s"}
                </div>
              </div>

              {profile.career.championships > 0 ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {profile.seasonHistory
                    .filter((season) => season.finish === 1)
                    .map((season) => (
                      <div
                        key={season.season}
                        className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4"
                      >
                        <div className="text-3xl">
                          🏆
                        </div>

                        <div className="mt-3 text-lg font-black text-white">
                          {seasonLabel(season.season)}
                        </div>

                        <div className="mt-1 text-xs font-bold uppercase tracking-wider text-amber-300">
                          NBA Skins Champion
                        </div>

                        <div className="mt-3 text-sm text-slate-400">
                          {season.points} points
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-slate-700 px-5 py-8 text-center text-sm text-slate-500">
                  No NBA Skins championships yet.
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
                  Season History
                </div>

                <h2 className="mt-1 text-2xl font-black text-white">
                  Career results
                </h2>
              </div>

              {profile.seasonHistory.map(
                (season) => (
                  <article
                    key={season.season}
                    className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900"
                  >
                    <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-5">
                      <div>
                        <div className="text-lg font-black text-white">
                          {seasonLabel(
                            season.season,
                          )}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {ordinal(
                            season.finish,
                          )}{" "}
                          place
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Points
                        </div>

                        <div className="text-xl font-black tabular-nums text-white">
                          {
                            season.points
                          }
                        </div>
                      </div>
                    </div>

                    <div className="grid divide-y divide-slate-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:divide-slate-800 lg:grid-cols-4">
                      {season.picks.map(
                        (pick) => (
                          <div
                            key={pick.id}
                            className="flex items-center justify-between gap-3 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <div className="font-black text-white">
                                {
                                  pick.nbaTeamAbbreviation
                                }
                              </div>

                              <div className="mt-1 truncate text-xs text-slate-500">
                                {
                                  pick.nbaTeamName
                                }
                              </div>

                              <span
                                className={
                                  pick.pickType ===
                                  "wins"
                                    ? "mt-2 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-300"
                                    : "mt-2 inline-flex rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-300"
                                }
                              >
                                {
                                  pick.pickType
                                }
                              </span>
                            </div>

                            <div className="text-right">
                              <div className="text-lg font-black tabular-nums text-white">
                                {
                                  pick.points
                                }
                              </div>

                              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">
                                pts
                              </div>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </article>
                ),
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
