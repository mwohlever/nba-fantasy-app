"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Link from "next/link";

import AppNav from "@/components/AppNav";

import {
  useGroupContext,
} from "@/components/providers/GroupProvider";


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
  const {
    groupContext,
  } =
    useGroupContext();


  const activeGroupId =
    groupContext?.group.id ??
    null;


  const [
    saved,
    setSaved,
  ] =
    useState<
      Settings |
      null
    >(
      null,
    );


  const [
    defaults,
    setDefaults,
  ] =
    useState<
      Settings |
      null
    >(
      null,
    );


  const [
    draft,
    setDraft,
  ] =
    useState<
      Settings |
      null
    >(
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
    justSaved,
    setJustSaved,
  ] =
    useState(
      false,
    );


  const [
    editing,
    setEditing,
  ] =
    useState(
      false,
    );


  const [
    message,
    setMessage,
  ] =
    useState(
      "",
    );


  const savedTimer =
    useRef<
      ReturnType<typeof setTimeout> |
      null
    >(
      null,
    );


  useEffect(
    () => {
      const controller =
        new AbortController();


      async function load() {
        if (
          !activeGroupId
        ) {
          return;
        }


        try {
          setLoading(
            true,
          );

          setMessage(
            "",
          );

          setEditing(
            false,
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
            await response.json() as Payload;


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
        } catch (
          error
        ) {
          if (
            error instanceof DOMException &&
            error.name === "AbortError"
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
    },
    [
      activeGroupId,
    ],
  );


  useEffect(
    () =>
      () => {
        if (
          savedTimer.current
        ) {
          clearTimeout(
            savedTimer.current,
          );
        }
      },
    [],
  );


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


  function update(
    patch:
      Partial<Settings>,
  ) {
    if (
      !draft
    ) {
      return;
    }


    setDraft({
      ...draft,
      ...patch,
    });


    setJustSaved(
      false,
    );
  }


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

      setMessage(
        "",
      );


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

      setJustSaved(
        true,
      );


      if (
        savedTimer.current
      ) {
        clearTimeout(
          savedTimer.current,
        );
      }


      savedTimer.current =
        setTimeout(
          () =>
            setJustSaved(
              false,
            ),
          1800,
        );


      setMessage(
        resetToDefault
          ? "Pick 'Em reminder settings restored to platform defaults."
          : "Pick 'Em reminder settings saved for this league.",
      );
    } catch (
      error
    ) {
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
    placeholder:
      string,
  ) {
    if (
      !draft
    ) {
      return;
    }


    const separator =
      !draft.bodyTemplate ||
      draft.bodyTemplate.endsWith(
        " ",
      )
        ? ""
        : " ";


    update({
      bodyTemplate:
        `${draft.bodyTemplate}${separator}${placeholder}`,
    });
  }


  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-4">
        <AppNav />


        <header className="px-1 py-2">
          <Link
            href="/admin?sport=ncaa"
            className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:underline"
          >
            ← Commissioner Center
          </Link>

          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">
            NCAA Pick &apos;Em
          </div>

          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Notification Controls
          </h1>

          <p className="mt-1 text-sm text-slate-600">
            Manage the reminder sent when users still have picks to submit.
          </p>
        </header>


        {message ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              message
                .toLowerCase()
                .includes(
                  "saved",
                ) ||
              message
                .toLowerCase()
                .includes(
                  "restored",
                )
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        ) : null}


        {loading ||
        !draft ||
        !saved ||
        !defaults ? (
          <div className="border-y border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">
            Loading Pick &apos;Em notification settings…
          </div>
        ) : (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

            <div className="hidden grid-cols-[minmax(180px,1fr)_90px_130px_minmax(220px,1fr)_70px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 sm:grid">
              <div>
                Notification
              </div>

              <div>
                Status
              </div>

              <div>
                Timing
              </div>

              <div>
                Message
              </div>

              <div className="text-right">
                Action
              </div>
            </div>


            <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(180px,1fr)_90px_130px_minmax(220px,1fr)_70px] sm:items-center sm:gap-4">

              <div>
                <div className="font-semibold">
                  🏈 Pick &apos;Em Reminder
                </div>

                <div className="mt-0.5 text-xs text-slate-500">
                  Sent once when a weekly card is incomplete.
                </div>
              </div>


              <div>
                <span
                  className={`inline-flex min-w-16 justify-center rounded-full px-3 py-1.5 text-xs font-bold ${
                    draft.enabled
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {draft.enabled
                    ? "ON"
                    : "OFF"}
                </span>
              </div>


              <div className="text-sm text-slate-700">
                {
                  draft.reminderHours
                }h before lock
              </div>


              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {
                    draft.titleTemplate
                  }
                </div>

                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {
                    draft.bodyTemplate
                  }
                </div>
              </div>


              <div className="sm:text-right">
                <button
                  type="button"
                  onClick={() =>
                    setEditing(
                      (
                        current,
                      ) =>
                        !current,
                    )
                  }
                  className="text-sm font-semibold text-sky-700 hover:underline"
                >
                  {editing
                    ? "Close"
                    : "Edit"}
                </button>
              </div>
            </div>


            {editing ? (
              <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">

                  <div className="space-y-4">
                    <label className="flex items-center gap-3 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={
                          draft.enabled
                        }
                        onChange={(
                          event,
                        ) =>
                          update({
                            enabled:
                              event.target.checked,
                          })
                        }
                        className="h-4 w-4"
                      />

                      Send this reminder
                    </label>


                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Hours before lock
                      </label>

                      <input
                        type="number"
                        min={
                          1
                        }
                        max={
                          168
                        }
                        step={
                          1
                        }
                        value={
                          draft.reminderHours
                        }
                        onChange={(
                          event,
                        ) =>
                          update({
                            reminderHours:
                              Number(
                                event.target.value,
                              ),
                          })
                        }
                        className="mt-1 block w-32 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                      />
                    </div>


                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Title
                      </label>

                      <input
                        value={
                          draft.titleTemplate
                        }
                        maxLength={
                          100
                        }
                        onChange={(
                          event,
                        ) =>
                          update({
                            titleTemplate:
                              event.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                      />
                    </div>


                    <div>
                      <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Message
                      </label>

                      <textarea
                        value={
                          draft.bodyTemplate
                        }
                        maxLength={
                          240
                        }
                        rows={
                          3
                        }
                        onChange={(
                          event,
                        ) =>
                          update({
                            bodyTemplate:
                              event.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                      />
                    </div>


                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Placeholders
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
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
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] text-slate-600"
                            >
                              {
                                placeholder
                              }
                            </button>
                          ),
                        )}
                      </div>
                    </div>


                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={
                          saving ||
                          (
                            !changed &&
                            !justSaved
                          )
                        }
                        onClick={() =>
                          void save(
                            false,
                          )
                        }
                        className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                          justSaved
                            ? "bg-emerald-600 text-white"
                            : "bg-sky-600 text-white disabled:bg-slate-300"
                        }`}
                      >
                        {saving
                          ? "Saving…"
                          : justSaved
                            ? "Saved ✓"
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
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
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
                          className="px-3 py-2 text-sm font-medium text-slate-500"
                        >
                          Discard
                        </button>
                      ) : null}
                    </div>
                  </div>


                  <aside className="space-y-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Preview
                      </div>

                      <div className="mt-1 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-sm font-semibold">
                          {renderPreview(
                            draft.titleTemplate,
                          )}
                        </div>

                        <div className="mt-1 text-xs leading-5 text-slate-600">
                          {renderPreview(
                            draft.bodyTemplate,
                          )}
                        </div>
                      </div>
                    </div>


                    <div className="text-[11px] leading-4 text-slate-400">
                      Platform default:
                      <div className="mt-1 font-medium text-slate-500">
                        {
                          defaults.reminderHours
                        }h · {
                          defaults.titleTemplate
                        }
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
