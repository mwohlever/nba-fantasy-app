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
    <main className="min-h-screen bg-[var(--background)] px-3 py-3 pb-24 text-[var(--app-text)] sm:px-4 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-3">
        <AppNav />

        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-lg font-bold">NBA Skins Draft Sheet</h1>
          {data ? (
            <p className="text-xs text-[var(--app-text-muted)]">{data.season.label} · {statusLabel(data.season.status)}</p>
          ) : null}
          <p className="w-full text-xs leading-5 text-[var(--app-text-muted)]">
            Fill out the full draft as picks are made. Each NBA team can only be selected once.
          </p>
        </header>

        {loading ? (
          <p className="py-4 text-sm text-[var(--app-text-muted)]">Loading draft sheet…</p>
        ) : error && !data ? (
          <p role="alert" className="py-3 text-sm text-red-600 dark:text-red-300">{error}</p>
        ) : data ? (
          <>
            {!data.hasValidDraftOrder ? (
              <div className="border-l-2 border-amber-500 pl-3 text-sm">
                <p className="font-semibold">Draft order not configured</p>
                <p className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                  Set all {data.season.participantCount} participants in the NBA Skins admin page before filling out the draft.
                </p>
              </div>
            ) : (
              <>
                <section className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--app-border)] pb-2 text-xs" aria-label="Draft order">
                  <h2 className="font-semibold">Draft Order</h2>
                  <ol className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1">
                    {data.draftOrder.map((team) => (
                      <li key={team.teamId} className="break-words text-[var(--app-text-muted)]">{team.draftPosition}. {team.teamName}</li>
                    ))}
                  </ol>
                  <span className="whitespace-nowrap font-semibold tabular-nums">{completedCount}/{data.season.totalPicks} filled</span>
                </section>

                {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p> : null}
                {message ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}

                <section aria-label="Draft selections">
                  <div aria-hidden="true" className="hidden grid-cols-[12rem_minmax(0,1fr)_7rem] gap-3 px-1 pb-1 text-xs text-[var(--app-text-muted)] lg:grid">
                    <span>Pick / Participant</span><span>NBA Team</span><span>Selection</span>
                  </div>
                  {picks.map((pick, index) => {
                    const isRoundStart = index === 0 || picks[index - 1].round !== pick.round;
                    return (
                      <div key={pick.pickNumber}>
                        {isRoundStart ? (
                          <h2 className="border-y border-[var(--app-border)] bg-[var(--app-surface-soft)] px-1 py-1.5 text-xs font-semibold">
                            Round {pick.round}
                          </h2>
                        ) : null}
                        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-x-3 gap-y-1.5 border-b border-[var(--app-border)] px-1 py-2 lg:grid-cols-[12rem_minmax(0,1fr)_7rem]">
                          <div className="col-span-2 flex min-w-0 items-baseline gap-2 lg:col-span-1">
                            <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--app-blue)]">#{pick.pickNumber}</span>
                            <strong className="truncate text-sm" title={pick.teamName}>{pick.teamName}</strong>
                          </div>
                          <label className="min-w-0">
                            <span className="mb-1 block text-[10px] text-[var(--app-text-muted)] lg:sr-only">NBA Team</span>
                            <select
                              value={pick.nbaTeamAbbreviation}
                              aria-label={`NBA team for pick ${pick.pickNumber}, ${pick.teamName}`}
                              disabled={!data.season.editable}
                              onChange={(event) => updatePick(index, { nbaTeamAbbreviation: event.target.value })}
                              className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2 text-base text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-[var(--app-blue)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                            >
                              <option value="">Select NBA team…</option>
                              {data.nbaTeams.map((team) => {
                                const usedElsewhere = selectedCodes.has(team.abbreviation) && pick.nbaTeamAbbreviation !== team.abbreviation;
                                return (
                                  <option key={team.abbreviation} value={team.abbreviation} disabled={usedElsewhere}>
                                    {team.abbreviation} — {team.displayName}{usedElsewhere ? " — Drafted" : ""}
                                  </option>
                                );
                              })}
                            </select>
                          </label>
                          <label className="min-w-0">
                            <span className="mb-1 block text-[10px] text-[var(--app-text-muted)] lg:sr-only">Selection</span>
                            <select
                              value={pick.pickType}
                              aria-label={`Wins or Losses for pick ${pick.pickNumber}, ${pick.teamName}`}
                              disabled={!data.season.editable}
                              onChange={(event) => updatePick(index, { pickType: event.target.value as PickType })}
                              className={`min-h-11 w-full min-w-0 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2 text-base font-semibold focus-visible:outline-2 focus-visible:outline-[var(--app-blue)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm ${pick.pickType === "wins" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}
                            >
                              <option value="wins">Wins</option>
                              <option value="losses">Losses</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </section>

                <footer className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {data.season.editable ? "Ready to save?" : data.season.status === "open" ? "View only" : `Draft ${statusLabel(data.season.status).toLowerCase()}`}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--app-text-muted)]">
                      {data.season.editable
                        ? `Saving replaces the current open-season draft with the ${data.season.totalPicks} selections above.`
                        : data.season.status === "open"
                          ? "Only an admin can edit and save the draft sheet."
                          : "The draft can no longer be edited unless the season is reopened from Admin."}
                    </p>
                  </div>
                  {data.season.editable ? (
                    <button type="button" onClick={saveDraft} disabled={saving || completedCount !== data.season.totalPicks}
                      className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-blue)] disabled:cursor-not-allowed disabled:opacity-40">
                      {saving ? "Saving…" : `Save Draft (${completedCount}/${data.season.totalPicks})`}
                    </button>
                  ) : null}
                </footer>
              </>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
