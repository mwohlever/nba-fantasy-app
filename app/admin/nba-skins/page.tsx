"use client";

import Link from "next/link";

import AppNav from "@/components/AppNav";
import LotteryReveal from "@/components/nba-skins/LotteryReveal";
import { hasCompleteNbaSkinsDraftOrder, validateNbaSkinsDraftOrder } from "@/lib/nbaSkins/policy";
import { nextLotteryPick, shuffleNbaSkinsOrder } from "@/lib/nbaSkins/lottery";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";


type SeasonStatus =
  | "open"
  | "locked"
  | "final";


type Team = {
  id: number;
  name: string;
};


type DraftOrderEntry = {
  teamId: number;
  teamName: string;
  draftPosition: number;
};


type Season = {
  id: number;
  season: number;
  label: string;
  status: SeasonStatus;
  draft_locked_at:
    | string
    | null;
  finalized_at:
    | string
    | null;
  created_at: string;
  draftOrder:
    DraftOrderEntry[];
  pickCount: number;
  canDelete: boolean;
  participantCount: number;
  nbaTeamsPerParticipant: number;
  totalPicks: number;
};


type AdminResponse = {
  success: boolean;
  teams: Team[];
  seasons: Season[];
  rules: {
    participantCount: number;
    nbaTeamsPerParticipant: number;
    totalPicks: number;
  };
  error?: string;
};


type LotteryState = {
  seasonId: number;
  order: number[];
  revealedCount: number;
  run: number;
  persistence: "proposed" | "verifying" | "saved";
};


export default function NbaSkinsAdminPage() {
  const [
    data,
    setData,
  ] =
    useState<
      AdminResponse | null
    >(null);

  const [
    selectedSeasonId,
    setSelectedSeasonId,
  ] =
    useState<
      number | null
    >(null);

  const [
    order,
    setOrder,
  ] =
    useState<
      number[]
    >([]);

  const [
    newSeason,
    setNewSeason,
  ] =
    useState("");

  const [
    newSeasonParticipantIds,
    setNewSeasonParticipantIds,
  ] = useState<number[]>([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    busy,
    setBusy,
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

  const [lottery, setLottery] = useState<LotteryState | null>(null);
  const lotteryRef = useRef<LotteryState | null>(null);
  const lotteryRun = useRef(0);
  // Also guard rapid taps before React commits the next render.
  const updateLottery = useCallback((next: LotteryState | null) => {
    lotteryRef.current = next;
    setLottery(next);
  }, []);


  const selectedSeason =
    useMemo(
      () =>
        data?.seasons.find(
          (season) =>
            season.id ===
            selectedSeasonId,
        ) ??
        null,
      [
        data,
        selectedSeasonId,
      ],
    );

  const savedOrder = [...(selectedSeason?.draftOrder ?? [])]
    .sort((a, b) => a.draftPosition - b.draftPosition);
  const needsInitialization = selectedSeason?.draftOrder.length === 0;
  const hasSavedOrder = Boolean(selectedSeason && hasCompleteNbaSkinsDraftOrder(savedOrder, selectedSeason.participantCount));
  const canEditOrder = Boolean(selectedSeason && selectedSeason.season >= 2026 &&
    selectedSeason.status === "open" && !selectedSeason.draft_locked_at && !selectedSeason.finalized_at &&
    selectedSeason.pickCount === 0 && (needsInitialization || hasSavedOrder));
  const orderOptions = needsInitialization
    ? data?.teams ?? []
    : savedOrder.map((entry) => ({ id: entry.teamId, name: entry.teamName }));
  const orderIsValid = Boolean(selectedSeason && validateNbaSkinsDraftOrder(
    order, (data?.teams ?? []).map((team) => team.id), selectedSeason.participantCount,
  ));
  const orderChanged = needsInitialization || order.some((teamId, index) => teamId !== savedOrder[index]?.teamId);
  const lotteryRoster = hasSavedOrder ? savedOrder.map((entry) => entry.teamId)
    : orderIsValid ? order : (data?.teams ?? []).slice(0, selectedSeason?.participantCount ?? 0).map((team) => team.id);
  const canRandomizeOrder = Boolean(canEditOrder && selectedSeason && validateNbaSkinsDraftOrder(
    lotteryRoster, (data?.teams ?? []).map((team) => team.id), selectedSeason.participantCount,
  ));
  const canClearProposal = Boolean(canEditOrder && (lottery?.persistence === "proposed" ||
    (order.some(Boolean) && (!hasSavedOrder || orderChanged))));
  const existingNewSeason = data?.seasons.find((season) => season.season === Number(newSeason)) ?? null;
  const validNewSeason = newSeason.trim() !== "" && Number.isInteger(Number(newSeason)) &&
    Number(newSeason) >= 2022 && Number(newSeason) <= 2100;

  const selectSeason = useCallback((nextSeason: Season | null, teams: Team[], preserveLottery = false) => {
    setSelectedSeasonId(nextSeason?.id ?? null);
    let nextOrder: number[] = [];
    if (!nextSeason) {
      setOrder([]);
    } else if (hasCompleteNbaSkinsDraftOrder(nextSeason.draftOrder, nextSeason.participantCount)) {
      nextOrder = [...nextSeason.draftOrder].sort((a, b) => a.draftPosition - b.draftPosition).map((entry) => entry.teamId);
      setOrder(nextOrder);
    } else if (nextSeason.draftOrder.length === 0) {
      setOrder(teams.slice(0, nextSeason.participantCount).map((team) => team.id));
    } else {
      setOrder([]);
    }
    const current = lotteryRef.current;
    if (preserveLottery && current && nextSeason && current.seasonId === nextSeason.id) {
      if (nextOrder.length === current.order.length && nextOrder.every((id, index) => id === current.order[index])) {
        updateLottery({ ...current, persistence: "saved" });
      } else {
        setError("The saved order did not match this reveal. Keep this screen and verify before retrying.");
      }
    } else {
      updateLottery(null);
    }
  }, [updateLottery]);


  const loadAdmin = useCallback((preferredSeasonId?: number, preserveLottery = false) => {
    return fetch("/api/admin/nba-skins", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as AdminResponse;
        if (!response.ok) throw new Error(result.error ?? "Failed to load NBA Skins admin.");
        return result;
      })
      .then((result) => {
        // A late mount response must not dismiss an in-progress recording.
        if (lotteryRef.current && !preserveLottery) return;
        setData(result);
        setNewSeasonParticipantIds((current) => {
          const validCurrent = current.filter((teamId) => result.teams.some((team) => team.id === teamId));
          return validCurrent.length === result.rules.participantCount
            ? validCurrent
            : result.teams.slice(0, result.rules.participantCount).map((team) => team.id);
        });
        const nextSeason = result.seasons.find((season) => season.id === preferredSeasonId) ?? result.seasons[0] ?? null;
        selectSeason(nextSeason, result.teams, preserveLottery);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to load NBA Skins admin.");
      })
      .finally(() => setLoading(false));
  }, [selectSeason]);

  useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);


  function teamName(
    teamId: number,
  ) {
    return (
      data?.teams.find(
        (team) =>
          team.id ===
          teamId,
      )?.name ?? selectedSeason?.draftOrder.find((entry) => entry.teamId === teamId)?.teamName ??
      "Unknown"
    );
  }


  function setPosition(
    index: number,
    teamId: number,
  ) {
    if (busy || !canEditOrder || lotteryRef.current) return;
    setOrder(
      (current) => {
        const copy =
          [...current];

        const existingIndex =
          copy.indexOf(
            teamId,
          );

        if (
          existingIndex >= 0
        ) {
          [
            copy[index],
            copy[
              existingIndex
            ],
          ] = [
            copy[
              existingIndex
            ],
            copy[index],
          ];
        } else {
          copy[index] =
            teamId;
        }

        return copy;
      },
    );

    setMessage("");
  }

  function randomizeOrder(restart = false) {
    if (busy || !selectedSeason || !canRandomizeOrder) return;
    if (lotteryRef.current) {
      if (!restart || !window.confirm("Restart the lottery? This discards the current reveal. Any saved order stays unchanged.")) return;
    }
    try {
      const proposed = shuffleNbaSkinsOrder(lotteryRoster);
      setOrder(proposed);
      setMessage("");
      setError("");
      updateLottery({ seasonId: selectedSeason.id, order: proposed, revealedCount: 0, run: ++lotteryRun.current, persistence: "proposed" });
    } catch (randomError) {
      setError(randomError instanceof Error ? randomError.message : "Unable to randomize the draft order.");
    }
  }

  function revealPick(pick: number) {
    const current = lotteryRef.current;
    if (busy || !canEditOrder || !current || pick !== nextLotteryPick(current.order.length, current.revealedCount)) return;
    updateLottery({ ...current, revealedCount: current.revealedCount + 1 });
  }

  function clearOrder() {
    if (busy || !canEditOrder || !selectedSeason || !canClearProposal) return;
    if (lotteryRef.current && lotteryRef.current.persistence !== "proposed") return;
    setOrder(Array<number>(selectedSeason.participantCount).fill(0));
    updateLottery(null);
    setMessage("");
    setError("");
  }

  function exitLottery() {
    const current = lotteryRef.current;
    if (busy || !current) return;
    if (current.revealedCount < current.order.length) {
      if (!window.confirm("Exit the reveal and discard its hidden order? Any saved order stays unchanged.")) return;
      setOrder(hasSavedOrder ? savedOrder.map((entry) => entry.teamId) : Array<number>(current.order.length).fill(0));
    }
    updateLottery(null);
    setMessage("");
    setError("");
  }


  async function saveOrder() {
    if (
      busy || !selectedSeason || !canEditOrder || !orderIsValid
    ) {
      return;
    }
    const currentLottery = lotteryRef.current;
    if (currentLottery && (currentLottery.seasonId !== selectedSeason.id ||
      currentLottery.revealedCount !== currentLottery.order.length || currentLottery.persistence !== "proposed")) return;
    const submittedOrder = currentLottery?.order ?? order;

    try {
      setBusy(true);
      setError("");
      setMessage("");

      const response =
        await fetch(
          "/api/admin/nba-skins",
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                seasonId:
                  selectedSeason.id,
                season: selectedSeason.season,
                initializeParticipants: needsInitialization,

                action:
                  "save-order",

                order:
                  submittedOrder.map(
                    (
                      teamId,
                      index,
                    ) => ({
                      teamId,
                      draftPosition:
                        index + 1,
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
            "Failed to save draft order.",
        );
      }

      setMessage(
        result.message,
      );

      if (currentLottery) updateLottery({ ...currentLottery, persistence: "verifying" });

      await loadAdmin(
        selectedSeason.id,
        Boolean(currentLottery),
      );
    } catch (
      saveError
    ) {
      setError(
        `${selectedSeason.label}: ${saveError instanceof
        Error
          ? saveError.message
          : "Failed to save draft order."}`,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }


  async function setStatus(
    status:
      | "open"
      | "locked",
  ) {
    if (
      !selectedSeason
    ) {
      return;
    }

    const verb =
      status ===
      "locked"
        ? "lock"
        : "reopen";

    if (
      !window.confirm(
        `Are you sure you want to ${verb} the ${selectedSeason.label} NBA Skins draft?`,
      )
    ) {
      return;
    }

    try {
      setBusy(true);
      setError("");
      setMessage("");

      const response =
        await fetch(
          "/api/admin/nba-skins",
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                seasonId:
                  selectedSeason.id,

                action:
                  "set-status",

                status,
              }),
          },
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ??
            "Failed to update draft status.",
        );
      }

      setMessage(
        result.message,
      );

      await loadAdmin(
        selectedSeason.id,
      );
    } catch (
      statusError
    ) {
      setError(
        statusError instanceof
        Error
          ? statusError.message
          : "Failed to update draft status.",
      );
    } finally {
      setBusy(
        false,
      );
    }
  }


  async function createSeason() {
    const season =
      Number(
        newSeason,
      );

    if (
      !validNewSeason
    ) {
      setError(
        "Enter a valid starting year.",
      );

      return;
    }

    if (existingNewSeason) {
      selectSeason(existingNewSeason, data?.teams ?? []);
      setError("");
      setMessage(`${existingNewSeason.label} already exists. Configure its draft order above.`);
      return;
    }

    if (
      !data ||
      newSeasonParticipantIds.length !== data.rules.participantCount
    ) {
      setError(
        `Select exactly ${data?.rules.participantCount ?? 0} participants for the new season.`,
      );
      return;
    }

    try {
      setBusy(true);
      setError("");
      setMessage("");

      const response =
        await fetch(
          "/api/admin/nba-skins",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                season,
                participantTeamIds:
                  newSeasonParticipantIds,
              }),
          },
        );

      const result =
        await response.json();

      if (response.status === 409 && result.season?.id) {
        await loadAdmin(Number(result.season.id));
        setMessage(`${result.season.season}-${String(Number(result.season.season) + 1).slice(-2)} already exists. Configure its draft order above.`);
        return;
      }

      if (!response.ok) {
        throw new Error(
          result.error ??
            "Failed to create season.",
        );
      }

      setMessage(
        result.message,
      );

      await loadAdmin(
        Number(
          result.season.id,
        ),
      );
    } catch (
      createError
    ) {
      setError(
        createError instanceof
        Error
          ? createError.message
          : `Failed to create ${season}-${String(season + 1).slice(-2)} season.`,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }


  async function deleteSeason() {
    if (
      !selectedSeason ||
      !selectedSeason.canDelete
    ) {
      return;
    }

    const firstConfirm =
      window.confirm(
        `Delete ${selectedSeason.label}? This will also delete its draft order, picks, and saved NBA records.`,
      );

    if (!firstConfirm) {
      return;
    }

    const typed =
      window.prompt(
        `Type DELETE to permanently remove ${selectedSeason.label}.`,
      );

    if (
      typed !==
      "DELETE"
    ) {
      return;
    }

    try {
      setBusy(true);
      setError("");
      setMessage("");

      const response =
        await fetch(
          "/api/admin/nba-skins",
          {
            method:
              "DELETE",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                seasonId:
                  selectedSeason.id,
              }),
          },
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ??
            "Failed to delete season.",
        );
      }

      setMessage(
        result.message,
      );

      await loadAdmin();
    } catch (
      deleteError
    ) {
      setError(
        deleteError instanceof
        Error
          ? deleteError.message
          : "Failed to delete season.",
      );
    } finally {
      setBusy(
        false,
      );
    }
  }


  if (lottery && selectedSeason && lottery.seasonId === selectedSeason.id) {
    return <LotteryReveal
      seasonLabel={selectedSeason.label} rounds={selectedSeason.nbaTeamsPerParticipant}
      slots={[...lottery.order].reverse().map((teamId, index) => ({
        pick: lottery.order.length - index,
        name: index < lottery.revealedCount ? teamName(teamId) : null,
      }))}
      nextPick={nextLotteryPick(lottery.order.length, lottery.revealedCount)} run={lottery.run}
      busy={busy} canEdit={canEditOrder} persistence={lottery.persistence} error={error}
      saveLabel={needsInitialization ? `Initialize ${selectedSeason.label} Draft Order` : `Save ${selectedSeason.label} Draft Order`}
      onShow={revealPick} onRestart={() => randomizeOrder(true)} onClear={clearOrder} onExit={exitLottery} onSave={saveOrder}
      onVerify={async () => {
        if (busy) return;
        setBusy(true); setError("");
        await loadAdmin(selectedSeason.id, true);
        setBusy(false);
      }}
    />;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <AppNav />

        <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-6">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
            Commissioner
          </div>

          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">
            NBA Skins Control
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            Set the annual draft order, open or lock the draft sheet,
            and create or remove test seasons.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/nba-skins/draft"
              className="rounded-xl border border-blue-500/40 bg-blue-950/50 px-4 py-2.5 text-sm font-bold text-blue-100 transition hover:border-blue-400"
            >
              View Draft Sheet
            </Link>

            <Link
              href="/nba-skins"
              className="rounded-xl border border-slate-600 bg-slate-950/40 px-4 py-2.5 text-sm font-bold text-slate-200 transition hover:border-slate-500"
            >
              View NBA Skins
            </Link>
          </div>
        </section>


        {loading ? (
          <section className="rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center text-sm text-slate-400">
            Loading NBA Skins admin…
          </section>
        ) : error && !data ? (
          <section className="rounded-3xl border border-red-500/30 bg-red-950/20 p-5 text-sm text-red-200">
            {error}
          </section>
        ) : data ? (
          <>
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


            <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <label>
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-blue-300">
                    Season
                  </span>

                  <select
                    aria-label="Selected NBA Skins season"
                    disabled={busy}
                    value={
                      selectedSeasonId ??
                      ""
                    }
                    onChange={(
                      event,
                    ) =>
                      selectSeason(data.seasons.find((season) => season.id === Number(event.target.value)) ?? null, data.teams)
                    }
                    className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-3 font-bold text-white outline-none focus:border-blue-400"
                  >
                    {data.seasons.map(
                      (season) => (
                        <option
                          key={season.id}
                          value={season.id}
                        >
                          {season.label} —{" "}
                          {season.status}
                        </option>
                      ),
                    )}
                  </select>
                </label>

                {selectedSeason ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-right">
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Draft
                    </div>

                    <div className="font-black text-white">
                      {
                        selectedSeason.pickCount
                      }
                      /{selectedSeason.totalPicks} picks
                    </div>
                  </div>
                ) : null}
              </div>
            </section>


            {selectedSeason ? (
              <>
                <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">
                        Draft Order
                      </div>

                      <h2 className="mt-1 text-xl font-black text-white">
                        {selectedSeason.label}
                      </h2>

                      <p className="mt-1 text-sm text-slate-500">
                        This order drives Pick #1 and the {selectedSeason.nbaTeamsPerParticipant}-round snake.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy || !canRandomizeOrder} onClick={() => randomizeOrder()}
                        className="min-h-12 rounded-xl border border-blue-500/40 bg-blue-950/40 px-4 py-2.5 text-sm font-black text-blue-100 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40">
                        🎲 Randomize Order
                      </button>
                      <button type="button" onClick={clearOrder} disabled={busy || !canClearProposal}
                        className="min-h-12 rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-bold text-slate-200 disabled:cursor-not-allowed disabled:opacity-40">
                        Clear Draft Order
                      </button>
                    </div>
                  </div>
                  {hasSavedOrder ? <p className="mt-3 text-xs text-slate-400">Clear only discards an unsaved proposal. The saved order cannot be deleted here because season participants are frozen.</p> : null}


                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {Array.from(
                      { length: selectedSeason.participantCount },
                      (_, index) => index,
                    ).map(
                      (index) => (
                        <label
                          key={index}
                          className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4"
                        >
                          <span className="text-[10px] font-black uppercase tracking-wider text-blue-300">
                            Pick{" "}
                            {index + 1}
                          </span>

                          <select
                            value={
                              order[
                                index
                              ] ||
                              ""
                            }
                            disabled={
                              busy || !canEditOrder
                            }
                            onChange={(
                              event,
                            ) =>
                              setPosition(
                                index,
                                Number(
                                  event
                                    .target
                                    .value,
                                ),
                              )
                            }
                            className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 font-black text-white outline-none focus:border-blue-400 disabled:opacity-50"
                          >
                            <option value="" disabled>Select participant</option>
                            {orderOptions.map(
                              (team) => (
                                <option
                                  key={
                                    team.id
                                  }
                                  value={
                                    team.id
                                  }
                                >
                                  {
                                    team.name
                                  }
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      ),
                    )}
                  </div>


                  <div className="mt-4 rounded-2xl border border-blue-500/15 bg-blue-950/15 px-4 py-3 text-sm text-slate-400">
                    <p>Saved order: <span className="font-bold text-blue-200">
                      {hasSavedOrder
                        ? savedOrder.map((entry, index) => `${index + 1}. ${entry.teamName}`).join("  •  ")
                        : needsInitialization ? "Not initialized." : "Incomplete or inconsistent; review required."}
                    </span></p>
                    {canEditOrder && orderChanged ? (
                      <p className="mt-2">Proposed order (not saved): <span className="font-bold text-blue-200">
                        {order.some(Boolean) ? order.map((teamId, index) => `${index + 1}. ${teamId ? teamName(teamId) : "Not selected"}`).join("  •  ") : "Select participants above."}
                      </span></p>
                    ) : null}
                    {selectedSeason.pickCount > 0 ? <p className="mt-2">Draft order is read-only because picks have been saved.</p> : null}
                  </div>


                  <button
                    type="button"
                    onClick={
                      saveOrder
                    }
                    disabled={
                      busy || !canEditOrder || !orderIsValid
                    }
                    className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {needsInitialization ? `Initialize ${selectedSeason.label} Draft Order` : `Save ${selectedSeason.label} Draft Order`}
                  </button>
                </section>


                <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">
                    Draft Status
                  </div>

                  <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-2xl font-black capitalize text-white">
                        {
                          selectedSeason.status
                        }
                      </div>

                      <p className="mt-1 text-sm text-slate-500">
                        {selectedSeason.status ===
                        "open"
                          ? "The draft sheet is editable."
                          : selectedSeason.status ===
                              "locked"
                            ? "The saved draft is read-only."
                            : "This season is finalized."}
                      </p>
                    </div>

                    {selectedSeason.status ===
                    "open" ? (
                      <button
                        type="button"
                        disabled={
                          busy
                        }
                        onClick={() =>
                          setStatus(
                            "locked",
                          )
                        }
                        className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-5 py-3 text-sm font-black text-amber-200 transition hover:border-amber-400 disabled:opacity-40"
                      >
                        🔒 Lock Draft
                      </button>
                    ) : selectedSeason.status ===
                      "locked" ? (
                      <button
                        type="button"
                        disabled={
                          busy
                        }
                        onClick={() =>
                          setStatus(
                            "open",
                          )
                        }
                        className="rounded-xl border border-blue-500/40 bg-blue-950/40 px-5 py-3 text-sm font-black text-blue-100 transition hover:border-blue-400 disabled:opacity-40"
                      >
                        🔓 Reopen Draft
                      </button>
                    ) : null}
                  </div>

                  {selectedSeason.status ===
                  "open" ? (
                    <div className="mt-4 text-xs text-slate-500">
                      Locking requires a saved {selectedSeason.participantCount}-participant draft order and all {selectedSeason.totalPicks} picks.
                    </div>
                  ) : null}
                </section>


                {selectedSeason.canDelete ? (
                  <section className="rounded-3xl border border-red-500/25 bg-red-950/10 p-5">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-red-300">
                      Test / Season Cleanup
                    </div>

                    <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-black text-white">
                          Delete {selectedSeason.label}
                        </div>

                        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                          Removes this season and its draft order, picks,
                          and saved team records. Historical seasons and
                          finalized seasons are protected.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={
                          deleteSeason
                        }
                        disabled={
                          busy
                        }
                        className="rounded-xl border border-red-500/40 bg-red-950/30 px-5 py-3 text-sm font-black text-red-200 transition hover:border-red-400 disabled:opacity-40"
                      >
                        Delete Season
                      </button>
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}


            <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">
                Add Season
              </div>

              <h2 className="mt-1 text-xl font-black text-white">
                New NBA Skins Year
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Enter the starting year and choose exactly {data.rules.participantCount} participants. The season will freeze a {data.rules.participantCount} × {data.rules.nbaTeamsPerParticipant} format.
              </p>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {data.teams.map((team) => {
                  const selected = newSeasonParticipantIds.includes(team.id);
                  return (
                    <label
                      key={team.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-bold ${
                        selected
                          ? "border-blue-400/60 bg-blue-950/40 text-blue-100"
                          : "border-slate-700 bg-slate-950/40 text-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!selected && newSeasonParticipantIds.length >= data.rules.participantCount}
                        onChange={() => setNewSeasonParticipantIds((current) =>
                          current.includes(team.id)
                            ? current.filter((teamId) => teamId !== team.id)
                            : [...current, team.id]
                        )}
                      />
                      {team.name}
                    </label>
                  );
                })}
              </div>

              {data.teams.length < data.rules.participantCount ? (
                <p className="mt-3 text-xs font-semibold text-amber-300">
                  {data.rules.participantCount} participants are required, but only {data.teams.length} active Group {data.teams.length === 1 ? "member is" : "members are"} available.
                </p>
              ) : null}

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  type="number"
                  aria-label="Season starting year"
                  placeholder="Enter starting year"
                  disabled={busy}
                  min="2022"
                  max="2100"
                  value={
                    newSeason
                  }
                  onChange={(
                    event,
                  ) =>
                    setNewSeason(
                      event.target
                        .value,
                    )
                  }
                  className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 font-bold text-white outline-none focus:border-blue-400"
                />

                <button
                  type="button"
                  disabled={
                    busy || !validNewSeason ||
                    (!existingNewSeason && newSeasonParticipantIds.length !== data.rules.participantCount)
                  }
                  onClick={
                    createSeason
                  }
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-500 disabled:opacity-40"
                >
                  {existingNewSeason ? `Open ${existingNewSeason.label} Season` : validNewSeason
                    ? `Create ${Number(newSeason)}-${String(Number(newSeason) + 1).slice(-2)} Season` : "Create Season"}
                </button>
              </div>
              {existingNewSeason ? (
                <p className="mt-3 text-sm text-blue-200">
                  {existingNewSeason.label} already exists. Open it above to configure its draft order.
                </p>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
