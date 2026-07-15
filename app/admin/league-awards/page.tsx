"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";

type AdminTab = "create" | "manage";
type AwardRarity = "common" | "rare" | "epic" | "legendary";

type TeamOption = {
  id: number;
  name: string;
};

type RelatedTeam =
  | {
      id: number;
      name: string;
    }
  | {
      id: number;
      name: string;
    }[]
  | null;

type LeagueAward = {
  id: number;
  season: number;
  team_id: number;
  title: string;
  emoji: string;
  description: string | null;
  rarity: AwardRarity;
  display_order: number;
  featured: boolean;
  teams: RelatedTeam;
};

type AwardForm = {
  season: number;
  teamId: string;
  title: string;
  emoji: string;
  description: string;
  rarity: AwardRarity;
  displayOrder: number;
  featured: boolean;
};

const currentYear = new Date().getFullYear();

const emptyForm: AwardForm = {
  season: currentYear,
  teamId: "",
  title: "",
  emoji: "🏆",
  description: "",
  rarity: "common",
  displayOrder: 0,
  featured: false,
};

const AWARD_EMOJIS = [
  "🏆",
  "👑",
  "🥇",
  "🥈",
  "🥉",
  "🏅",
  "🔥",
  "🚀",
  "💎",
  "💯",
  "🎯",
  "🧊",
  "⚡",
  "📈",
  "📸",
  "😂",
  "💪",
  "🛡️",
  "🧠",
  "❤️",
  "🎢",
  "🐐",
  "👀",
  "🤡",
];

const rarityStyles: Record<AwardRarity, string> = {
  common:
    "border-slate-300 bg-gradient-to-br from-white to-slate-100",
  rare:
    "border-sky-300 bg-gradient-to-br from-white to-sky-100",
  epic:
    "border-violet-300 bg-gradient-to-br from-white to-violet-100",
  legendary:
    "border-amber-300 bg-gradient-to-br from-amber-50 to-orange-100",
};

function getTeamName(award: LeagueAward) {
  if (Array.isArray(award.teams)) {
    return award.teams[0]?.name ?? `Team ${award.team_id}`;
  }

  return award.teams?.name ?? `Team ${award.team_id}`;
}

function AwardPreview({
  form,
  teamName,
}: {
  form: AwardForm;
  teamName: string;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-3xl border p-6 text-center shadow-lg ${
        rarityStyles[form.rarity]
      } ${form.featured ? "min-h-[330px]" : "min-h-[280px]"}`}
    >
      {form.featured ? (
        <div className="absolute right-4 top-4 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-800">
          Featured
        </div>
      ) : null}

      <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
        {form.rarity}
      </div>

      <div className="mt-6 text-6xl">
        {form.emoji || "🏆"}
      </div>

      <h3 className="mt-5 text-2xl font-black text-slate-950">
        {form.title || "Award Title"}
      </h3>

      <div className="mt-2 text-sm font-bold text-slate-700">
        {form.season} • {teamName || "Winner"}
      </div>

      <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-slate-600">
        {form.description ||
          "The award description will appear here."}
      </p>
    </article>
  );
}

export default function LeagueAwardsAdminPage() {
  const [activeTab, setActiveTab] =
    useState<AdminTab>("create");

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [awards, setAwards] = useState<LeagueAward[]>([]);
  const [form, setForm] = useState<AwardForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [manageSeason, setManageSeason] =
    useState<number | "all">("all");

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] =
    useState<"success" | "error" | null>(null);

  async function loadAwards() {
    try {
      setIsLoading(true);

      const response = await fetch(
        "/api/admin/league-awards",
        {
          cache: "no-store",
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error || "Unable to load league awards."
        );
        setMessageType("error");
        return;
      }

      const loadedTeams = (result.teams ?? []) as TeamOption[];

      setTeams(loadedTeams);
      setAwards((result.awards ?? []) as LeagueAward[]);

      setForm((current) => ({
        ...current,
        teamId:
          current.teamId ||
          (loadedTeams[0]
            ? String(loadedTeams[0].id)
            : ""),
      }));
    } catch (error) {
      console.error("Failed to load league awards", error);
      setMessage("Unable to load league awards.");
      setMessageType("error");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAwards();
  }, []);

  const availableSeasons = useMemo(() => {
    const values = new Set<number>([
      currentYear,
      ...awards.map((award) => award.season),
    ]);

    return [...values].sort((a, b) => b - a);
  }, [awards]);

  const filteredAwards =
    manageSeason === "all"
      ? awards
      : awards.filter(
          (award) => award.season === manageSeason
        );

  const selectedTeamName =
    teams.find(
      (team) => String(team.id) === form.teamId
    )?.name ?? "";

  function resetForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      teamId: teams[0] ? String(teams[0].id) : "",
    });
  }

  function beginEdit(award: LeagueAward) {
    setEditingId(award.id);

    setForm({
      season: award.season,
      teamId: String(award.team_id),
      title: award.title,
      emoji: award.emoji,
      description: award.description ?? "",
      rarity: award.rarity,
      displayOrder: award.display_order,
      featured: award.featured,
    });

    setActiveTab("create");
    setMessage("");
    setMessageType(null);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    try {
      setIsSaving(true);
      setMessage("");
      setMessageType(null);

      const response = await fetch(
        "/api/admin/league-awards",
        {
          method: editingId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: editingId ?? undefined,
            season: form.season,
            teamId: Number(form.teamId),
            title: form.title,
            emoji: form.emoji,
            description: form.description,
            rarity: form.rarity,
            displayOrder: form.displayOrder,
            featured: form.featured,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error || "Unable to save award."
        );
        setMessageType("error");
        return;
      }

      setMessage(
        editingId
          ? "League award updated."
          : "League award created."
      );
      setMessageType("success");

      resetForm();
      await loadAwards();
    } catch (error) {
      console.error("Failed to save award", error);
      setMessage("Unable to save award.");
      setMessageType("error");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteAward(award: LeagueAward) {
    const confirmed = window.confirm(
      `Delete "${award.title}" for ${getTeamName(
        award
      )}?`
    );

    if (!confirmed) return;

    try {
      const response = await fetch(
        `/api/admin/league-awards?id=${award.id}`,
        {
          method: "DELETE",
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error || "Unable to delete award."
        );
        setMessageType("error");
        return;
      }

      setMessage("League award deleted.");
      setMessageType("success");

      await loadAwards();
    } catch (error) {
      console.error("Failed to delete award", error);
      setMessage("Unable to delete award.");
      setMessageType("error");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-amber-200 bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950 p-6 text-white shadow-xl">
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">
            Commissioner Collection
          </div>

          <h1 className="mt-2 text-3xl font-black">
            League Awards
          </h1>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Create custom seasonal honors and control how
            they appear inside each league member&apos;s
            Trophy Case.
          </p>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("create")}
              className={`rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                activeTab === "create"
                  ? "bg-amber-100 text-amber-950 shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {editingId ? "Edit Award" : "Create Award"}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("manage")}
              className={`rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                activeTab === "manage"
                  ? "bg-amber-100 text-amber-950 shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Manage Awards
            </button>
          </div>
        </section>

        {message ? (
          <section
            className={`rounded-2xl border px-4 py-3 text-sm ${
              messageType === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {message}
          </section>
        ) : null}

        {activeTab === "create" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-2xl font-black">
                  {editingId
                    ? "Edit League Award"
                    : "Create League Award"}
                </h2>

                <p className="mt-1 text-sm text-slate-600">
                  Build a unique award and preview its final
                  plaque.
                </p>
              </div>

              <form
                onSubmit={handleSubmit}
                className="grid gap-4 sm:grid-cols-2"
              >
                <label className="block">
                  <span className="text-sm font-semibold">
                    Season
                  </span>

                  <input
                    type="number"
                    min={2023}
                    max={2100}
                    value={form.season}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        season: Number(event.target.value),
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-amber-400"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-semibold">
                    Winner
                  </span>

                  <select
                    value={form.teamId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        teamId: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-amber-400"
                  >
                    {teams.map((team) => (
                      <option
                        key={team.id}
                        value={team.id}
                      >
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block sm:col-span-2">
                  <span className="text-sm font-semibold">
                    Award Title
                  </span>

                  <input
                    type="text"
                    maxLength={80}
                    value={form.title}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Consistency King"
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-amber-400"
                  />
                </label>

                <div className="block">
                  <span className="text-sm font-semibold">
                    Emoji
                  </span>

                  <div className="mt-2 rounded-2xl border border-slate-300 bg-slate-50 p-3">
                    <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                      {AWARD_EMOJIS.map((emoji) => {
                        const isSelected = form.emoji === emoji;

                        return (
                          <button
                            key={emoji}
                            type="button"
                            aria-label={`Use ${emoji}`}
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                emoji,
                              }))
                            }
                            className={`flex h-11 items-center justify-center rounded-xl border text-2xl transition ${
                              isSelected
                                ? "border-amber-400 bg-amber-100 shadow-sm"
                                : "border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50"
                            }`}
                          >
                            {emoji}
                          </button>
                        );
                      })}
                    </div>

                    <label className="mt-3 block">
                      <span className="text-xs font-semibold text-slate-500">
                        Custom emoji
                      </span>

                      <input
                        type="text"
                        maxLength={20}
                        value={form.emoji}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            emoji: event.target.value,
                          }))
                        }
                        placeholder="Paste or type another emoji"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xl outline-none focus:border-amber-400"
                      />
                    </label>
                  </div>
                </div>

                <label className="block">
                  <span className="text-sm font-semibold">
                    Rarity
                  </span>

                  <select
                    value={form.rarity}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        rarity:
                          event.target.value as AwardRarity,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 capitalize outline-none focus:border-amber-400"
                  >
                    <option value="common">Common</option>
                    <option value="rare">Rare</option>
                    <option value="epic">Epic</option>
                    <option value="legendary">
                      Legendary
                    </option>
                  </select>
                </label>

                <label className="block sm:col-span-2">
                  <span className="text-sm font-semibold">
                    Description
                  </span>

                  <textarea
                    rows={4}
                    maxLength={300}
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Best average finish during the 2026 season."
                    className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-amber-400"
                  />

                  <div className="mt-1 text-right text-xs text-slate-400">
                    {form.description.length}/300
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold">
                    Display Order
                  </span>

                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.displayOrder}
                    onChange={(event) => {
                      const digits = event.target.value.replace(
                        /\D/g,
                        ""
                      );

                      setForm((current) => ({
                        ...current,
                        displayOrder:
                          digits === "" ? 0 : Number(digits),
                      }));
                    }}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-amber-400"
                  />
                </label>

                <label className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:self-end">
                  <input
                    type="checkbox"
                    checked={form.featured}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        featured: event.target.checked,
                      }))
                    }
                    className="h-5 w-5"
                  />

                  <span>
                    <span className="block text-sm font-bold">
                      Featured Award
                    </span>

                    <span className="block text-xs text-slate-500">
                      Display this plaque more prominently.
                    </span>
                  </span>
                </label>

                <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
                  <button
                    type="submit"
                    disabled={isSaving || !form.title.trim()}
                    className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isSaving
                      ? "Saving…"
                      : editingId
                        ? "Update Award"
                        : "Create Award"}
                  </button>

                  {editingId ? (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Cancel Editing
                    </button>
                  ) : null}
                </div>
              </form>
            </section>

            <section className="lg:sticky lg:top-5 lg:self-start">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                Live Preview
              </div>

              <AwardPreview
                form={form}
                teamName={selectedTeamName}
              />
            </section>
          </div>
        ) : null}

        {activeTab === "manage" ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">
                  Manage League Awards
                </h2>

                <p className="mt-1 text-sm text-slate-600">
                  Edit, delete, and review existing awards.
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">
                  Season
                </span>

                <select
                  value={manageSeason}
                  onChange={(event) =>
                    setManageSeason(
                      event.target.value === "all"
                        ? "all"
                        : Number(event.target.value)
                    )
                  }
                  className="min-w-[150px] rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                >
                  <option value="all">All Seasons</option>

                  {availableSeasons.map((season) => (
                    <option key={season} value={season}>
                      {season}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {isLoading ? (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                Loading league awards...
              </div>
            ) : filteredAwards.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-4 py-10 text-center text-sm text-slate-600">
                No league awards found for this season.
              </div>
            ) : (
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredAwards.map((award) => (
                  <article
                    key={award.id}
                    className={`rounded-3xl border p-5 shadow-sm ${
                      rarityStyles[award.rarity]
                    } ${
                      award.featured
                        ? "md:col-span-2 xl:col-span-2"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="rounded-full border border-white/80 bg-white/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        {award.rarity}
                      </span>

                      <span className="text-xs font-semibold text-slate-500">
                        Order {award.display_order}
                      </span>
                    </div>

                    <div className="mt-4 text-5xl">
                      {award.emoji}
                    </div>

                    <h3 className="mt-3 text-xl font-black">
                      {award.title}
                    </h3>

                    <div className="mt-1 text-sm font-bold text-slate-600">
                      {award.season} • {getTeamName(award)}
                    </div>

                    {award.description ? (
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        {award.description}
                      </p>
                    ) : null}

                    {award.featured ? (
                      <div className="mt-3 text-xs font-bold uppercase tracking-wider text-amber-700">
                        Featured Award
                      </div>
                    ) : null}

                    <div className="mt-5 flex gap-2 border-t border-slate-900/10 pt-4">
                      <button
                        type="button"
                        onClick={() => beginEdit(award)}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void deleteAward(award)
                        }
                        className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
