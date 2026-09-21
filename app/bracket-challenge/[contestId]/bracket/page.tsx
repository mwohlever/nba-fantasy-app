"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import AppNav from "@/components/AppNav";
import BracketMakePicks from "@/components/bracket/BracketMakePicks";
import BracketTopologyPreview from "@/components/bracket/BracketTopologyPreview";
import { canEditBracketGame } from "@/lib/bracket/lifecycle";

type Game = {
  id: number;
  gameKey: string;
  roundKey: string;
  roundOrder: number;
  gameOrder: number;
  sourceATeamId: string | null;
  sourceAGameId: number | null;
  sourceASeed: number | null;
  sourceBTeamId: string | null;
  sourceBGameId: number | null;
  sourceBSeed: number | null;
  lockAt: string | null;
  status: string;
};

type ChallengeResponse = {
  success?: boolean;
  error?: string;
  group?: {
    id: string;
    name: string;
    slug: string;
  };
  contest?: {
    id: string;
    status: string;
    lockAt: string | null;
    maxBracketsPerEntrant: number;
    managedEntrantsAllowed: boolean;
    rulesVersion: number;
    rulesSnapshot: Record<
      string,
      unknown
    >;
  };
  competition?: {
    id: number;
    sportKey: string;
    formatKey: string;
    season: number;
    name: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    topologyVersion: number;
  };
  games?: Game[];
  teams?: {
    seed: number;
    providerTeamId: string;
    displayName: string;
    abbreviation: string | null;
    logoUrl: string | null;
  }[];
};

function statusLabel(
  status: string,
) {
  if (status === "open")
    return "Open";
  if (status === "locked")
    return "Locked";
  if (status === "in_progress")
    return "Live";
  if (status === "final")
    return "Final";
  return "Setup";
}

export default function BracketChallengeDetailPage() {
  const params = useParams<{
    contestId: string;
  }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const contestId =
    params.contestId;

  const entrantIdFromUrl =
    searchParams.get("entrantId") ?? "";
  const entryIdFromUrl = searchParams.get("entryId") ?? "";
  const bracketNumberFromUrl = (() => {
    const value = Number(
      searchParams.get("bracket") ?? "1",
    );
    return Number.isInteger(value) && value > 0
      ? value
      : 1;
  })();

  const [data, setData] =
    useState<ChallengeResponse | null>(
      null,
    );
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState("");
  const [picks, setPicks] =
    useState<Record<string, string | null | undefined>>({});
  const [masterBracketId, setMasterBracketId] =
    useState<string | null>(null);
  const [entrants, setEntrants] = useState<{ id: string; kind: "account" | "managed"; displayName: string }[]>([]);
  const [selectedEntrantId, setSelectedEntrantId] =
    useState(entrantIdFromUrl);
  const [bracketNumber, setBracketNumber] =
    useState(bracketNumberFromUrl);
  const [savingGameKey, setSavingGameKey] =
    useState<string | null>(null);
  const [saveError, setSaveError] =
    useState("");
  const [view, setView] =
    useState<"picks" | "bracket">(
      "picks",
    );
  const [tiebreakerValue, setTiebreakerValue] =
    useState("");
  const [savingTiebreaker, setSavingTiebreaker] =
    useState(false);

  useEffect(() => {
    if (
      entrantIdFromUrl &&
      entrantIdFromUrl !== selectedEntrantId
    ) {
      setSelectedEntrantId(entrantIdFromUrl);
    }

    if (bracketNumberFromUrl !== bracketNumber) {
      setBracketNumber(bracketNumberFromUrl);
    }
  }, [
    entrantIdFromUrl,
    bracketNumberFromUrl,
    selectedEntrantId,
    bracketNumber,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const [
          response,
          masterResponse,
        ] = await Promise.all([
          fetch(
            `/api/bracket-challenge/contests/${encodeURIComponent(
              contestId,
            )}`,
            {
              cache: "no-store",
            },
          ),
          fetch(
            `/api/bracket-challenge/contests/${encodeURIComponent(
              contestId,
            )}/master-bracket?${new URLSearchParams({ ...(entryIdFromUrl ? { entryId: entryIdFromUrl } : {}), ...(selectedEntrantId ? { entrantId: selectedEntrantId } : {}), bracketNumber: String(bracketNumber) })}`,
            {
              cache: "no-store",
            },
          ),
        ]);

        const result =
          (await response.json()) as ChallengeResponse;

        const masterResult =
          (await masterResponse.json()) as {
            success?: boolean;
            error?: string;
            masterBracket?: {
              id: string;
              tiebreakerValue: number | null;
              picks: Record<
                string,
                string | null | undefined
              >;
              readOnly?: boolean;
            };
            entrants?: { id: string; kind: "account" | "managed"; displayName: string }[];
            selectedEntrantId?: string;
          };

        if (!response.ok) {
          throw new Error(
            result.error ??
              "Unable to load challenge.",
          );
        }

        if (!masterResponse.ok) {
          throw new Error(
            masterResult.error ??
              "Unable to load your bracket.",
          );
        }

        if (!cancelled) {
          setData(result);
          setPicks(
            masterResult.masterBracket
              ?.picks ?? {},
          );
          setMasterBracketId(
            masterResult.masterBracket
              ?.id ?? null,
          );
          setEntrants(masterResult.entrants ?? []);
          setSelectedEntrantId(masterResult.selectedEntrantId ?? selectedEntrantId);
          setTiebreakerValue(
            masterResult.masterBracket
              ?.tiebreakerValue != null
              ? String(
                  masterResult.masterBracket
                    .tiebreakerValue,
                )
              : "",
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Unable to load challenge.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (contestId) {
      void load();
    }

    return () => {
      cancelled = true;
    };
  }, [contestId, selectedEntrantId, bracketNumber, entryIdFromUrl]);

  function selectBracket(
    entrantId: string,
    nextBracketNumber: number,
  ) {
    setSelectedEntrantId(entrantId);
    setBracketNumber(nextBracketNumber);

    const nextParams = new URLSearchParams(
      searchParams.toString(),
    );

    if (entrantId) {
      nextParams.set("entrantId", entrantId);
    } else {
      nextParams.delete("entrantId");
    }

    if (nextBracketNumber > 1) {
      nextParams.set(
        "bracket",
        String(nextBracketNumber),
      );
    } else {
      nextParams.delete("bracket");
    }

    const query = nextParams.toString();
    router.replace(
      query
        ? `/bracket-challenge/${encodeURIComponent(
            contestId,
          )}/bracket?${query}`
        : `/bracket-challenge/${encodeURIComponent(
            contestId,
          )}/bracket`,
      { scroll: false },
    );
  }

  async function handlePick(
    gameKey: string,
    teamId: string,
  ) {
    if (!contestId) {
      return;
    }

    // Update the selected matchup immediately so bracket picking
    // feels instant while the save happens in the background.
    setPicks((current) => ({
      ...current,
      [gameKey]: teamId,
    }));
    setSavingGameKey(gameKey);
    setSaveError("");

    try {
      const response =
        await fetch(
          `/api/bracket-challenge/contests/${encodeURIComponent(
            contestId,
          )}/master-bracket`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              gameKey,
              teamId,
              entrantId: selectedEntrantId,
              bracketNumber,
            }),
          },
        );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
          masterBracketId?: string;
          picks?: Record<
            string,
            string | null | undefined
          >;
        };

      if (!response.ok) {
        throw new Error(
          result.error ??
            "Unable to save pick.",
        );
      }

      // The server remains authoritative for dependency invalidation.
      // Merge its state so one overlapping save response does not
      // blindly replace unrelated newer local selections.
      if (result.picks) {
        setPicks((current) => {
          const next = { ...current };

          for (const [
            savedGameKey,
            savedTeamId,
          ] of Object.entries(
            result.picks!,
          )) {
            next[savedGameKey] =
              savedTeamId;
          }

          return next;
        });
      }

      setMasterBracketId(
        result.masterBracketId ??
          masterBracketId,
      );
    } catch (pickError) {
      setSaveError(
        pickError instanceof Error
          ? pickError.message
          : "Unable to save pick.",
      );

      // A failed optimistic save needs authoritative state again.
      try {
        const reloadResponse =
          await fetch(
            `/api/bracket-challenge/contests/${encodeURIComponent(
              contestId,
            )}/master-bracket`,
            {
              cache: "no-store",
            },
          );

        if (reloadResponse.ok) {
          const reloadResult =
            (await reloadResponse.json()) as {
              masterBracket?: {
                id: string;
                picks: Record<
                  string,
                  string | null | undefined
                >;
              };
            };

          if (
            reloadResult.masterBracket
          ) {
            setPicks(
              reloadResult.masterBracket
                .picks ?? {},
            );
            setMasterBracketId(
              reloadResult.masterBracket.id,
            );
          }
        }
      } catch {
        // Preserve the original save error.
      }
    } finally {
      setSavingGameKey((current) =>
        current === gameKey
          ? null
          : current,
      );
    }
  }

  async function handleTiebreakerSave() {
    const parsed =
      Number(tiebreakerValue);

    if (
      !Number.isInteger(parsed) ||
      parsed < 0 ||
      parsed > 999
    ) {
      setSaveError(
        "Championship total must be a whole number from 0 to 999.",
      );
      return;
    }

    try {
      setSavingTiebreaker(true);
      setSaveError("");

      const response = await fetch(
        `/api/bracket-challenge/contests/${encodeURIComponent(
          contestId,
        )}/master-bracket`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            tiebreakerValue: parsed,
            entrantId: selectedEntrantId,
            bracketNumber,
          }),
        },
      );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
          tiebreakerValue?: number;
        };

      if (!response.ok) {
        throw new Error(
          result.error ??
            "Unable to save championship total.",
        );
      }

      setTiebreakerValue(
        String(
          result.tiebreakerValue ??
            parsed,
        ),
      );
    } catch (saveTiebreakerError) {
      setSaveError(
        saveTiebreakerError instanceof
          Error
          ? saveTiebreakerError.message
          : "Unable to save championship total.",
      );
    } finally {
      setSavingTiebreaker(false);
    }
  }

  async function handleAddManagedEntrant() {
    const displayName = window.prompt("Managed entrant name");
    if (!displayName?.trim()) return;
    const response = await fetch(`/api/bracket-challenge/contests/${encodeURIComponent(contestId)}/master-bracket`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createManagedEntrant", displayName }),
    });
    const result = await response.json() as { error?: string; entrant?: { id: string; kind: "account" | "managed"; displayName: string } };
    if (!response.ok || !result.entrant) { setSaveError(result.error ?? "Unable to add entrant."); return; }
    setEntrants((current) => [...current, result.entrant!]);
    selectBracket(result.entrant.id, 1);
  }

  const competition =
    data?.competition;
  const contest = data?.contest;
  const games = data?.games ?? [];
  const teams = data?.teams ?? [];
  const contestLocked = Boolean(
    contest &&
      (["locked", "in_progress", "final"].includes(contest.status) ||
        (contest.lockAt && new Date(contest.lockAt).getTime() <= Date.now())),
  );
  const viewingFrozenEntry = Boolean(entryIdFromUrl);
  const editableGameKeys = new Set(viewingFrozenEntry ? [] : games.filter((game) => contest && canEditBracketGame({ contest: { contestStatus: contest.status, contestLockAt: contest.lockAt }, gameLockAt: game.lockAt, gameStatus: game.status })).map((game) => game.gameKey));
  const completedPicks =
    games.filter((game) =>
      Boolean(picks[game.gameKey]),
    ).length;
  const championshipGame =
    games.find(
      (game) =>
        game.roundKey ===
        "championship",
    );
  const championTeamId =
    championshipGame
      ? picks[
          championshipGame.gameKey
        ]
      : null;
  const championTeam =
    championTeamId
      ? teams.find(
          (team) =>
            team.providerTeamId ===
            championTeamId,
        )
      : null;

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <Link
          href="/bracket-challenge"
          className="inline-flex text-sm font-bold text-blue-300 transition hover:text-blue-200"
        >
          ← Bracket Challenge
        </Link>

        {loading ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
            Loading challenge…
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 text-sm text-red-200">
            {error}
          </section>
        ) : competition &&
          contest ? (
          <>
            <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
                    {competition.season} ·
                    College Football
                  </div>

                  <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
                    {competition.name}
                  </h1>

                  <p className="mt-2 text-sm text-slate-300">
                    12-team playoff ·
                    11 games ·{" "}
                    {data?.group?.name}
                  </p>
                </div>

                <span className="rounded-full bg-blue-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-blue-200">
                  {statusLabel(
                    contest.status,
                  )}
                </span>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-950/40">
              <div className="border-b border-slate-800 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
                      Your bracket
                    </div>
                    <h2 className="mt-1 text-xl font-black text-white">
                      {completedPicks} of {games.length} picks
                    </h2>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!viewingFrozenEntry && <select value={selectedEntrantId} onChange={(event) => { selectBracket(event.target.value, 1); }} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs font-bold text-slate-100">
                        {entrants.map((entrant) => <option key={entrant.id} value={entrant.id}>{entrant.displayName}{entrant.kind === "managed" ? " (managed)" : ""}</option>)}
                      </select>}
                      {!viewingFrozenEntry && contest.maxBracketsPerEntrant > 1 ? <select value={bracketNumber} onChange={(event) => selectBracket(selectedEntrantId, Number(event.target.value))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs font-bold text-slate-100">
                        {Array.from({ length: contest.maxBracketsPerEntrant }, (_, index) => index + 1).map((number) => <option key={number} value={number}>Bracket {number}</option>)}
                      </select> : null}
                      {contest.managedEntrantsAllowed && !contestLocked && !viewingFrozenEntry ? <button type="button" onClick={() => void handleAddManagedEntrant()} className="rounded-lg border border-blue-400/50 px-2 py-1.5 text-xs font-black text-blue-200">Add entrant</button> : null}
                    </div>
                  </div>

                  <div className="flex rounded-xl border border-slate-700 bg-slate-900 p-1">
                    <button
                      type="button"
                      onClick={() =>
                        setView("picks")
                      }
                      className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                        view === "picks"
                          ? "bg-blue-500 text-white"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Make Picks
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setView("bracket")
                      }
                      className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                        view === "bracket"
                          ? "bg-blue-500 text-white"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Bracket View
                    </button>
                  </div>
                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-400 transition-all"
                    style={{
                      width: `${
                        games.length
                          ? Math.round(
                              (completedPicks /
                                games.length) *
                                100,
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>

                <p className="mt-3 text-sm text-slate-400">
                  {viewingFrozenEntry
                    ? "Viewing the entrant’s frozen contest bracket."
                    : contestLocked
                    ? "This bracket is locked. Your submitted picks can no longer be changed."
                    : "Picks save automatically. You can change them while the bracket is editable."}
                </p>
              </div>

              <div className="p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-400">
                    {masterBracketId
                      ? (contestLocked || viewingFrozenEntry)
                        ? `Bracket #${bracketNumber} · Locked`
                        : `Bracket #${bracketNumber} · Auto-save on`
                      : `Preparing Bracket #${bracketNumber}…`}
                  </span>

                  {saveError ? (
                    <span className="text-xs font-bold text-red-300">
                      {saveError}
                    </span>
                  ) : null}
                </div>

                {view === "picks" ? (
                  <BracketMakePicks
                    games={games}
                    teams={teams}
                    picks={picks}
                    editable={!viewingFrozenEntry && Boolean(masterBracketId) && ["setup", "open"].includes(contest.status)}
                    editableGameKeys={editableGameKeys}
                    savingGameKey={
                      savingGameKey
                    }
                    onPick={handlePick}
                  />
                ) : (
                  <BracketTopologyPreview
                    games={games}
                    teams={teams}
                    picks={picks}
                    editable={!viewingFrozenEntry && Boolean(masterBracketId) && ["setup", "open"].includes(contest.status)}
                    editableGameKeys={editableGameKeys}
                    savingGameKey={
                      savingGameKey
                    }
                    onPick={handlePick}
                  />
                )}

                <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">
                        Championship tiebreaker
                      </div>
                      <h3 className="mt-1 text-lg font-black text-white">
                        Championship Total
                      </h3>
                      <p className="mt-1 text-sm text-slate-400">
                        Predict the combined score of the championship game.
                      </p>

                      {championTeam ? (
                        <div className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-200">
                          {championTeam.logoUrl ? (
                            <img
                              src={
                                championTeam.logoUrl
                              }
                              alt=""
                              className="h-7 w-7 object-contain"
                            />
                          ) : null}
                          Champion:{" "}
                          {
                            championTeam.displayName
                          }
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-end gap-2">
                      <label className="block">
                        <span className="sr-only">
                          Championship total
                        </span>
                        <input
                          type="number"
                          min="0"
                          max="999"
                          inputMode="numeric"
                          value={
                            tiebreakerValue
                          }
                          disabled={viewingFrozenEntry || contestLocked}
                          onChange={(event) =>
                            setTiebreakerValue(
                              event.target.value,
                            )
                          }
                          className="w-28 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-center text-lg font-black text-white outline-none transition focus:border-blue-400"
                          placeholder="0"
                        />
                      </label>

                      <button
                        type="button"
                        disabled={
                          !masterBracketId ||
                          savingTiebreaker || viewingFrozenEntry || contestLocked
                        }
                        onClick={() =>
                          void handleTiebreakerSave()
                        }
                        className="rounded-xl bg-blue-500 px-4 py-3 text-xs font-black text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingTiebreaker
                          ? "Saving…"
                          : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
