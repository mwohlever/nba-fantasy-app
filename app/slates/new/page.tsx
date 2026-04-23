"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TeamSelection = {
  id: number;
  name: string;
  draft_order: number;
  is_participating: boolean;
};

type SetupResponse = {
  success: boolean;
  teams: TeamSelection[];
  previousSlate: {
    id: number;
    start_date: string;
    end_date: string;
    date: string;
  } | null;
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

  const [startDate, setStartDate] = useState("");
  const [multipleDays, setMultipleDays] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [teams, setTeams] = useState<TeamSelection[]>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [previousSlateLabel, setPreviousSlateLabel] = useState("");

  useEffect(() => {
    void loadSlateSetup();
  }, []);

  async function loadSlateSetup() {
    try {
      setIsLoadingTeams(true);
      setMessage("");

      const response = await fetch("/api/slates");
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
      setTeams(safeResult.teams ?? []);

      if (safeResult.previousSlate) {
        const label = formatSlateLabel(
          safeResult.previousSlate.start_date,
          safeResult.previousSlate.end_date
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

  const participatingTeams = useMemo(
    () => teams.filter((team) => team.is_participating),
    [teams]
  );

  const nonParticipatingTeams = useMemo(
    () => teams.filter((team) => !team.is_participating),
    [teams]
  );

  const orderedTeams = [...participatingTeams, ...nonParticipatingTeams];

  const effectiveEndDate = multipleDays ? endDate : startDate;

  const previewLabel = useMemo(() => {
    if (!startDate) return "—";
    if (!effectiveEndDate) return startDate;
    return formatSlateLabel(startDate, effectiveEndDate);
  }, [startDate, effectiveEndDate]);

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

    if (!startDate) {
      setMessage("Please select a start date.");
      return;
    }

    if (multipleDays && !endDate) {
      setMessage("Please select an end date.");
      return;
    }

    if (effectiveEndDate < startDate) {
      setMessage("End date cannot be earlier than start date.");
      return;
    }

    try {
      setIsSaving(true);

      const response = await fetch("/api/slates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate: effectiveEndDate,
          teamSelections: orderedTeams.map((team, index) => ({
            team_id: team.id,
            draft_order: index + 1,
            is_participating: team.is_participating,
          })),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to create slate.");
        return;
      }

      router.push("/lineups");
      router.refresh();
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
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label htmlFor="start-date" className="mb-2 block text-sm font-medium text-slate-700">
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
                <label htmlFor="end-date" className="mb-2 block text-sm font-medium text-slate-700">
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
                className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-3 text-sm font-medium text-sky-900 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Creating..." : "Create Slate"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
