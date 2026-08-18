"use client";

import Link from "next/link";

import AppNav from "@/components/AppNav";

import {
  useEffect,
  useMemo,
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
};


type AdminResponse = {
  success: boolean;
  teams: Team[];
  seasons: Season[];
  error?: string;
};


function shuffle<T>(
  values: T[],
) {
  const copy =
    [...values];

  for (
    let index =
      copy.length - 1;
    index > 0;
    index -= 1
  ) {
    const randomIndex =
      Math.floor(
        Math.random() *
        (index + 1),
      );

    [
      copy[index],
      copy[randomIndex],
    ] = [
      copy[randomIndex],
      copy[index],
    ];
  }

  return copy;
}


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


  async function loadAdmin(
    preferredSeasonId?: number,
  ) {
    try {
      setLoading(true);
      setError("");

      const response =
        await fetch(
          "/api/admin/nba-skins",
          {
            cache:
              "no-store",
          },
        );

      const result =
        await response.json() as AdminResponse;

      if (!response.ok) {
        throw new Error(
          result.error ??
            "Failed to load NBA Skins admin.",
        );
      }

      setData(
        result,
      );

      const nextSeason =
        result.seasons.find(
          (season) =>
            season.id ===
            preferredSeasonId,
        ) ??
        result.seasons[0] ??
        null;

      setSelectedSeasonId(
        nextSeason?.id ??
        null,
      );

      if (
        nextSeason?.draftOrder
          .length === 4
      ) {
        setOrder(
          nextSeason.draftOrder
            .sort(
              (a, b) =>
                a.draftPosition -
                b.draftPosition,
            )
            .map(
              (entry) =>
                entry.teamId,
            ),
        );
      } else {
        setOrder(
          result.teams.map(
            (team) =>
              team.id,
          ),
        );
      }

      if (
        result.seasons.length >
        0
      ) {
        const nextYear =
          Math.max(
            ...result.seasons.map(
              (season) =>
                season.season,
            ),
          ) + 1;

        setNewSeason(
          String(
            nextYear,
          ),
        );
      }
    } catch (
      loadError
    ) {
      setError(
        loadError instanceof
        Error
          ? loadError.message
          : "Failed to load NBA Skins admin.",
      );
    } finally {
      setLoading(
        false,
      );
    }
  }


  useEffect(() => {
    void loadAdmin();
  }, []);


  useEffect(() => {
    if (
      !data ||
      !selectedSeason
    ) {
      return;
    }

    if (
      selectedSeason
        .draftOrder
        .length === 4
    ) {
      setOrder(
        [...selectedSeason.draftOrder]
          .sort(
            (a, b) =>
              a.draftPosition -
              b.draftPosition,
          )
          .map(
            (entry) =>
              entry.teamId,
          ),
      );
    } else {
      setOrder(
        data.teams.map(
          (team) =>
            team.id,
        ),
      );
    }

    setMessage("");
    setError("");
  }, [
    data,
    selectedSeasonId,
  ]);


  function teamName(
    teamId: number,
  ) {
    return (
      data?.teams.find(
        (team) =>
          team.id ===
          teamId,
      )?.name ??
      "Unknown"
    );
  }


  function setPosition(
    index: number,
    teamId: number,
  ) {
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


  async function saveOrder() {
    if (
      !selectedSeason
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
                  "save-order",

                order:
                  order.map(
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

      await loadAdmin(
        selectedSeason.id,
      );
    } catch (
      saveError
    ) {
      setError(
        saveError instanceof
        Error
          ? saveError.message
          : "Failed to save draft order.",
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
      !Number.isInteger(
        season,
      )
    ) {
      setError(
        "Enter a valid starting year.",
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
              }),
          },
        );

      const result =
        await response.json();

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
          : "Failed to create season.",
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
                    value={
                      selectedSeasonId ??
                      ""
                    }
                    onChange={(
                      event,
                    ) =>
                      setSelectedSeasonId(
                        Number(
                          event.target
                            .value,
                        ),
                      )
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
                      /28 picks
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
                        This order drives Pick #1 and the seven-round snake.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={
                        busy ||
                        selectedSeason.status ===
                          "final"
                      }
                      onClick={() => {
                        setOrder(
                          shuffle(
                            data.teams.map(
                              (team) =>
                                team.id,
                            ),
                          ),
                        );

                        setMessage("");
                      }}
                      className="rounded-xl border border-blue-500/40 bg-blue-950/40 px-4 py-2.5 text-sm font-black text-blue-100 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      🎲 Randomize Order
                    </button>
                  </div>


                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {[
                      0,
                      1,
                      2,
                      3,
                    ].map(
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
                              ] ??
                              ""
                            }
                            disabled={
                              busy ||
                              selectedSeason.status ===
                                "final"
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
                            {data.teams.map(
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
                    Current order:{" "}
                    <span className="font-bold text-blue-200">
                      {order
                        .map(
                          (
                            teamId,
                            index,
                          ) =>
                            `${index + 1}. ${teamName(
                              teamId,
                            )}`,
                        )
                        .join(
                          "  •  ",
                        )}
                    </span>
                  </div>


                  <button
                    type="button"
                    onClick={
                      saveOrder
                    }
                    disabled={
                      busy ||
                      order.length !==
                        4 ||
                      selectedSeason.status ===
                        "final"
                    }
                    className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save Draft Order
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
                      Locking requires a saved four-person draft order and all 28 picks.
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
                Enter the starting year. For example, 2027 creates 2027-28.
              </p>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  type="number"
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
                    busy
                  }
                  onClick={
                    createSeason
                  }
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-500 disabled:opacity-40"
                >
                  Add New Season
                </button>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
