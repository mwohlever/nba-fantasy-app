"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";

type NotificationTemplateType =
  | "draft_turn"
  | "draft_final_pick"
  | "player_finished"
  | "slate_complete"
  | "slate_complete_winner";

type NotificationTemplate = {
  notificationType: NotificationTemplateType;
  titleTemplate: string;
  bodyTemplate: string;
  description: string;
  availablePlaceholders: string[];
};

type EditableTemplate = {
  titleTemplate: string;
  bodyTemplate: string;
};

const TEMPLATE_LABELS: Record<NotificationTemplateType, string> = {
  draft_turn: "🏀 Draft Turn",
  draft_final_pick: "🏁 Final Draft Pick",
  player_finished: "📈 Player Finished Game",
  slate_complete: "🏆 Slate Complete",
  slate_complete_winner: "🥇 Slate Winner",
};

const TEMPLATE_ORDER: NotificationTemplateType[] = [
  "draft_turn",
  "draft_final_pick",
  "player_finished",
  "slate_complete",
  "slate_complete_winner",
];

const PREVIEW_VALUES: Record<string, string> = {
  "{teamName}": "Josh",
  "{slateLabel}": "2026-07-18",
  "{roundNumber}": "4",
  "{roundOrdinal}": "4th",
  "{overallPickNumber}": "13",
  "{positionNeed}": "F/C",
  "{remainingNeeds}": "1 F/C",
  "{playerName}": "Anthony Edwards",
  "{fantasyPoints}": "46.7",
  "{winnerName}": "Josh",
  "{winningScore}": "247.4",
  "{teamScore}": "231.8",
  "{finishNumber}": "2",
  "{finishOrdinal}": "2nd",
};

function renderPreview(value: string) {
  return Object.entries(PREVIEW_VALUES).reduce(
    (result, [placeholder, replacement]) =>
      result.replaceAll(placeholder, replacement),
    value
  );
}

function emptyDrafts() {
  return {
    draft_turn: { titleTemplate: "", bodyTemplate: "" },
    draft_final_pick: { titleTemplate: "", bodyTemplate: "" },
    player_finished: { titleTemplate: "", bodyTemplate: "" },
    slate_complete: { titleTemplate: "", bodyTemplate: "" },
    slate_complete_winner: {
      titleTemplate: "",
      bodyTemplate: "",
    },
  };
}

export default function NotificationTemplatesPage() {
  const [activeTemplateType, setActiveTemplateType] =
    useState<NotificationTemplateType>("draft_turn");

  const [templates, setTemplates] = useState<
    Record<NotificationTemplateType, NotificationTemplate> | null
  >(null);

  const [defaults, setDefaults] = useState<
    Record<NotificationTemplateType, NotificationTemplate> | null
  >(null);

  const [drafts, setDrafts] =
    useState<Record<NotificationTemplateType, EditableTemplate>>(
      emptyDrafts()
    );

  const [isLoading, setIsLoading] = useState(true);
  const [savingType, setSavingType] =
    useState<NotificationTemplateType | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadTemplates() {
      try {
        setIsLoading(true);
        setMessage("");

        const response = await fetch("/api/admin/notification-templates", {
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
          setMessage(result.error || "Failed to load notification templates.");
          return;
        }

        const templateMap = Object.fromEntries(
          result.templates.map((template: NotificationTemplate) => [
            template.notificationType,
            template,
          ])
        ) as Record<NotificationTemplateType, NotificationTemplate>;

        const defaultMap = Object.fromEntries(
          result.defaults.map((template: NotificationTemplate) => [
            template.notificationType,
            template,
          ])
        ) as Record<NotificationTemplateType, NotificationTemplate>;

        setTemplates(templateMap);
        setDefaults(defaultMap);

        setDrafts(
          Object.fromEntries(
            TEMPLATE_ORDER.map((type) => [
              type,
              {
                titleTemplate: templateMap[type].titleTemplate,
                bodyTemplate: templateMap[type].bodyTemplate,
              },
            ])
          ) as Record<NotificationTemplateType, EditableTemplate>
        );
      } catch (error) {
        console.error(error);
        setMessage("Something went wrong while loading the templates.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadTemplates();
  }, []);

  const unsavedChanges = useMemo(() => {
    return Object.fromEntries(
      TEMPLATE_ORDER.map((type) => [
        type,
        Boolean(templates) &&
          (drafts[type].titleTemplate !== templates?.[type].titleTemplate ||
            drafts[type].bodyTemplate !== templates?.[type].bodyTemplate),
      ])
    ) as Record<NotificationTemplateType, boolean>;
  }, [drafts, templates]);

  async function saveTemplate(
    notificationType: NotificationTemplateType,
    resetToDefault = false
  ) {
    try {
      setSavingType(notificationType);
      setMessage("");

      const draft = drafts[notificationType];

      const response = await fetch("/api/admin/notification-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationType,
          titleTemplate: draft.titleTemplate,
          bodyTemplate: draft.bodyTemplate,
          resetToDefault,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to save notification template.");
        return;
      }

      setTemplates((current) =>
        current
          ? { ...current, [notificationType]: result.template }
          : current
      );

      setDrafts((current) => ({
        ...current,
        [notificationType]: {
          titleTemplate: result.template.titleTemplate,
          bodyTemplate: result.template.bodyTemplate,
        },
      }));

      setMessage(
        resetToDefault
          ? `${TEMPLATE_LABELS[notificationType]} restored to default.`
          : `${TEMPLATE_LABELS[notificationType]} saved.`
      );
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while saving the template.");
    } finally {
      setSavingType(null);
    }
  }

  function updateDraft(
    type: NotificationTemplateType,
    patch: Partial<EditableTemplate>
  ) {
    setDrafts((current) => ({
      ...current,
      [type]: { ...current[type], ...patch },
    }));
  }

  function appendPlaceholder(placeholder: string) {
    const current = drafts[activeTemplateType].bodyTemplate;
    const separator = !current || current.endsWith(" ") ? "" : " ";

    updateDraft(activeTemplateType, {
      bodyTemplate: `${current}${separator}${placeholder}`,
    });
  }

  const activeTemplate = templates?.[activeTemplateType] ?? null;
  const activeDefault = defaults?.[activeTemplateType] ?? null;
  const activeDraft = drafts[activeTemplateType];
  const isSaving = savingType === activeTemplateType;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight">
            Notification Templates
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Choose a notification type, edit its wording, and preview the
            final message.
          </p>
        </section>

        {message ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              message.toLowerCase().includes("saved") ||
              message.toLowerCase().includes("restored")
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="text-sm font-semibold text-slate-700">
            Notification type
          </label>

          <select
            value={activeTemplateType}
            onChange={(event) => {
              setActiveTemplateType(
                event.target.value as NotificationTemplateType
              );
              setMessage("");
            }}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
          >
            {TEMPLATE_ORDER.map((type) => (
              <option key={type} value={type}>
                {TEMPLATE_LABELS[type]}
                {unsavedChanges[type] ? " • Unsaved" : ""}
              </option>
            ))}
          </select>
        </section>

        {isLoading || !activeTemplate || !activeDefault ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Loading notification template…
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">
              {TEMPLATE_LABELS[activeTemplateType]}
            </h2>

            <p className="mt-1 text-sm leading-6 text-slate-600">
              {activeTemplate.description}
            </p>

            <div className="mt-6 space-y-6">
              <div>
                <label className="text-sm font-semibold">
                  Notification title
                </label>

                <input
                  value={activeDraft.titleTemplate}
                  onChange={(event) =>
                    updateDraft(activeTemplateType, {
                      titleTemplate: event.target.value,
                    })
                  }
                  maxLength={100}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-semibold">
                  Notification message
                </label>

                <textarea
                  value={activeDraft.bodyTemplate}
                  onChange={(event) =>
                    updateDraft(activeTemplateType, {
                      bodyTemplate: event.target.value,
                    })
                  }
                  maxLength={240}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                />
              </div>

              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <div className="text-sm font-semibold text-sky-950">
                  Available placeholders
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {activeTemplate.availablePlaceholders.map((placeholder) => (
                    <button
                      key={placeholder}
                      type="button"
                      onClick={() => appendPlaceholder(placeholder)}
                      className="rounded-full border border-sky-200 bg-white px-3 py-1.5 font-mono text-xs text-sky-800"
                    >
                      {placeholder}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Preview
                </div>

                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="font-semibold">
                    {renderPreview(activeDraft.titleTemplate)}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {renderPreview(activeDraft.bodyTemplate)}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() =>
                    void saveTemplate(activeTemplateType, false)
                  }
                  disabled={
                    isSaving || !unsavedChanges[activeTemplateType]
                  }
                  className="rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
                >
                  {isSaving ? "Saving…" : "Save Changes"}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void saveTemplate(activeTemplateType, true)
                  }
                  disabled={isSaving}
                  className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold"
                >
                  Restore Default
                </button>

                {unsavedChanges[activeTemplateType] ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDrafts((current) => ({
                        ...current,
                        [activeTemplateType]: {
                          titleTemplate: activeTemplate.titleTemplate,
                          bodyTemplate: activeTemplate.bodyTemplate,
                        },
                      }))
                    }
                    className="rounded-xl px-5 py-3 text-sm font-semibold text-slate-500"
                  >
                    Discard Changes
                  </button>
                ) : null}
              </div>

              <p className="text-xs text-slate-400">
                Default: “{activeDefault.titleTemplate}” / “
                {activeDefault.bodyTemplate}”
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
