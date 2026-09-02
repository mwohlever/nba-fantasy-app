"use client";

import AppNav from "@/components/AppNav";

import {
  useEffect,
  useMemo,
  useState,
} from "react";


type PickType =
  | "wins"
  | "losses";


type DraftPick = {
  pickNumber: number;
  round: number;
  roundPick: number;
  teamId: number;
  teamName: string;
  nbaTeamAbbreviation: string;
  pickType: PickType;
};


type DraftResponse = {
  success: boolean;

  currentUser:
    | {
        teamId: number;
        displayName: string;
        role:
          | "player"
          | "admin";
      }
    | null;

  availableSeasons: Array<{
    season: number;
    label: string;
    status:
      | "open"
      | "locked"
      | "final";
  }>;

  season: {
    id: number;
    season: number;
    label: string;
    status:
      | "open"
      | "locked"
      | "final";
    editable: boolean;
    participantCount: number;
    nbaTeamsPerParticipant: number;
    totalPicks: number;
  };

  draftOrder: Array<{
    teamId: number;
    teamName: string;
    draftPosition: number;
  }>;

  hasValidDraftOrder: boolean;

  nbaTeams: Array<{
    abbreviation: string;
    displayName: string;
  }>;

  picks:
    DraftPick[];

  error?: string;
};


function statusLabel(
  status:
    | "open"
    | "locked"
    | "final",
) {
  if (
    status ===
    "final"
  ) {
    return "Final";
  }

  if (
    status ===
    "locked"
  ) {
    return "Locked";
  }

  return "Open";
}


export default function NbaSkinsDraftPage() {
  const [
    data,
    setData,
  ] =
    useState<
      DraftResponse | null
    >(null);

  const [
    picks,
    setPicks,
  ] =
    useState<
      DraftPick[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    error,
    setError,
  ] =
    useState("");


  async function loadDraft() {
    try {
      setLoading(true);
      setError("");

      const response =
        await fetch(
          "/api/nba-skins/draft",
          {
            cache:
              "no-store",
          },
        );

      const result =
        await response.json() as DraftResponse;

      if (!response.ok) {
        throw new Error(
          result.error ??
            "Failed to load NBA Skins draft.",
        );
      }

      setData(
        result,
      );

      setPicks(
        result.picks,
      );
    } catch (
      loadError
    ) {
      setError(
        loadError instanceof
        Error
          ? loadError.message
          : "Failed to load NBA Skins draft.",
      );
    } finally {
      setLoading(
        false,
      );
    }
  }


  useEffect(() => {
    void loadDraft();
  }, []);


  const selectedCodes =
    useMemo(
      () =>
        new Set(
          picks
            .map(
              (pick) =>
                pick.nbaTeamAbbreviation,
            )
            .filter(
              Boolean,
            ),
        ),
      [picks],
    );


  const completedCount =
    picks.filter(
      (pick) =>
        Boolean(
          pick.nbaTeamAbbreviation,
        ),
    ).length;


  function updatePick(
    index: number,
    patch: Partial<
      DraftPick
    >,
  ) {
    setMessage("");

    setPicks(
      (current) =>
        current.map(
          (
            pick,
            pickIndex,
          ) =>
            pickIndex ===
            index
              ? {
                  ...pick,
                  ...patch,
                }
              : pick,
        ),
    );
  }


  async function saveDraft() {
    if (!data) {
      return;
    }

    if (
      !data.season.editable
    ) {
      return;
    }

    if (
      completedCount !== data.season.totalPicks
    ) {
      setError(
        `Complete all ${data.season.totalPicks} picks before saving. ${completedCount}/${data.season.totalPicks} are filled.`,
      );

      return;
    }

    try {
      setSaving(true);
      setError("");
      setMessage("");

      const response =
        await fetch(
          "/api/nba-skins/draft",
          {
            method:
              "PUT",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                season:
                  data.season.season,

                picks:
                  picks.map(
                    (pick) => ({
                      pickNumber:
                        pick.pickNumber,

                      round:
                        pick.round,

                      teamId:
                        pick.teamId,

                      nbaTeamAbbreviation:
                        pick.nbaTeamAbbreviation,

                      pickType:
                        pick.pickType,
                    }),
                  ),
              }),
          },
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ??
            "Failed to save NBA Skins draft.",
        );
      }

      setMessage(
        result.message ??
          "Draft saved successfully.",
      );

      await loadDraft();
    } catch (
      saveError
    ) {
      setError(
        saveError instanceof
        Error
          ? saveError.message
          : "Failed to save NBA Skins draft.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }


  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <AppNav />

        <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
                NBA Skins
              </div>

              <h1 className="mt-1 text-3xl font-black tracking-tight text-white">
                Draft Sheet
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Fill out the full draft as picks are made. Each NBA team can
                only be selected once.
              </p>
            </div>

            {data ? (
              <div className="flex gap-2">
                <div className="rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-2 text-right">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Season
                  </div>

                  <div className="font-black text-white">
                    {data.season.label}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-2 text-right">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Status
                  </div>

                  <div className="font-black text-blue-300">
                    {statusLabel(
                      data.season.status,
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>


        {loading ? (
          <section className="rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center text-sm text-slate-400">
            Loading draft sheet…
          </section>
        ) : error && !data ? (
          <section className="rounded-3xl border border-red-500/30 bg-red-950/20 p-5 text-sm text-red-200">
            {error}
          </section>
        ) : data ? (
          <>
            {!data.hasValidDraftOrder ? (
              <section className="rounded-3xl border border-amber-500/30 bg-amber-950/20 p-5">
                <div className="font-black text-amber-200">
                  Draft order not configured
                </div>

                <p className="mt-2 text-sm leading-6 text-amber-100/70">
                  Set all {data.season.participantCount} participants in the NBA Skins admin page
                  before filling out the draft.
                </p>
              </section>
            ) : (
              <>
                <section className="rounded-3xl border border-slate-700 bg-slate-900 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">
                        Draft Order
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {data.draftOrder.map(
                          (team) => (
                            <span
                              key={team.teamId}
                              className="rounded-full border border-blue-500/25 bg-blue-950/30 px-3 py-1.5 text-xs font-bold text-blue-100"
                            >
                              {team.draftPosition}.{" "}
                              {team.teamName}
                            </span>
                          ),
                        )}
                      </div>
                    </div>

                    <div className="text-sm font-bold tabular-nums text-slate-400">
                      {completedCount}/{data.season.totalPicks} filled
                    </div>
                  </div>
                </section>


                {error ? (
                  <div className="rounded-2xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                ) : null}


                {message ? (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">
                    {message}
                  </div>
                ) : null}


                <section className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900">
                  {picks.map(
                    (
                      pick,
                      index,
                    ) => {
                      const isRoundStart =
                        index === 0 ||
                        picks[
                          index - 1
                        ].round !==
                          pick.round;

                      return (
                        <div
                          key={
                            pick.pickNumber
                          }
                        >
                          {isRoundStart ? (
                            <div className="border-b border-slate-700 bg-blue-950/25 px-4 py-2.5 sm:px-5">
                              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-300">
                                Round{" "}
                                {pick.round}
                              </span>
                            </div>
                          ) : null}

                          <div className="grid gap-3 border-b border-slate-800 px-4 py-4 last:border-b-0 sm:grid-cols-[80px_130px_minmax(220px,1fr)_150px] sm:items-center sm:px-5 sm:py-3">
                            <div>
                              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                                Pick
                              </div>

                              <div className="mt-1 text-lg font-black tabular-nums text-blue-300">
                                #
                                {
                                  pick.pickNumber
                                }
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 sm:hidden">
                                Owner
                              </div>

                              <div className="font-black text-white">
                                {
                                  pick.teamName
                                }
                              </div>
                            </div>

                            <label>
                              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                                NBA Team
                              </span>

                              <select
                                value={
                                  pick.nbaTeamAbbreviation
                                }
                                disabled={
                                  !data
                                    .season
                                    .editable
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updatePick(
                                    index,
                                    {
                                      nbaTeamAbbreviation:
                                        event
                                          .target
                                          .value,
                                    },
                                  )
                                }
                                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm font-bold text-white outline-none transition focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <option value="">
                                  Select NBA team…
                                </option>

                                {data.nbaTeams.map(
                                  (
                                    team,
                                  ) => {
                                    const usedElsewhere =
                                      selectedCodes.has(
                                        team.abbreviation,
                                      ) &&
                                      pick.nbaTeamAbbreviation !==
                                        team.abbreviation;

                                    return (
                                      <option
                                        key={
                                          team.abbreviation
                                        }
                                        value={
                                          team.abbreviation
                                        }
                                        disabled={
                                          usedElsewhere
                                        }
                                      >
                                        {
                                          team.abbreviation
                                        }{" "}
                                        —{" "}
                                        {
                                          team.displayName
                                        }
                                        {usedElsewhere
                                          ? " — Drafted"
                                          : ""}
                                      </option>
                                    );
                                  },
                                )}
                              </select>
                            </label>

                            <label>
                              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                                Pick
                              </span>

                              <select
                                value={
                                  pick.pickType
                                }
                                disabled={
                                  !data
                                    .season
                                    .editable
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updatePick(
                                    index,
                                    {
                                      pickType:
                                        event
                                          .target
                                          .value as PickType,
                                    },
                                  )
                                }
                                className={
                                  pick.pickType ===
                                  "wins"
                                    ? "w-full rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2.5 text-sm font-black uppercase text-emerald-300 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                    : "w-full rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-2.5 text-sm font-black uppercase text-rose-300 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                }
                              >
                                <option value="wins">
                                  Wins
                                </option>

                                <option value="losses">
                                  Losses
                                </option>
                              </select>
                            </label>
                          </div>
                        </div>
                      );
                    },
                  )}
                </section>


                <section className="rounded-3xl border border-slate-700 bg-slate-900 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-black text-white">
                        {data.season.editable
                          ? "Ready to save?"
                          : data.season.status ===
                              "open"
                            ? "View only"
                            : `Draft ${statusLabel(
                                data.season.status,
                              ).toLowerCase()}`}
                      </div>

                      <div className="mt-1 text-sm text-slate-500">
                        {data.season.editable
                          ? `Saving replaces the current open-season draft with the ${data.season.totalPicks} selections above.`
                          : data.season.status ===
                              "open"
                            ? "Only an admin can edit and save the draft sheet."
                            : "The draft can no longer be edited unless the season is reopened from Admin."}
                      </div>
                    </div>

                    {data.season.editable ? (
                      <button
                        type="button"
                        onClick={
                          saveDraft
                        }
                        disabled={
                          saving ||
                          completedCount !==
                            data.season.totalPicks
                        }
                        className="rounded-xl border border-blue-400/40 bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {saving
                          ? "Saving…"
                          : `Save Draft (${completedCount}/${data.season.totalPicks})`}
                      </button>
                    ) : null}
                  </div>
                </section>
              </>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
