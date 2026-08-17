"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import AppNav from "@/components/AppNav";

type Settings = {
  enabled: boolean;
  reminderHours: number;
  titleTemplate: string;
  bodyTemplate: string;
};

type Payload = {
  success: boolean;
  settings: Settings;
  defaults: Settings;
  availablePlaceholders: string[];
  error?: string;
};

function renderPreview(
  value: string,
) {
  const examples:
    Record<string, string> = {
      "{teamName}":
        "Mark",

      "{missingPicks}":
        "2",

      "{weekLabel}":
        "Week 1",

      "{lockTime}":
        "Sat, 7:30 PM EDT",

      "{season}":
        "2026",

      "{weekNumber}":
        "1",
    };

  return Object.entries(
    examples,
  ).reduce(
    (
      result,
      [
        placeholder,
        replacement,
      ],
    ) =>
      result.replaceAll(
        placeholder,
        replacement,
      ),
    value,
  );
}

export default function NcaaPickEmNotificationControl() {
  const [
    saved,
    setSaved,
  ] =
    useState<Settings | null>(
      null,
    );

  const [
    defaults,
    setDefaults,
  ] =
    useState<Settings | null>(
      null,
    );

  const [
    draft,
    setDraft,
  ] =
    useState<Settings | null>(
      null,
    );

  const [
    placeholders,
    setPlaceholders,
  ] =
    useState<string[]>(
      [],
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true,
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false,
    );

  const [
    message,
    setMessage,
  ] =
    useState("");

  useEffect(() => {
    const controller =
      new AbortController();

    async function load() {
      try {
        setLoading(
          true,
        );

        const response =
          await fetch(
            "/api/admin/ncaa-pickem/notification-settings",
            {
              cache:
                "no-store",

              signal:
                controller.signal,
            },
          );

        const result =
          await response.json() as
            Payload;

        if (
          controller.signal.aborted
        ) {
          return;
        }

        if (
          !response.ok
        ) {
          setMessage(
            result.error ??
              "Unable to load NCAA Pick 'Em notification settings.",
          );

          return;
        }

        setSaved(
          result.settings,
        );

        setDraft(
          result.settings,
        );

        setDefaults(
          result.defaults,
        );

        setPlaceholders(
          result.availablePlaceholders ??
            [],
        );
      } catch (error) {
        if (
          error instanceof
            DOMException &&
          error.name ===
            "AbortError"
        ) {
          return;
        }

        console.error(
          error,
        );

        setMessage(
          "Unable to load NCAA Pick 'Em notification settings.",
        );
      } finally {
        if (
          !controller.signal.aborted
        ) {
          setLoading(
            false,
          );
        }
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, []);

  const changed =
    useMemo(
      () =>
        Boolean(
          draft &&
          saved &&
          (
            draft.enabled !==
              saved.enabled ||
            draft.reminderHours !==
              saved.reminderHours ||
            draft.titleTemplate !==
              saved.titleTemplate ||
            draft.bodyTemplate !==
              saved.bodyTemplate
          )
        ),
      [
        draft,
        saved,
      ],
    );

  async function save(
    resetToDefault =
      false,
  ) {
    if (
      !draft
    ) {
      return;
    }

    try {
      setSaving(
        true,
      );

      setMessage("");

      const response =
        await fetch(
          "/api/admin/ncaa-pickem/notification-settings",
          {
            method:
              "PUT",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                ...draft,
                resetToDefault,
              }),
          },
        );

      const result =
        await response.json();

      if (
        !response.ok
      ) {
        setMessage(
          result.error ??
            "Unable to save NCAA Pick 'Em notification settings.",
        );

        return;
      }

      setSaved(
        result.settings,
      );

      setDraft(
        result.settings,
      );

      setMessage(
        resetToDefault
          ? "Pick 'Em reminder settings restored to default."
          : "Pick 'Em reminder settings saved.",
      );
    } catch (error) {
      console.error(
        error,
      );

      setMessage(
        "Unable to save NCAA Pick 'Em notification settings.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  function appendPlaceholder(
    placeholder: string,
  ) {
    if (
      !draft
    ) {
      return;
    }

    const current =
      draft.bodyTemplate;

    const separator =
      !current ||
      current.endsWith(
        " ",
      )
        ? ""
        : " ";

    setDraft({
      ...draft,

      bodyTemplate:
        `${current}${separator}${placeholder}`,
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-6">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
            NCAA Pick &apos;Em
          </div>

          <h1 className="mt-2 text-3xl font-black tracking-tight">
            Notification Control
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Control the missing-picks reminder sent before the weekly card locks.
            The first available 111 Sports heartbeat inside this window sends it
            once to anyone who still has picks to save.
          </p>
        </section>

        {message ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              message.includes(
                "saved",
              ) ||
              message.includes(
                "restored",
              )
                ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-200"
                : "border-red-500/30 bg-red-950/30 text-red-200"
            }`}
          >
            {message}
          </div>
        ) : null}

        {loading ||
        !draft ||
        !saved ||
        !defaults ? (
          <section className="rounded-3xl border border-slate-700 bg-slate-900 p-6 text-slate-400">
            Loading Pick &apos;Em notification settings…
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-700 bg-slate-900 p-6">
            <div className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black">
                  🏈 Pick &apos;Em Reminder
                </h2>

                <p className="mt-1 text-sm text-slate-400">
                  Sent once to users with missing picks before the weekly lock.
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3">
                <input
                  type="checkbox"
                  checked={
                    draft.enabled
                  }
                  onChange={(
                    event,
                  ) =>
                    setDraft({
                      ...draft,

                      enabled:
                        event
                          .target
                          .checked,
                    })
                  }
                  className="h-4 w-4"
                />

                <span className="font-bold">
                  {draft.enabled
                    ? "Enabled"
                    : "Disabled"}
                </span>
              </label>
            </div>

            <div className="mt-6 space-y-6">
              <div>
                <label className="text-sm font-bold">
                  Reminder window
                </label>

                <div className="mt-2 flex max-w-sm items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={168}
                    step={1}
                    value={
                      draft.reminderHours
                    }
                    onChange={(
                      event,
                    ) =>
                      setDraft({
                        ...draft,

                        reminderHours:
                          Number(
                            event
                              .target
                              .value,
                          ),
                      })
                    }
                    className="w-28 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-bold text-white"
                  />

                  <span className="text-sm text-slate-400">
                    hours before picks lock
                  </span>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  Because reminders use normal app activity rather than a guaranteed scheduler,
                  the notification sends on the first available heartbeat inside this window.
                </p>
              </div>

              <div>
                <label className="text-sm font-bold">
                  Notification title
                </label>

                <input
                  value={
                    draft.titleTemplate
                  }
                  maxLength={100}
                  onChange={(
                    event,
                  ) =>
                    setDraft({
                      ...draft,

                      titleTemplate:
                        event
                          .target
                          .value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
                />
              </div>

              <div>
                <label className="text-sm font-bold">
                  Notification message
                </label>

                <textarea
                  value={
                    draft.bodyTemplate
                  }
                  maxLength={240}
                  rows={4}
                  onChange={(
                    event,
                  ) =>
                    setDraft({
                      ...draft,

                      bodyTemplate:
                        event
                          .target
                          .value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
                />
              </div>

              <div className="rounded-2xl border border-blue-500/30 bg-blue-950/25 p-4">
                <div className="text-sm font-bold text-blue-200">
                  Available placeholders
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {placeholders.map(
                    (
                      placeholder,
                    ) => (
                      <button
                        key={
                          placeholder
                        }
                        type="button"
                        onClick={() =>
                          appendPlaceholder(
                            placeholder,
                          )
                        }
                        className="rounded-full border border-blue-500/30 bg-slate-950 px-3 py-1.5 font-mono text-xs text-blue-200"
                      >
                        {
                          placeholder
                        }
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Preview
                </div>

                <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-900 p-4">
                  <div className="font-black">
                    {renderPreview(
                      draft.titleTemplate,
                    )}
                  </div>

                  <div className="mt-1 text-sm text-slate-300">
                    {renderPreview(
                      draft.bodyTemplate,
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={
                    saving ||
                    !changed
                  }
                  onClick={() =>
                    void save(
                      false,
                    )
                  }
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
                >
                  {saving
                    ? "Saving…"
                    : "Save Changes"}
                </button>

                <button
                  type="button"
                  disabled={
                    saving
                  }
                  onClick={() =>
                    void save(
                      true,
                    )
                  }
                  className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-bold"
                >
                  Restore Default
                </button>

                {changed ? (
                  <button
                    type="button"
                    disabled={
                      saving
                    }
                    onClick={() =>
                      setDraft(
                        saved,
                      )
                    }
                    className="rounded-xl px-5 py-3 text-sm font-bold text-slate-400"
                  >
                    Discard Changes
                  </button>
                ) : null}
              </div>

              <p className="text-xs text-slate-500">
                Default: enabled · {defaults.reminderHours} hours · “
                {defaults.titleTemplate}”
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
