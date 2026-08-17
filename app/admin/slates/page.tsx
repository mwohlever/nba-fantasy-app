"use client";

import { refreshGolfFromBrowser } from "@/lib/client/refreshGolfFromBrowser";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppNav from "@/components/AppNav";
import { useSelectedSport } from "@/components/providers/SportProvider";

type SportKey = "nba" | "nfl" | "golf";

type SlateListRow = {
  id: number;
  date: string;
  start_date: string | null;
  end_date: string | null;
  is_locked: boolean;
  label: string;
  sport?: SportKey;
  display_name?: string | null;
  external_event_id?: string | null;
  cut_penalty_per_round?: number | null;
  has_cut?: boolean;
  tournament_analysis?: string | null;
  show_tournament_analysis?: boolean;
  nba_team_abbreviations?: string[] | null;
};

type SlateTeamRow = {
  team_id: number;
  team_name: string;
  draft_order: number;
  is_participating: boolean;
};

type GolfFieldSummary = {
  golferCount: number;
  lastRefreshedAt: string | null;
};

type ShotCastSummary = {
  tournamentId: string;
  generatedAt: string | null;
  updatedAt: string | null;
  summary: {
    holesRequested?: number;
    holesAvailable?: number;
    localImages?: number;
    alignedMaps?: number;
    alignedGreens?: number;
    holesFailed?: number;
  } | null;
  course: {
    id?: string;
    name?: string | null;
  } | null;
};

type SlateDetailResponse = {
  success: boolean;
  slate: SlateListRow;
  teams: SlateTeamRow[];
  golfField?: GolfFieldSummary | null;
};

type SelectedSlateState = SlateListRow & {
  nbaTeamsInput: string;
};

function normalizeTeamOrder(rows: SlateTeamRow[]) {
  const participating = rows
    .filter((team) => team.is_participating)
    .sort(
      (a, b) =>
        a.draft_order - b.draft_order ||
        a.team_name.localeCompare(b.team_name),
    );

  const inactive = rows
    .filter((team) => !team.is_participating)
    .sort(
      (a, b) =>
        a.draft_order - b.draft_order ||
        a.team_name.localeCompare(b.team_name),
    );

  return [...participating, ...inactive].map((team, index) => ({
    ...team,
    draft_order: index + 1,
  }));
}

function formatDateRange(
  startDate: string | null,
  endDate: string | null,
) {
  if (!startDate) return "Dates unavailable";
  if (!endDate || startDate === endDate) return startDate;
  return `${startDate} – ${endDate}`;
}

function formatRefreshTime(value: string | null) {
  if (!value) return "Not loaded yet";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminSlatesPage() {
  const { selectedSport } = useSelectedSport();

  const [slates, setSlates] = useState<SlateListRow[]>([]);
  const [selectedSlateId, setSelectedSlateId] =
    useState<number | "">("");
  const [selectedSlate, setSelectedSlate] =
    useState<SelectedSlateState | null>(null);
  const [teams, setTeams] = useState<SlateTeamRow[]>([]);
  const [golfField, setGolfField] =
    useState<GolfFieldSummary | null>(null);

  const [
    shotCast,
    setShotCast,
  ] = useState<ShotCastSummary | null>(
    null,
  );

  const [
    shotCastTournamentId,
    setShotCastTournamentId,
  ] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReseeding, setIsReseeding] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshingGolfField, setIsRefreshingGolfField] =
    useState(false);
  const [isImportingGolfField, setIsImportingGolfField] =
    useState(false);
  const [isSyncingGolfRankings, setIsSyncingGolfRankings] =
    useState(false);

  const [
    isRefreshingShotCast,
    setIsRefreshingShotCast,
  ] = useState(false);

  const [message, setMessage] = useState("");

  const [golfAdminTab, setGolfAdminTab] = useState<
    "tournament" | "teams" | "tools"
  >("tournament");

  const isBusy =
    isSaving ||
    isReseeding ||
    isDeleting ||
    isRefreshingGolfField ||
    isImportingGolfField ||
    isSyncingGolfRankings ||
    isRefreshingShotCast;

  useEffect(() => {
    setSelectedSlateId("");
    setSelectedSlate(null);
    setTeams([]);
    setGolfField(null);
    setShotCast(null);
    setShotCastTournamentId("");
    setGolfAdminTab("tournament");
    void loadSlates();
  }, [selectedSport]);

  useEffect(() => {
    if (!selectedSlateId) return;
    void loadSlateDetail(Number(selectedSlateId));
  }, [selectedSlateId]);

  async function loadSlates() {
    try {
      setIsLoading(true);
      setMessage("");

      const response = await fetch(
        `/api/admin/slates?sport=${encodeURIComponent(selectedSport)}`,
        { cache: "no-store" },
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to load slates.");
        return;
      }

      const nextSlates = (result.slates ?? []) as SlateListRow[];
      setSlates(nextSlates);

      if (nextSlates.length > 0) {
        setSelectedSlateId((current) => {
          if (
            current &&
            nextSlates.some((slate) => slate.id === Number(current))
          ) {
            return current;
          }

          return nextSlates[0].id;
        });
      } else {
        setSelectedSlateId("");
        setSelectedSlate(null);
        setTeams([]);
        setGolfField(null);
      }
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while loading slates.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSlateDetail(slateId: number) {
    try {
      setMessage("");

      const response = await fetch(
        `/api/admin/slates/${slateId}`,
        { cache: "no-store" },
      );

      const result = (await response.json()) as
        | SlateDetailResponse
        | { error?: string };

      if (!response.ok) {
        setMessage(
          "error" in result
            ? result.error || "Failed to load slate."
            : "Failed to load slate.",
        );
        return;
      }

      const safeResult = result as SlateDetailResponse;

      setSelectedSlate({
        ...safeResult.slate,
        nbaTeamsInput: (
          safeResult.slate.nba_team_abbreviations ?? []
        ).join(", "),
      });

      setTeams(normalizeTeamOrder(safeResult.teams ?? []));
      setGolfField(safeResult.golfField ?? null);

      if (safeResult.slate.sport === "golf") {
        void loadShotCastStatus(
          slateId,
        );
      } else {
        setShotCast(null);
        setShotCastTournamentId("");
      }
    } catch (error) {
      console.error(error);
      setMessage(
        "Something went wrong while loading slate details.",
      );
    }
  }

  async function loadShotCastStatus(
    slateId: number,
  ) {
    try {
      const response = await fetch(
        `/api/admin/golf/shotcast?slateId=${slateId}`,
        {
          cache: "no-store",
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        setShotCast(null);
        return;
      }

      const nextShotCast =
        result.shotcast as
          | ShotCastSummary
          | null;

      setShotCast(nextShotCast);

      if (
        nextShotCast
          ?.tournamentId
      ) {
        setShotCastTournamentId(
          nextShotCast
            .tournamentId,
        );
      }
    } catch (error) {
      console.error(error);
      setShotCast(null);
    }
  }

  async function handleRefreshShotCast() {
    if (!selectedSlateId) {
      return;
    }

    const tournamentId =
      shotCastTournamentId
        .trim()
        .toUpperCase();

    if (
      !/^R\d{7}$/.test(
        tournamentId,
      )
    ) {
      setMessage(
        "Enter a PGA tournament ID such as R2026013.",
      );

      return;
    }

    try {
      setIsRefreshingShotCast(true);
      setMessage("");

      const response = await fetch(
        "/api/admin/golf/shotcast",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            slateId:
              Number(
                selectedSlateId,
              ),
            tournamentId,
            round: 1,
          }),
          cache: "no-store",
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        setMessage(
          result.error ||
            "Failed to refresh ShotCast assets.",
        );

        return;
      }

      await loadShotCastStatus(
        Number(selectedSlateId),
      );

      setMessage(
        `ShotCast refreshed: ${
          result.summary
            ?.localImages ?? 0
        } photos, ${
          result.summary
            ?.alignedMaps ?? 0
        } aligned maps, ${
          result.summary
            ?.alignedGreens ?? 0
        } aligned greens.`,
      );
    } catch (error) {
      console.error(error);

      setMessage(
        "Something went wrong while refreshing ShotCast.",
      );
    } finally {
      setIsRefreshingShotCast(false);
    }
  }

  function toggleParticipation(teamId: number) {
    setTeams((current) =>
      normalizeTeamOrder(
        current.map((team) =>
          team.team_id === teamId
            ? {
                ...team,
                is_participating: !team.is_participating,
              }
            : team,
        ),
      ),
    );
  }

  function moveTeam(
    teamId: number,
    direction: "up" | "down",
  ) {
    setTeams((current) => {
      const normalized = normalizeTeamOrder(current);
      const team = normalized.find(
        (row) => row.team_id === teamId,
      );

      if (!team) return normalized;

      const sameSection = normalized.filter(
        (row) =>
          row.is_participating === team.is_participating,
      );

      const currentIndex = sameSection.findIndex(
        (row) => row.team_id === teamId,
      );

      const targetIndex =
        direction === "up"
          ? currentIndex - 1
          : currentIndex + 1;

      if (
        targetIndex < 0 ||
        targetIndex >= sameSection.length
      ) {
        return normalized;
      }

      const reorderedSection = [...sameSection];
      const [moved] = reorderedSection.splice(currentIndex, 1);
      reorderedSection.splice(targetIndex, 0, moved);

      const otherSection = normalized.filter(
        (row) =>
          row.is_participating !== team.is_participating,
      );

      return normalizeTeamOrder(
        team.is_participating
          ? [...reorderedSection, ...otherSection]
          : [...otherSection, ...reorderedSection],
      );
    });
  }

  async function handleSave() {
    if (!selectedSlateId || !selectedSlate) return;

    const normalizedTeams = normalizeTeamOrder(teams);

    if (
      selectedSlate.sport === "golf" &&
      (
        !Number.isInteger(
          selectedSlate.cut_penalty_per_round,
        ) ||
        Number(selectedSlate.cut_penalty_per_round) < 0 ||
        Number(selectedSlate.cut_penalty_per_round) > 100
      )
    ) {
      setMessage(
        "Cut penalty must be a whole number from 0 through 100.",
      );
      return;
    }

    try {
      setIsSaving(true);
      setMessage("");

      const response = await fetch(
        `/api/admin/slates/${selectedSlateId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            is_locked: selectedSlate.is_locked,
            cut_penalty_per_round:
              selectedSlate.sport === "golf"
                ? Number(
                    selectedSlate.cut_penalty_per_round,
                  )
                : undefined,
            has_cut:
              selectedSlate.sport === "golf"
                ? selectedSlate.has_cut !== false
                : undefined,
            tournament_analysis:
              selectedSlate.sport === "golf"
                ? selectedSlate.tournament_analysis ?? ""
                : undefined,
            show_tournament_analysis:
              selectedSlate.sport === "golf"
                ? selectedSlate.show_tournament_analysis === true
                : undefined,
            nba_team_abbreviations:
              selectedSlate.nbaTeamsInput
                .split(",")
                .map((value) =>
                  value.trim().toUpperCase(),
                )
                .filter(Boolean),
            teams: normalizedTeams.map(
              (team, index) => ({
                team_id: team.team_id,
                draft_order: index + 1,
                is_participating:
                  team.is_participating,
              }),
            ),
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error || "Failed to save slate.",
        );
        return;
      }

      setMessage("Slate updated successfully.");
      await loadSlateDetail(Number(selectedSlateId));
      await loadSlates();
    } catch (error) {
      console.error(error);
      setMessage(
        "Something went wrong while saving the slate.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRefreshGolfField() {
    if (!selectedSlateId || !selectedSlate) return;

    try {
      setIsRefreshingGolfField(true);
      setMessage("");

      await refreshGolfFromBrowser(
        Number(selectedSlateId),
      );

      await loadSlateDetail(Number(selectedSlateId));

      setMessage(
        "Tournament field, scores, rounds, and hole data refreshed successfully.",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      const isWaitingForField =
        errorMessage
          .toLowerCase()
          .includes(
            "tournament field is not available yet",
          );

      if (isWaitingForField) {
        setMessage(
          "Tournament found. ESPN has not published the field yet. Automatic refresh will keep checking.",
        );
      } else {
        console.error(error);
        setMessage(
          "Something went wrong while refreshing the tournament field.",
        );
      }
    } finally {
      setIsRefreshingGolfField(false);
    }
  }

  async function handleImportPgaTourField() {
    if (!selectedSlateId || !selectedSlate) return;

    try {
      setIsImportingGolfField(true);
      setMessage("");

      const response = await fetch(
        "/api/admin/golf/import-field",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            slateId: Number(selectedSlateId),
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result?.error ||
            "PGA Tour field import failed.",
        );
        return;
      }

      await loadSlateDetail(
        Number(selectedSlateId),
      );

      const playerCount =
        Number(
          result?.eventPlayersUpserted ??
            result?.fieldPlayersFound ??
            0,
        );

      setMessage(
        `PGA Tour field imported successfully: ${playerCount} golfers loaded.`,
      );
    } catch (error) {
      console.error(error);

      setMessage(
        error instanceof Error
          ? `PGA Tour field import failed: ${error.message}`
          : "Something went wrong while importing the PGA Tour field.",
      );
    } finally {
      setIsImportingGolfField(false);
    }
  }

  async function handleSyncGolfRankings() {
    try {
      setIsSyncingGolfRankings(true);
      setMessage("");

      const response = await fetch(
        "/api/admin/sync-golf-rankings",
        {
          method: "POST",
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error || "Failed to sync Golf rankings.",
        );
        return;
      }

      setMessage(
        `OWGR synced: ${result.updatedGolfers ?? 0} updated, ` +
          `${result.createdGolfers ?? 0} added, ` +
          `${result.unmatchedGolfers ?? 0} unmatched.`,
      );
    } catch (error) {
      console.error(error);
      setMessage(
        "Something went wrong while syncing Golf rankings.",
      );
    } finally {
      setIsSyncingGolfRankings(false);
    }
  }

  async function handleReseed() {
    if (!selectedSlateId) return;

    const confirmed = window.confirm(
      "Replace the current draft order using the previous completed slate?",
    );

    if (!confirmed) return;

    try {
      setIsReseeding(true);
      setMessage("");

      const response = await fetch(
        `/api/admin/slates/${selectedSlateId}/reseed`,
        { method: "POST" },
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error || "Failed to reseed the slate.",
        );
        return;
      }

      setMessage("Slate reseeded successfully.");
      await loadSlateDetail(Number(selectedSlateId));
    } catch (error) {
      console.error(error);
      setMessage(
        "Something went wrong while reseeding.",
      );
    } finally {
      setIsReseeding(false);
    }
  }

  async function handleDelete() {
    if (!selectedSlateId) return;

    const confirmed = window.confirm(
      "Delete this slate? This removes its lineups, stats, results, and settings.",
    );

    if (!confirmed) return;

    try {
      setIsDeleting(true);
      setMessage("");

      const response = await fetch(
        `/api/admin/slates/${selectedSlateId}`,
        { method: "DELETE" },
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error || "Failed to delete the slate.",
        );
        return;
      }

      setSelectedSlate(null);
      setTeams([]);
      setGolfField(null);
      setSelectedSlateId("");
      await loadSlates();
      setMessage("Slate deleted successfully.");
    } catch (error) {
      console.error(error);
      setMessage(
        "Something went wrong while deleting the slate.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  const orderedTeams = useMemo(
    () => normalizeTeamOrder(teams),
    [teams],
  );

  const participatingTeams = useMemo(
    () =>
      orderedTeams.filter(
        (team) => team.is_participating,
      ),
    [orderedTeams],
  );

  const inactiveTeams = useMemo(
    () =>
      orderedTeams.filter(
        (team) => !team.is_participating,
      ),
    [orderedTeams],
  );

  function renderTeamRow(
    team: SlateTeamRow,
    sectionRows: SlateTeamRow[],
  ) {
    const sectionIndex = sectionRows.findIndex(
      (row) => row.team_id === team.team_id,
    );

    return (
      <tr
        key={team.team_id}
        className="border-t border-slate-200"
      >
        <td className="px-4 py-3 font-medium text-slate-100">
          <div className="flex items-center gap-3">
            <span className="w-6 text-sm text-slate-400">
              {team.draft_order}.
            </span>
            {team.team_name}
          </div>
        </td>

        <td className="px-4 py-3">
          <input
            type="checkbox"
            checked={team.is_participating}
            onChange={() =>
              toggleParticipation(team.team_id)
            }
            disabled={isBusy}
            className="h-4 w-4 rounded border-slate-500"
          />
        </td>

        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                moveTeam(team.team_id, "up")
              }
              disabled={isBusy || sectionIndex === 0}
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={`Move ${team.team_name} up`}
            >
              ↑
            </button>

            <button
              type="button"
              onClick={() =>
                moveTeam(team.team_id, "down")
              }
              disabled={
                isBusy ||
                sectionIndex === sectionRows.length - 1
              }
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={`Move ${team.team_name} down`}
            >
              ↓
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-700 bg-slate-900 px-6 py-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Slate Manager
              </h1>

              <p className="mt-2 text-sm text-slate-300">
                Manage tournament settings, participants,
                draft order, field data, and slate status.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Link
                href="/admin"
                className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-sky-400 hover:bg-slate-800"
              >
                ← Back
              </Link>

              <div className="min-w-[250px]">
                <label
                  htmlFor="slate-select"
                  className="mb-1 block text-xs font-medium text-slate-300"
                >
                  Select Slate
                </label>

                <select
                  id="slate-select"
                  value={selectedSlateId}
                  onChange={(event) =>
                    setSelectedSlateId(
                      event.target.value
                        ? Number(event.target.value)
                        : "",
                    )
                  }
                  disabled={isBusy}
                  className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-3 text-sm text-slate-100 outline-none transition focus:border-sky-400 disabled:opacity-60"
                >
                  {slates.map((slate) => (
                    <option
                      key={slate.id}
                      value={slate.id}
                    >
                      {slate.label}
                      {slate.is_locked ? " (Locked)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {message ? (
          <div className="rounded-2xl border border-sky-700 bg-sky-950/70 px-4 py-3 text-sm text-sky-100">
            {message}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-sm">
          {isLoading ? (
            <div className="text-sm text-slate-300">
              Loading slates...
            </div>
          ) : !selectedSlate ? (
            <div className="rounded-2xl border border-dashed border-slate-600 px-4 py-8 text-sm text-slate-400">
              No slate is available for this sport.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-400">
                    Current Slate
                  </div>

                  <h2 className="mt-2 text-2xl font-bold text-white">
                    {selectedSlate.display_name?.trim() ||
                      selectedSlate.label}
                  </h2>

                  <div className="mt-2 text-sm text-slate-300">
                    {formatDateRange(
                      selectedSlate.start_date,
                      selectedSlate.end_date,
                    )}
                  </div>

                  {selectedSlate.external_event_id ? (
                    <div className="mt-1 text-xs text-slate-400">
                      ESPN event:{" "}
                      {selectedSlate.external_event_id}
                    </div>
                  ) : null}
                </div>

                <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={selectedSlate.is_locked}
                    onChange={(event) =>
                      setSelectedSlate((current) =>
                        current
                          ? {
                              ...current,
                              is_locked:
                                event.target.checked,
                            }
                          : current,
                      )
                    }
                    disabled={isBusy}
                    className="h-4 w-4 rounded border-slate-500"
                  />
                  Locked
                </label>
              </div>

              {selectedSlate.sport === "golf" ? (
                <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-1">
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      {
                        key: "tournament" as const,
                        label: "Tournament",
                      },
                      {
                        key: "teams" as const,
                        label: "Teams & Draft",
                      },
                      {
                        key: "tools" as const,
                        label: "Tools",
                      },
                    ].map((tab) => {
                      const isActive =
                        golfAdminTab === tab.key;

                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() =>
                            setGolfAdminTab(tab.key)
                          }
                          className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                            isActive
                              ? "bg-emerald-700 text-white shadow-sm"
                              : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {selectedSlate.sport === "golf" &&
              golfAdminTab === "tournament" ? (
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                      Tournament Field
                    </div>

                    <div className="mt-2 text-2xl font-bold text-white">
                      {golfField?.golferCount ?? 0}
                    </div>

                    <div className="mt-1 text-xs text-emerald-200/80">
                      golfers loaded
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                    <label
                      htmlFor="cut-penalty"
                      className="block text-xs font-semibold uppercase tracking-wide text-slate-300"
                    >
                      Cut Penalty
                    </label>

                    <div className="mt-2 flex items-center gap-2">
                      <input
                        id="cut-penalty"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={
                          selectedSlate.cut_penalty_per_round ??
                          5
                        }
                        onChange={(event) =>
                          setSelectedSlate((current) =>
                            current
                              ? {
                                  ...current,
                                  cut_penalty_per_round:
                                    Number(
                                      event.target.value,
                                    ),
                                }
                              : current,
                          )
                        }
                        disabled={isBusy}
                        className="w-24 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-lg font-bold text-white outline-none focus:border-emerald-400"
                      />

                      <span className="text-sm text-slate-400">
                        per missed round
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Tournament Cut
                    </div>

                    <label className="mt-3 flex items-center gap-3 text-sm font-medium text-white">
                      <input
                        type="checkbox"
                        checked={selectedSlate.has_cut !== false}
                        onChange={(event) =>
                          setSelectedSlate((current) =>
                            current
                              ? {
                                  ...current,
                                  has_cut: event.target.checked,
                                }
                              : current,
                          )
                        }
                        disabled={isBusy}
                        className="h-4 w-4 rounded border-slate-500"
                      />
                      36-hole cut
                    </label>

                    <div className="mt-2 text-xs leading-5 text-slate-400">
                      Turn this off for no-cut tournaments. Projected cut,
                      CUT statuses, and cut penalties will be disabled.
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Last Field Refresh
                    </div>

                    <div className="mt-2 text-sm font-semibold text-white">
                      {formatRefreshTime(
                        golfField?.lastRefreshedAt ?? null,
                      )}
                    </div>
                  </div>


                </div>
              ) : null}

              {selectedSlate.sport === "nba" ? (
                <div className="max-w-xl">
                  <label
                    htmlFor="nba-team-codes"
                    className="mb-1 block text-xs font-medium text-slate-300"
                  >
                    NBA Team Codes
                  </label>

                  <input
                    id="nba-team-codes"
                    type="text"
                    value={selectedSlate.nbaTeamsInput}
                    onChange={(event) =>
                      setSelectedSlate((current) =>
                        current
                          ? {
                              ...current,
                              nbaTeamsInput:
                                event.target.value,
                            }
                          : current,
                      )
                    }
                    disabled={isBusy}
                    placeholder="BOS, CLE, NYK"
                    className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-sky-400"
                  />
                </div>
              ) : null}

              {selectedSlate.sport === "golf" &&
              golfAdminTab === "tournament" ? (
                <div className="rounded-2xl border border-emerald-800 bg-emerald-950/25 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                        Tournament Analysis
                      </div>

                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        Write a short tournament commentary for the Home page.
                        Keep it hidden while drafting, then turn it on whenever
                        you want everyone to see it.
                      </p>
                    </div>

                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={
                          selectedSlate.show_tournament_analysis === true
                        }
                        onChange={(event) =>
                          setSelectedSlate((current) =>
                            current
                              ? {
                                  ...current,
                                  show_tournament_analysis:
                                    event.target.checked,
                                }
                              : current,
                          )
                        }
                        disabled={isBusy}
                        className="h-4 w-4 rounded border-slate-500"
                      />

                      <span className="text-sm font-semibold text-slate-200">
                        {selectedSlate.show_tournament_analysis
                          ? "Showing on Home"
                          : "Hidden"}
                      </span>
                    </label>
                  </div>

                  <textarea
                    value={
                      selectedSlate.tournament_analysis ?? ""
                    }
                    onChange={(event) =>
                      setSelectedSlate((current) =>
                        current
                          ? {
                              ...current,
                              tournament_analysis:
                                event.target.value,
                            }
                          : current,
                      )
                    }
                    disabled={isBusy}
                    maxLength={4000}
                    rows={5}
                    placeholder="Example: Mark's Sunday charge remains technically possible, assuming the other three teams voluntarily withdraw."
                    className="mt-4 w-full resize-y rounded-xl border border-slate-600 bg-slate-950 px-3 py-3 text-sm leading-6 text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-emerald-400 disabled:opacity-60"
                  />

                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span>
                      Saved with the selected tournament.
                    </span>

                    <span>
                      {
                        (
                          selectedSlate.tournament_analysis ??
                          ""
                        ).length
                      }/4000
                    </span>
                  </div>
                </div>
              ) : null}

              {selectedSlate.sport === "golf" &&
              golfAdminTab === "tools" ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-violet-800 bg-violet-950/25 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-violet-300">
                          ShotCast Course Assets
                        </div>

                        <div className="mt-2 text-sm font-bold text-white">
                          {shotCast
                            ? `${
                                shotCast.summary
                                  ?.localImages ?? 0
                              } photos · ${
                                shotCast.summary
                                  ?.alignedMaps ?? 0
                              } maps`
                            : "Not imported"}
                        </div>

                        <div className="mt-1 text-xs text-violet-200/80">
                          {shotCast
                            ? `Last updated ${formatRefreshTime(
                                shotCast.updatedAt,
                              )}`
                            : "No ShotCast course assets are loaded for this tournament."}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-violet-900/70 pt-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                        Course Importer
                      </div>

                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <label
                        htmlFor="shotcast-tournament-id"
                        className="mb-1 block text-xs font-medium text-slate-300"
                      >
                        PGA Tournament ID
                      </label>

                      <input
                        id="shotcast-tournament-id"
                        type="text"
                        value={
                          shotCastTournamentId
                        }
                        onChange={(event) =>
                          setShotCastTournamentId(
                            event.target.value
                              .toUpperCase(),
                          )
                        }
                        disabled={isBusy}
                        placeholder="R2026013"
                        className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-3 text-sm font-bold uppercase text-white outline-none focus:border-violet-400"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        void handleRefreshShotCast()
                      }
                      disabled={isBusy}
                      className="rounded-xl border border-violet-500 bg-violet-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRefreshingShotCast
                        ? "Refreshing ShotCast..."
                        : shotCast
                          ? "Refresh ShotCast"
                          : "Import ShotCast"}
                    </button>
                  </div>

                      <div className="mt-2 text-xs leading-5 text-slate-400">
                        Refreshes all 18 hole layouts and checks whether PGA has published coordinate-aligned maps.
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                          World Golf Ranking
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-400">
                          Refresh golfer OWGR data used throughout 111 Sports.
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          void handleSyncGolfRankings()
                        }
                        disabled={isBusy}
                        className="shrink-0 rounded-xl border border-emerald-500 bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSyncingGolfRankings
                          ? "Syncing OWGR..."
                          : "Sync OWGR"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {selectedSlate.sport !== "golf" ||
              golfAdminTab === "teams" ? (
                <div className="overflow-hidden rounded-2xl border border-slate-700">
                  <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-slate-800 text-slate-200">
                      <tr className="text-left">
                        <th className="px-4 py-3">
                          Team
                        </th>
                        <th className="px-4 py-3">
                          Participating
                        </th>
                        <th className="px-4 py-3">
                          Draft Order
                        </th>
                      </tr>
                    </thead>

                    <tbody className="bg-slate-900">
                      {participatingTeams.map((team) =>
                        renderTeamRow(
                          team,
                          participatingTeams,
                        ),
                      )}

                      {inactiveTeams.length > 0 ? (
                        <tr className="border-t border-slate-700 bg-slate-950/60">
                          <td
                            colSpan={3}
                            className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                          >
                            Not participating
                          </td>
                        </tr>
                      ) : null}

                      {inactiveTeams.map((team) =>
                        renderTeamRow(
                          team,
                          inactiveTeams,
                        ),
                      )}
                    </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isBusy}
                  className="rounded-xl border border-emerald-500 bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save Slate"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={isBusy}
                  className="rounded-xl border border-red-600 bg-red-900 px-4 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleting
                    ? "Deleting..."
                    : "Delete Slate"}
                </button>

                {selectedSlate.sport === "golf" &&
                golfAdminTab === "tournament" ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void handleRefreshGolfField()
                      }
                      disabled={
                        isBusy || selectedSlate.is_locked
                      }
                      title={
                        selectedSlate.is_locked
                          ? "Unlock and save the slate before refreshing the field."
                          : "Reload the field, leaderboard, rounds, and holes from ESPN."
                      }
                      className="rounded-xl border border-sky-500 bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRefreshingGolfField
                        ? "Refreshing Field..."
                        : "Refresh Tournament Field"}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void handleImportPgaTourField()
                      }
                      disabled={
                        isBusy || selectedSlate.is_locked
                      }
                      title={
                        selectedSlate.is_locked
                          ? "Unlock and save the slate before importing the field."
                          : "Load the tournament field directly from PGA Tour when ESPN has not published its field yet."
                      }
                      className="rounded-xl border border-emerald-400 bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isImportingGolfField
                        ? "Importing PGA Field..."
                        : "Import PGA Tour Field"}
                    </button>
                  </>
                ) : null}

                {selectedSlate.sport === "golf" &&
                golfAdminTab === "teams" ? (
                  <button
                    type="button"
                    onClick={() => void handleReseed()}
                    disabled={isBusy}
                    className="rounded-xl border border-slate-500 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isReseeding
                      ? "Reseeding..."
                      : "Reseed From Previous Slate"}
                  </button>
                ) : null}

                {selectedSlate.sport !== "golf" ? (
                  <button
                    type="button"
                    onClick={() => void handleReseed()}
                    disabled={isBusy}
                    className="rounded-xl border border-slate-500 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isReseeding
                      ? "Reseeding..."
                      : "Reseed From Previous Slate"}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
