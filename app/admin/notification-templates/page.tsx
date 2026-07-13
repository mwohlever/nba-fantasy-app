"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";

type NotificationTemplate = {
  notificationType: "draft_turn";
  titleTemplate: string;
  bodyTemplate: string;
  description: string;
  availablePlaceholders: string[];
};

export default function NotificationTemplatesPage() {
  const [template, setTemplate] = useState<NotificationTemplate | null>(null);
  const [defaults, setDefaults] = useState<NotificationTemplate | null>(null);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadTemplate() {
      try {
        setIsLoading(true);
        setMessage("");

        const response = await fetch("/api/admin/notification-templates", {
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
          setMessage(result.error || "Failed to load notification template.");
          return;
        }

        setTemplate(result.template);
        setDefaults(result.defaults);
        setTitleTemplate(result.template.titleTemplate);
        setBodyTemplate(result.template.bodyTemplate);
      } catch (error) {
        console.error(error);
        setMessage("Something went wrong while loading the template.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadTemplate();
  }, []);

  const previewTitle = useMemo(() => {
    return titleTemplate
      .replaceAll("{teamName}", "Josh")
      .replaceAll("{slateLabel}", "2026-07-18");
  }, [titleTemplate]);

  const previewBody = useMemo(() => {
    return bodyTemplate
      .replaceAll("{teamName}", "Josh")
      .replaceAll("{slateLabel}", "2026-07-18");
  }, [bodyTemplate]);

  async function saveTemplate(resetToDefault = false) {
    try {
      setIsSaving(true);
      setMessage("");

      const response = await fetch("/api/admin/notification-templates", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notificationType: "draft_turn",
          titleTemplate,
          bodyTemplate,
          resetToDefault,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to save notification template.");
        return;
      }

      setTemplate(result.template);
      setTitleTemplate(result.template.titleTemplate);
      setBodyTemplate(result.template.bodyTemplate);
      setMessage(
        resetToDefault
          ? "Default notification wording restored."
          : "Notification wording saved."
      );
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while saving the template.");
    } finally {
      setIsSaving(false);
    }
  }

  const hasUnsavedChanges =
    Boolean(template) &&
    (titleTemplate !== template?.titleTemplate ||
      bodyTemplate !== template?.bodyTemplate);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight">
            Notification Templates
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Edit the wording used for browser push notifications. Placeholders
            are replaced automatically when the notification is sent.
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

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Draft Turn</h2>
            <p className="text-sm text-slate-600">
              {template?.description ??
                "Sent to the next participant after a draft pick is submitted."}
            </p>
          </div>

          {isLoading ? (
            <div className="mt-6 text-sm text-slate-500">
              Loading notification template…
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              <div>
                <label className="text-sm font-semibold text-slate-800">
                  Notification title
                </label>

                <input
                  type="text"
                  value={titleTemplate}
                  onChange={(event) => setTitleTemplate(event.target.value)}
                  maxLength={100}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />

                <div className="mt-1 text-right text-xs text-slate-400">
                  {titleTemplate.length}/100
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-800">
                  Notification message
                </label>

                <textarea
                  value={bodyTemplate}
                  onChange={(event) => setBodyTemplate(event.target.value)}
                  maxLength={240}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />

                <div className="mt-1 text-right text-xs text-slate-400">
                  {bodyTemplate.length}/240
                </div>
              </div>

              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <h3 className="text-sm font-semibold text-sky-950">
                  Available placeholders
                </h3>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(template?.availablePlaceholders ?? []).map(
                    (placeholder) => (
                      <button
                        key={placeholder}
                        type="button"
                        onClick={() =>
                          setBodyTemplate((current) =>
                            `${current}${current.endsWith(" ") || !current ? "" : " "}${placeholder}`
                          )
                        }
                        className="rounded-full border border-sky-200 bg-white px-3 py-1.5 font-mono text-xs text-sky-800 transition hover:bg-sky-100"
                      >
                        {placeholder}
                      </button>
                    )
                  )}
                </div>

                <p className="mt-3 text-xs leading-5 text-sky-800">
                  Click a placeholder to add it to the end of the message.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Preview
                </div>

                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="font-semibold text-slate-950">
                    {previewTitle || "Notification title"}
                  </div>

                  <div className="mt-1 text-sm leading-5 text-slate-600">
                    {previewBody || "Notification message"}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void saveTemplate(false)}
                  disabled={isSaving || !hasUnsavedChanges}
                  className="rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isSaving ? "Saving…" : "Save Changes"}
                </button>

                <button
                  type="button"
                  onClick={() => void saveTemplate(true)}
                  disabled={isSaving}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Restore Default
                </button>

                {hasUnsavedChanges && template ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTitleTemplate(template.titleTemplate);
                      setBodyTemplate(template.bodyTemplate);
                      setMessage("");
                    }}
                    disabled={isSaving}
                    className="rounded-xl px-5 py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-100"
                  >
                    Discard Changes
                  </button>
                ) : null}
              </div>

              {defaults ? (
                <p className="text-xs leading-5 text-slate-400">
                  Restoring the default returns this notification to:
                  {" "}
                  “{defaults.titleTemplate}” / “{defaults.bodyTemplate}”
                </p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
