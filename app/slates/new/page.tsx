"use client";

import { refreshGolfFromBrowser } from "@/lib/client/refreshGolfFromBrowser";

import { formatSlateDateLabel } from "@/lib/formatSlateLabel";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type TeamSelection = {
  id: number;
  name: string;
  draft_order: number;
  is_participating: boolean;
};

type SportKey = "nba" | "nfl" | "golf";

type PreviousSlate = {
  id: number;
  start_date: string;
  end_date: string;
  date: string;
  display_name?: string | null;
};

type SetupResponse = {
  success: boolean;
  sport?: SportKey;
  teams: TeamSelection[];
  previousSlate?: PreviousSlate | null;
  previousCompletedSlate?: PreviousSlate | null;
  suggestedTeamConfigs?: Array<{
    team_id: number;
    draft_order: number;
    is_participating: boolean;
  }>;
};

type GolfTournament = {
  eventId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
};

type GolfScheduleResponse = {
  success: boolean;
  year: string;
  tournaments: GolfTournament[];
};

function formatSlateLabel(startDate: string, endDate: string) {
  return startDate === endDate ? startDate : `${startDate} - ${endDate}`;
}

function normalizeDraftOrder(teams: TeamSelection[]) {
  const active = teams.filter((team) => team.is_participating);
  const inactive = teams.filter((team) => !team.is_participating);

  return [...active, ...inactive].map((team, index) => ({
    ...team,
    draft_order: index + 1,
  }));
}

export default function NewSlatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [startDate, setStartDate] = useState("");
  const [multipleDays, setMultipleDays] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [teams, setTeams] = useState<TeamSelection[]>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [previousSlateLabel, setPreviousSlateLabel] = useState("");
  const [sport, setSport] = useState<SportKey>(() => {
    const requestedSport = searchParams.get("sport");

    if (requestedSport === "nfl" || requestedSport === "golf") {
      return requestedSport;
    }

    return "nba";
  });

  const [golfYear, setGolfYear] = useState(() =>
    String(new Date().getUTCFullYear())
  );
  const [golfTournaments, setGolfTournaments] = useState<GolfTournament[]>([]);
  const [selectedGolfEventId, setSelectedGolfEventId] = useState("");
  const [cutPenaltyPerRound, setCutPenaltyPerRound] = useState(5);
  const [hasCut, setHasCut] = useState(true);
  const [isLoadingGolfSchedule, setIsLoadingGolfSchedule] = useState(false);

  useEffect(() => {
    void loadSlateSetup(sport);
  }, [sport]);

  useEffect(() => {
    if (sport !== "golf") return;
    void loadGolfSchedule(golfYear);
  }, [sport, golfYear]);

  async function loadSlateSetup(targetSport: SportKey) {
    try {
      setIsLoadingTeams(true);
      setMessage("");

      const response = await fetch(
        `/api/slates?sport=${encodeURIComponent(targetSport)}`
      );
      const result = (await response.json()) as SetupResponse | { error?: string };

      if (!response.ok) {
        setMessage(
          "error" in result && result.error
            ? result.error
            : "Failed to load slate setup."
        );
        return;
      }

const safeResult = result as SetupResponse;

const configMap = new Map(
  (safeResult.suggestedTeamConfigs ?? []).map((config) => [
    config.team_id,
    config,
  ])
);

const mergedTeams = (safeResult.teams ?? []).map((team) => {
  const config = configMap.get(team.id);

  return {
    ...team,
    draft_order: config?.draft_order ?? team.draft_order ?? 999,
    is_participating:
      config?.is_participating ?? team.is_participating ?? true,
  };
});

setTeams(
  mergedTeams.sort((a, b) => {
    if (a.is_participating !== b.is_participating) {
      return a.is_participating ? -1 : 1;
    }

    return a.draft_order - b.draft_order;
  })
);

      const previousSlate =
        safeResult.previousCompletedSlate ??
        safeResult.previousSlate ??
        null;

      if (previousSlate) {
        const label =
          previousSlate.display_name?.trim() ||
          formatSlateLabel(
            previousSlate.start_date,
            previousSlate.end_date
          );

        setPreviousSlateLabel(label);
      } else {
        setPreviousSlateLabel("");
      }
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while loading slate setup.");
    } finally {
      setIsLoadingTeams(false);
    }
  }

  async function loadGolfSchedule(year: string) {
    try {
      setIsLoadingGolfSchedule(true);
      setMessage("");

      const response = await fetch(
        `/api/golf/schedule?year=${encodeURIComponent(year)}`,
        { cache: "no-store" }
      );

      const result = (await response.json()) as
        | GolfScheduleResponse
        | { error?: string };

      if (!response.ok) {
        setGolfTournaments([]);
        setSelectedGolfEventId("");
        setMessage(
          "error" in result && result.error
            ? result.error
            : "Failed to load Golf tournaments."
        );
        return;
      }

      const safeResult = result as GolfScheduleResponse;
      const tournaments = safeResult.tournaments ?? [];

      setGolfTournaments(tournaments);
      setSelectedGolfEventId((current) => {
        if (
          current &&
          tournaments.some((tournament) => tournament.eventId === current)
        ) {
          return current;
        }

        const today = new Date().toISOString().slice(0, 10);

        const currentOrNext =
          tournaments.find((tournament) => {
            const endDate = tournament.endDate?.slice(0, 10);
            return endDate ? endDate >= today : false;
          }) ?? tournaments[0];

        return currentOrNext?.eventId ?? "";
      });
    } catch (error) {
      console.error(error);
      setGolfTournaments([]);
      setSelectedGolfEventId("");
      setMessage("Something went wrong while loading Golf tournaments.");
    } finally {
      setIsLoadingGolfSchedule(false);
    }
  }

  const selectedGolfTournament = useMemo(
    () =>
      golfTournaments.find(
        (tournament) => tournament.eventId === selectedGolfEventId
      ) ?? null,
    [golfTournaments, selectedGolfEventId]
  );

  const participatingTeams = useMemo(
    () => teams.filter((team) => team.is_participating),
    [teams]
  );

  const nonParticipatingTeams = useMemo(
    () => teams.filter((team) => !team.is_participating),
    [teams]
  );

  const orderedTeams = [...participatingTeams, ...nonParticipatingTeams];

  const golfStartDate =
    selectedGolfTournament?.startDate?.slice(0, 10) ?? "";

  const golfEndDate =
    selectedGolfTournament?.endDate?.slice(0, 10) ?? "";

  const effectiveStartDate =
    sport === "golf" ? golfStartDate : startDate;

  const effectiveEndDate =
    sport === "golf"
      ? golfEndDate
      : multipleDays
        ? endDate
        : startDate;

  const previewLabel = useMemo(() => {
    if (sport === "golf") {
      return selectedGolfTournament?.name ?? "—";
    }

    if (!effectiveStartDate) return "—";
    if (!effectiveEndDate) return effectiveStartDate;

    return formatSlateLabel(effectiveStartDate, effectiveEndDate);
  }, [
    sport,
    selectedGolfTournament,
    effectiveStartDate,
    effectiveEndDate,
  ]);

  function toggleParticipation(teamId: number) {
    setTeams((prev) => {
      const next = prev.map((team) =>
        team.id === teamId
          ? { ...team, is_participating: !team.is_participating }
          : team
      );

      return normalizeDraftOrder(next);
    });
  }

  function moveTeam(teamId: number, direction: "up" | "down") {
    setTeams((prev) => {
      const normalized = normalizeDraftOrder(prev);
      const active = normalized.filter((team) => team.is_participating);
      const inactive = normalized.filter((team) => !team.is_participating);

      const activeIndex = active.findIndex((team) => team.id === teamId);
      const inactiveIndex = inactive.findIndex((team) => team.id === teamId);

      if (activeIndex >= 0) {
        const targetIndex = direction === "up" ? activeIndex - 1 : activeIndex + 1;
        if (targetIndex < 0 || targetIndex >= active.length) return normalized;

        const copy = [...active];
        const [moved] = copy.splice(activeIndex, 1);
        copy.splice(targetIndex, 0, moved);

        return normalizeDraftOrder([...copy, ...inactive]);
      }

      if (inactiveIndex >= 0) {
        const targetIndex = direction === "up" ? inactiveIndex - 1 : inactiveIndex + 1;
        if (targetIndex < 0 || targetIndex >= inactive.length) return normalized;

        const copy = [...inactive];
        const [moved] = copy.splice(inactiveIndex, 1);
        copy.splice(targetIndex, 0, moved);

        return normalizeDraftOrder([...active, ...copy]);
      }

      return normalized;
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");

    if (sport === "golf") {
      if (!selectedGolfTournament) {
        setMessage("Please select a Golf tournament.");
        return;
      }

      if (!effectiveStartDate || !effectiveEndDate) {
        setMessage("The selected tournament is missing its dates.");
        return;
      }

      if (
        !Number.isInteger(cutPenaltyPerRound) ||
        cutPenaltyPerRound < 0 ||
        cutPenaltyPerRound > 100
      ) {
        setMessage(
          "Cut penalty must be a whole number from 0 through 100."
        );
        return;
      }
    } else {
      if (!startDate) {
        setMessage("Please select a start date.");
        return;
      }

      if (multipleDays && !endDate) {
        setMessage("Please select an end date.");
        return;
      }

      if (effectiveEndDate < effectiveStartDate) {
        setMessage("End date cannot be earlier than start date.");
        return;
      }
    }

    try {
      setIsSaving(true);

      const response = await fetch("/api/slates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: effectiveStartDate,
          endDate: effectiveEndDate,
          sport,
          displayName:
            sport === "golf"
              ? selectedGolfTournament?.name
              : undefined,
          externalEventId:
            sport === "golf"
              ? selectedGolfTournament?.eventId
              : undefined,
          cutPenaltyPerRound:
            sport === "golf"
              ? cutPenaltyPerRound
              : undefined,
          hasCut:
            sport === "golf"
              ? hasCut
              : undefined,
teamSelections: teams
  .filter((team) => team.is_participating)
  .sort((a, b) => a.draft_order - b.draft_order)
  .map((team, index) => ({
    team_id: team.id,
    draft_order: index + 1,
    is_participating: true,
  })),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to create slate.");
        return;
      }

      if (sport === "golf") {
        const slateId = Number(result?.slate?.id);

        if (!Number.isInteger(slateId) || slateId <= 0) {
          setMessage(
            "The Golf slate was created, but its slate ID was not returned. Open Manage Slates to refresh the tournament field."
          );
          return;
        }

        setMessage(
          `${selectedGolfTournament?.name ?? "Golf"} created. Loading the tournament field...`
        );

        try {
          await refreshGolfFromBrowser(
            slateId,
          );
        } catch (refreshError) {
          const message =
            refreshError instanceof Error
              ? refreshError.message
              : "Unknown field-sync error.";

          const waitingForField =
            message
              .toLowerCase()
              .includes(
                "tournament field is not available yet",
              );

          if (!waitingForField) {
            setMessage(
              `The slate was created, but the tournament field could not be loaded: ${message} You can retry from Manage Slates.`
            );
            return;
          }

          /*
           * ESPN sometimes publishes the tournament itself
           * before its scoreboard endpoint exposes competitors.
           *
           * This is a normal pre-tournament state, not a failed
           * slate creation. The Golf refresh job will retry it.
           */
          console.info(
            "Golf slate created; ESPN field is still pending.",
            {
              slateId,
              tournament:
                selectedGolfTournament?.name ??
                "Golf",
            },
          );
        }

        router.push(
          `/lineups/draft?sport=golf&slateId=${slateId}`,
        );
        router.refresh();
      } else {
        router.push(`/lineups/draft?sport=${sport}`);
        router.refresh();
      }
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while creating the slate.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight">Create New Slate</h1>
          <p className="mt-2 text-sm text-slate-600">
            Participating teams are ordered from the inverse of the previous slate standings,
            and you can manually adjust the order below.
          </p>
          {previousSlateLabel ? (
            <p className="mt-2 text-sm text-sky-700">
              Previous slate used for default order: {previousSlateLabel}
            </p>
          ) : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Sport
              </label>

              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                {(["nba", "nfl", "golf"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setSport(option);
                      setMessage("");
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      sport === option
                        ? "bg-sky-600 text-white"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {option === "golf" ? "GOLF" : option.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {sport === "golf" ? (
              <div className="space-y-5">
                <div className="grid gap-5 md:grid-cols-[180px_1fr]">
                  <div>
                    <label
                      htmlFor="golf-year"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Season
                    </label>

                    <input
                      id="golf-year"
                      type="number"
                      min={2000}
                      max={2100}
                      value={golfYear}
                      onChange={(e) => setGolfYear(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="golf-tournament"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Tournament
                    </label>

                    <select
                      id="golf-tournament"
                      value={selectedGolfEventId}
                      onChange={(e) =>
                        setSelectedGolfEventId(e.target.value)
                      }
                      disabled={isLoadingGolfSchedule}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 disabled:opacity-60"
                    >
                      <option value="">
                        {isLoadingGolfSchedule
                          ? "Loading tournaments..."
                          : "Select a tournament"}
                      </option>

                      {golfTournaments.map((tournament) => (
                        <option
                          key={tournament.eventId}
                          value={tournament.eventId}
                        >
                          {tournament.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="golf-cut-penalty"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Cut Penalty per Missed Round
                    </label>

                    <input
                      id="golf-cut-penalty"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={cutPenaltyPerRound}
                      onChange={(e) =>
                        setCutPenaltyPerRound(Number(e.target.value))
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
                    />

                    <p className="mt-1 text-xs text-slate-500">
                      A golfer missing two scheduled rounds would receive
                      twice this amount.
                    </p>

                    <label className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-800">
                      <input
                        type="checkbox"
                        checked={hasCut}
                        onChange={(e) => setHasCut(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Tournament has a 36-hole cut
                    </label>

                    <p className="mt-1 text-xs text-slate-500">
                      Leave checked for normal PGA Tour events. Turn off for
                      no-cut tournaments.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Tournament Dates
                    </div>

                    <div className="mt-1 font-semibold text-slate-900">
                      {effectiveStartDate && effectiveEndDate
                        ? formatSlateDateLabel({
                            start_date: effectiveStartDate,
                            end_date: effectiveEndDate,
                          })
                        : "Select a tournament"}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="start-date"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Start Date
                    </label>

                    <input
                      id="start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        const nextStart = e.target.value;
                        setStartDate(nextStart);

                        if (!multipleDays) {
                          setEndDate(nextStart);
                        }
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
                    />
                  </div>

                  <div className="flex items-end">
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
                      <input
                        type="checkbox"
                        checked={multipleDays}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setMultipleDays(checked);

                          if (!checked) {
                            setEndDate(startDate);
                          }
                        }}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Multiple days?
                    </label>
                  </div>
                </div>

                {multipleDays ? (
                  <div>
                    <label
                      htmlFor="end-date"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      End Date
                    </label>

                    <input
                      id="end-date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
                    />
                  </div>
                ) : null}
              </>
            )}

            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-4">
              <div className="text-xs uppercase tracking-wide text-orange-700">
                Slate Name Preview
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {previewLabel}
              </div>
            </div>

            <div>
              <div className="mb-3">
                <h2 className="text-xl font-semibold text-slate-900">Team Order</h2>
                <p className="text-sm text-slate-600">
                  Use the arrows to manually adjust order. Participating teams stay above
                  non-participants.
                </p>
              </div>

              {isLoadingTeams ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                  Loading teams...
                </div>
              ) : (
                <div className="grid gap-3">
                  {orderedTeams.map((team, index) => {
                    const sameSectionTeams = team.is_participating
                      ? orderedTeams.filter((item) => item.is_participating)
                      : orderedTeams.filter((item) => !item.is_participating);

                    const sectionIndex = sameSectionTeams.findIndex(
                      (item) => item.id === team.id
                    );

                    return (
                      <div
                        key={team.id}
                        className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
                          team.is_participating
                            ? "border-slate-200 bg-white"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-8 text-sm font-semibold text-slate-500">
                            {index + 1}.
                          </span>

                          <label className="inline-flex items-center gap-3 text-sm">
                            <input
                              type="checkbox"
checked={!!team.is_participating}
                              onChange={() => toggleParticipation(team.id)}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            <span className="font-medium text-slate-900">{team.name}</span>
                          </label>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => moveTeam(team.id, "up")}
                            disabled={sectionIndex === 0}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            ↑
                          </button>

                          <button
                            type="button"
                            onClick={() => moveTeam(team.id, "down")}
                            disabled={sectionIndex === sameSectionTeams.length - 1}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            ↓
                          </button>

                          <span
                            className={`rounded-full px-2.5 py-1 text-xs ${
                              team.is_participating
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {team.is_participating ? "Participating" : "Not playing"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {message ? (
              <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                {message}
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded-xl border border-sky-300 bg-sky-100 px-4 py-3 text-sm font-medium text-sky-900 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {isSaving
                  ? sport === "golf"
                    ? "Creating & Loading Field..."
                    : "Creating..."
                  : "Create Slate"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
