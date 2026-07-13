"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";

type NotificationTemplateType = "draft_turn" | "draft_final_pick";

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
  draft_turn: "Standard Draft Turn",
  draft_final_pick: "Final Draft Pick",
};

const TEMPLATE_ORDER: NotificationTemplateType[] = [
  "draft_turn",
  "draft_final_pick",
];

const PREVIEW_VALUES: Record<string, string> = {
  "{teamName}": "Josh",
  "{slateLabel}": "2026-07-18",
  "{roundNumber}": "4",
  "{roundOrdinal}": "4th",
  "{overallPickNumber}": "13",
  "{positionNeed}": "F/C",
  "{remainingNeeds}": "1 F/C",
};

function renderPreview(value: string) {
  return Object.entries(PREVIEW_VALUES).reduce(
    (result, [placeholder, replacement]) =>
      result.replaceAll(placeholder, replacement),
    value
  );
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

  const [drafts, setDrafts] = useState<
    Record<NotificationTemplateType, EditableTemplate>
  >({
    draft_turn: {
      titleTemplate: "",
      bodyTemplate: "",
    },
    draft_final_pick: {
      titleTemplate: "",
      bodyTemplate: "",
    },
  });

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

        setDrafts({
          draft_turn: {
            titleTemplate: templateMap.draft_turn.titleTemplate,
            bodyTemplate: templateMap.draft_turn.bodyTemplate,
          },
          draft_final_pick: {
            titleTemplate: templateMap.draft_final_pick.titleTemplate,
            bodyTemplate: templateMap.draft_final_pick.bodyTemplate,
          },
        });
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
    if (!templates) {
      return {
        draft_turn: false,
        draft_final_pick: false,
      };
    }

    return {
      draft_turn:
        drafts.draft_turn.titleTemplate !==
          templates.draft_turn.titleTemplate ||
        drafts.draft_turn.bodyTemplate !==
          templates.draft_turn.bodyTemplate,
      draft_final_pick:
        drafts.draft_final_pick.titleTemplate !==
          templates.draft_final_pick.titleTemplate ||
        drafts.draft_final_pick.bodyTemplate !==
          templates.draft_final_pick.bodyTemplate,
    };
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
        headers: {
          "Content-Type": "application/json",
        },
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
          ? {
              ...current,
              [notificationType]: result.template,
            }
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
    notificationType: NotificationTemplateType,
    patch: Partial<EditableTemplate>
  ) {
    setDrafts((current) => ({
      ...current,
      [notificationType]: {
        ...current[notificationType],
        ...patch,
      },
    }));
  }

  function appendPlaceholder(
    notificationType: NotificationTemplateType,
    placeholder: string
  ) {
    const current = drafts[notificationType].bodyTemplate;
    const separator = !current || current.endsWith(" ") ? "" : " ";

    updateDraft(notificationType, {
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
            Choose a notification type, edit its wording, and preview how it
            will appear.
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
          <div className="md:hidden">
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
              {TEMPLATE_ORDER.map((notificationType) => (
                <option key={notificationType} value={notificationType}>
                  {TEMPLATE_LABELS[notificationType]}
                  {unsavedChanges[notificationType] ? " • Unsaved" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="hidden gap-2 md:flex">
            {TEMPLATE_ORDER.map((notificationType) => {
              const isActive = activeTemplateType === notificationType;
              const hasChanges = unsavedChanges[notificationType];

              return (
                <button
                  key={notificationType}
                  type="button"
                  onClick={() => {
                    setActiveTemplateType(notificationType);
                    setMessage("");
                  }}
                  className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    isActive
                      ? "bg-sky-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {TEMPLATE_LABELS[notificationType]}
                  {hasChanges ? " •" : ""}
                </button>
              );
            })}
          </div>
        </section>

        {isLoading || !activeTemplate || !activeDefault ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm text-slate-500">
              Loading notification template…
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <h2 className="text-xl font-semibold">
                {TEMPLATE_LABELS[activeTemplateType]}
              </h2>

              <p className="mt-1 text-sm leading-6 text-slate-600">
                {activeTemplate.description}
              </p>
            </div>

            <div className="mt-6 space-y-6">
              <div>
                <label className="text-sm font-semibold text-slate-800">
                  Notification title
                </label>

                <input
                  type="text"
                  value={activeDraft.titleTemplate}
                  onChange={(event) =>
                    updateDraft(activeTemplateType, {
                      titleTemplate: event.target.value,
                    })
                  }
                  maxLength={100}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />

                <div className="mt-1 text-right text-xs text-slate-400">
                  {activeDraft.titleTemplate.length}/100
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-800">
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
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />

                <div className="mt-1 text-right text-xs text-slate-400">
                  {activeDraft.bodyTemplate.length}/240
                </div>
              </div>

              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <h3 className="text-sm font-semibold text-sky-950">
                  Available placeholders
                </h3>

                <div className="mt-3 flex flex-wrap gap-2">
                  {activeTemplate.availablePlaceholders.map((placeholder) => (
                    <button
                      key={placeholder}
                      type="button"
                      onClick={() =>
                        appendPlaceholder(activeTemplateType, placeholder)
                      }
                      className="rounded-full border border-sky-200 bg-white px-3 py-1.5 font-mono text-xs text-sky-800 transition hover:bg-sky-100"
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

                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="font-semibold text-slate-950">
                    {renderPreview(activeDraft.titleTemplate) ||
                      "Notification title"}
                  </div>

                  <div className="mt-1 text-sm leading-5 text-slate-600">
                    {renderPreview(activeDraft.bodyTemplate) ||
                      "Notification message"}
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
                  className="rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isSaving ? "Saving…" : "Save Changes"}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void saveTemplate(activeTemplateType, true)
                  }
                  disabled={isSaving}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                    disabled={isSaving}
                    className="rounded-xl px-5 py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-100"
                  >
                    Discard Changes
                  </button>
                ) : null}
              </div>

              <p className="text-xs leading-5 text-slate-400">
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
