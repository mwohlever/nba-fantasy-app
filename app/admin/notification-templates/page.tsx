"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Link from "next/link";

import AppNav from "@/components/AppNav";

import NcaaPickEmNotificationControl from "@/components/admin/NcaaPickEmNotificationControl";

import {
  useGroupContext,
} from "@/components/providers/GroupProvider";

import {
  useSelectedSport,
} from "@/components/providers/SportProvider";

import {
  getSportConfig,
} from "@/lib/sports";


type NotificationTemplateType =
  | "draft_turn"
  | "draft_final_pick"
  | "player_finished"
  | "slate_complete"
  | "slate_complete_winner";


type SportKey =
  | "nba"
  | "nfl"
  | "golf";


type NotificationTemplate = {
  notificationType:
    NotificationTemplateType;

  sport:
    SportKey;

  titleTemplate:
    string;

  bodyTemplate:
    string;

  description:
    string;

  availablePlaceholders:
    string[];

  enabled?:
    boolean;

  inherited?:
    boolean;
};


type EditableTemplate = {
  enabled:
    boolean;

  titleTemplate:
    string;

  bodyTemplate:
    string;
};


const TEMPLATE_ORDER:
  NotificationTemplateType[] = [
    "draft_turn",
    "draft_final_pick",
    "player_finished",
    "slate_complete",
    "slate_complete_winner",
  ];


const COMMISSIONER_TOGGLE_TYPES =
  new Set<NotificationTemplateType>([
    "draft_turn",
    "player_finished",
    "slate_complete",
  ]);


const INHERITED_ENABLE_SOURCE:
  Partial<
    Record<
      NotificationTemplateType,
      NotificationTemplateType
    >
  > = {
    draft_final_pick:
      "draft_turn",

    slate_complete_winner:
      "slate_complete",
  };


function emptyDrafts():
  Record<
    NotificationTemplateType,
    EditableTemplate
  > {
  return {
    draft_turn: {
      enabled: true,
      titleTemplate: "",
      bodyTemplate: "",
    },

    draft_final_pick: {
      enabled: true,
      titleTemplate: "",
      bodyTemplate: "",
    },

    player_finished: {
      enabled: true,
      titleTemplate: "",
      bodyTemplate: "",
    },

    slate_complete: {
      enabled: true,
      titleTemplate: "",
      bodyTemplate: "",
    },

    slate_complete_winner: {
      enabled: true,
      titleTemplate: "",
      bodyTemplate: "",
    },
  };
}


function getTemplateLabels(
  sport: SportKey,
  emoji: string,
): Record<
  NotificationTemplateType,
  string
> {
  if (
    sport === "golf"
  ) {
    return {
      draft_turn:
        `${emoji} Draft Turn`,

      draft_final_pick:
        "🏁 Last Draft Pick",

      player_finished:
        `${emoji} Golfer Finished Round`,

      slate_complete:
        "🏆 Tournament Complete",

      slate_complete_winner:
        "🥇 Tournament Winner",
    };
  }


  return {
    draft_turn:
      `${emoji} Draft Turn`,

    draft_final_pick:
      "🏁 Final Draft Pick",

    player_finished:
      `${emoji} Player Finished Game`,

    slate_complete:
      "🏆 Slate Complete",

    slate_complete_winner:
      "🥇 Slate Winner",
  };
}


function getPreviewValues(
  sport: SportKey,
): Record<string, string> {
  if (
    sport === "golf"
  ) {
    return {
      "{teamName}":
        "Josh",

      "{slateLabel}":
        "Rocket Classic",

      "{roundNumber}":
        "4",

      "{roundScore}":
        "-3",

      "{roundOrdinal}":
        "4th",

      "{overallPickNumber}":
        "13",

      "{positionNeed}":
        "golfer",

      "{remainingNeeds}":
        "1 golfer",

      "{playerName}":
        "Scottie Scheffler",

      "{fantasyPoints}":
        "-5",

      "{winnerName}":
        "Josh",

      "{winningScore}":
        "-31",

      "{teamScore}":
        "-24",

      "{finishNumber}":
        "2",

      "{finishOrdinal}":
        "2nd",
    };
  }


  return {
    "{teamName}":
      "Josh",

    "{slateLabel}":
      "2026-07-18",

    "{roundNumber}":
      "4",

    "{roundOrdinal}":
      "4th",

    "{overallPickNumber}":
      "13",

    "{positionNeed}":
      sport === "nfl"
        ? "WR"
        : "F/C",

    "{remainingNeeds}":
      sport === "nfl"
        ? "1 WR"
        : "1 F/C",

    "{playerName}":
      sport === "nfl"
        ? "Ja'Marr Chase"
        : "Anthony Edwards",

    "{fantasyPoints}":
      sport === "nfl"
        ? "27.4"
        : "46.7",

    "{winnerName}":
      "Josh",

    "{winningScore}":
      sport === "nfl"
        ? "146.2"
        : "247.4",

    "{teamScore}":
      sport === "nfl"
        ? "131.8"
        : "231.8",

    "{finishNumber}":
      "2",

    "{finishOrdinal}":
      "2nd",
  };
}


function renderPreview(
  value: string,
  values: Record<string, string>,
  sportEmoji: string,
) {
  return Object.entries({
    ...values,

    "{sportEmoji}":
      sportEmoji,
  }).reduce(
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


function shortMessage(
  value: string,
) {
  if (
    value.length <= 76
  ) {
    return value;
  }

  return `${value.slice(
    0,
    73,
  )}…`;
}


function StandardNotificationControl() {
  const {
    selectedSport,
  } =
    useSelectedSport();

  const {
    groupContext,
  } =
    useGroupContext();


  const activeGroupId =
    groupContext?.group.id ??
    null;


  const sport:
    SportKey =
      selectedSport === "nfl"
        ? "nfl"
        : selectedSport === "golf"
          ? "golf"
          : "nba";


  const sportEmoji =
    getSportConfig(
      sport,
    ).emoji;


  const labels =
    getTemplateLabels(
      sport,
      sportEmoji,
    );


  const previewValues =
    getPreviewValues(
      sport,
    );


  const [
    templates,
    setTemplates,
  ] =
    useState<
      Record<
        NotificationTemplateType,
        NotificationTemplate
      > |
      null
    >(
      null,
    );


  const [
    defaults,
    setDefaults,
  ] =
    useState<
      Record<
        NotificationTemplateType,
        NotificationTemplate
      > |
      null
    >(
      null,
    );


  const [
    drafts,
    setDrafts,
  ] =
    useState<
      Record<
        NotificationTemplateType,
        EditableTemplate
      >
    >(
      emptyDrafts(),
    );


  const [
    editingType,
    setEditingType,
  ] =
    useState<
      NotificationTemplateType |
      null
    >(
      null,
    );


  const [
    loading,
    setLoading,
  ] =
    useState(
      true,
    );


  const [
    savingType,
    setSavingType,
  ] =
    useState<
      NotificationTemplateType |
      null
    >(
      null,
    );


  const [
    savedType,
    setSavedType,
  ] =
    useState<
      NotificationTemplateType |
      null
    >(
      null,
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

          setEditingType(
            null,
          );

          setTemplates(
            null,
          );

          setDefaults(
            null,
          );

          setDrafts(
            emptyDrafts(),
          );


          const response =
            await fetch(
              `/api/admin/notification-templates?sport=${sport}`,
              {
                cache:
                  "no-store",

                signal:
                  controller.signal,
              },
            );


          const result =
            await response.json();


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
                "Unable to load notification settings.",
            );

            return;
          }


          const templateMap =
            Object.fromEntries(
              result.templates.map(
                (
                  template:
                    NotificationTemplate,
                ) => [
                  template.notificationType,
                  template,
                ],
              ),
            ) as
              Record<
                NotificationTemplateType,
                NotificationTemplate
              >;


          const defaultMap =
            Object.fromEntries(
              result.defaults.map(
                (
                  template:
                    NotificationTemplate,
                ) => [
                  template.notificationType,
                  template,
                ],
              ),
            ) as
              Record<
                NotificationTemplateType,
                NotificationTemplate
              >;


          setTemplates(
            templateMap,
          );

          setDefaults(
            defaultMap,
          );


          setDrafts(
            Object.fromEntries(
              TEMPLATE_ORDER.map(
                (
                  type,
                ) => [
                  type,

                  {
                    enabled:
                      templateMap[
                        type
                      ].enabled !== false,

                    titleTemplate:
                      templateMap[
                        type
                      ].titleTemplate,

                    bodyTemplate:
                      templateMap[
                        type
                      ].bodyTemplate,
                  },
                ],
              ),
            ) as
              Record<
                NotificationTemplateType,
                EditableTemplate
              >,
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
            "Unable to load notification settings.",
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
      sport,
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


  const unsavedChanges =
    useMemo(
      () =>
        Object.fromEntries(
          TEMPLATE_ORDER.map(
            (
              type,
            ) => [
              type,

              Boolean(
                templates,
              ) &&
              (
                (
                  COMMISSIONER_TOGGLE_TYPES.has(
                    type,
                  ) &&
                  drafts[
                    type
                  ].enabled !==
                    (
                      templates?.[
                        type
                      ].enabled !== false
                    )
                ) ||
                drafts[
                  type
                ].titleTemplate !==
                  templates?.[
                    type
                  ].titleTemplate ||
                drafts[
                  type
                ].bodyTemplate !==
                  templates?.[
                    type
                  ].bodyTemplate
              ),
            ],
          ),
        ) as
          Record<
            NotificationTemplateType,
            boolean
          >,
      [
        drafts,
        templates,
      ],
    );


  function updateDraft(
    type:
      NotificationTemplateType,

    patch:
      Partial<EditableTemplate>,
  ) {
    setDrafts(
      (
        current,
      ) => ({
        ...current,

        [type]: {
          ...current[
            type
          ],

          ...patch,
        },
      }),
    );


    if (
      savedType === type
    ) {
      setSavedType(
        null,
      );
    }
  }


  function effectiveEnabled(
    type:
      NotificationTemplateType,
  ) {
    const inheritedFrom =
      INHERITED_ENABLE_SOURCE[
        type
      ];


    if (
      inheritedFrom
    ) {
      return drafts[
        inheritedFrom
      ].enabled;
    }


    return drafts[
      type
    ].enabled;
  }


  async function quickToggle(
    type:
      NotificationTemplateType,

    enabled:
      boolean,
  ) {
    if (
      !COMMISSIONER_TOGGLE_TYPES.has(
        type,
      ) ||
      savingType
    ) {
      return;
    }


    const previousDraft =
      drafts[
        type
      ];


    /*
     * Optimistic UI:
     * reflect the toggle immediately, then persist it.
     */
    setDrafts(
      (
        current,
      ) => ({
        ...current,

        [type]: {
          ...current[
            type
          ],

          enabled,
        },
      }),
    );


    setSavingType(
      type,
    );

    setMessage(
      "",
    );


    try {
      const response =
        await fetch(
          "/api/admin/notification-templates",
          {
            method:
              "PUT",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                notificationType:
                  type,

                sport,

                enabled,

                titleTemplate:
                  previousDraft
                    .titleTemplate,

                bodyTemplate:
                  previousDraft
                    .bodyTemplate,

                resetToDefault:
                  false,
              }),
          },
        );


      const result =
        await response.json();


      if (
        !response.ok
      ) {
        /*
         * Roll back the optimistic switch if save fails.
         */
        setDrafts(
          (
            current,
          ) => ({
            ...current,

            [type]:
              previousDraft,
          }),
        );


        setMessage(
          result.error ??
            "Unable to update notification setting.",
        );

        return;
      }


      const savedTemplate =
        result.template as
          NotificationTemplate;


      setTemplates(
        (
          current,
        ) =>
          current
            ? {
                ...current,

                [type]:
                  savedTemplate,
              }
            : current,
      );


      setDrafts(
        (
          current,
        ) => ({
          ...current,

          [type]: {
            enabled:
              savedTemplate.enabled !==
              false,

            titleTemplate:
              savedTemplate.titleTemplate,

            bodyTemplate:
              savedTemplate.bodyTemplate,
          },
        }),
      );


      setMessage(
        `${labels[type]} ${
          enabled
            ? "enabled"
            : "disabled"
        } for this league.`,
      );
    } catch (
      error
    ) {
      console.error(
        error,
      );


      setDrafts(
        (
          current,
        ) => ({
          ...current,

          [type]:
            previousDraft,
        }),
      );


      setMessage(
        "Unable to update notification setting.",
      );
    } finally {
      setSavingType(
        null,
      );
    }
  }


  async function saveTemplate(
    type:
      NotificationTemplateType,

    resetToDefault =
      false,
  ) {
    try {
      setSavingType(
        type,
      );

      setMessage(
        "",
      );


      const draft =
        drafts[
          type
        ];


      const response =
        await fetch(
          "/api/admin/notification-templates",
          {
            method:
              "PUT",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                notificationType:
                  type,

                sport,

                enabled:
                  draft.enabled,

                titleTemplate:
                  draft.titleTemplate,

                bodyTemplate:
                  draft.bodyTemplate,

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
            "Unable to save notification settings.",
        );

        return;
      }


      const savedTemplate =
        result.template as
          NotificationTemplate;


      setTemplates(
        (
          current,
        ) =>
          current
            ? {
                ...current,

                [type]:
                  savedTemplate,
              }
            : current,
      );


      setDrafts(
        (
          current,
        ) => ({
          ...current,

          [type]: {
            enabled:
              savedTemplate.enabled !== false,

            titleTemplate:
              savedTemplate.titleTemplate,

            bodyTemplate:
              savedTemplate.bodyTemplate,
          },
        }),
      );


      setSavedType(
        type,
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
          () => {
            setSavedType(
              (
                current,
              ) =>
                current === type
                  ? null
                  : current,
            );
          },
          1800,
        );


      setMessage(
        resetToDefault
          ? `${labels[type]} restored to platform defaults.`
          : `${labels[type]} saved for this league.`,
      );
    } catch (
      error
    ) {
      console.error(
        error,
      );

      setMessage(
        "Unable to save notification settings.",
      );
    } finally {
      setSavingType(
        null,
      );
    }
  }


  function discardChanges(
    type:
      NotificationTemplateType,
  ) {
    const saved =
      templates?.[
        type
      ];


    if (
      !saved
    ) {
      return;
    }


    setDrafts(
      (
        current,
      ) => ({
        ...current,

        [type]: {
          enabled:
            saved.enabled !== false,

          titleTemplate:
            saved.titleTemplate,

          bodyTemplate:
            saved.bodyTemplate,
        },
      }),
    );
  }


  function appendPlaceholder(
    type:
      NotificationTemplateType,

    placeholder:
      string,
  ) {
    const current =
      drafts[
        type
      ].bodyTemplate;


    const separator =
      !current ||
      current.endsWith(
        " ",
      )
        ? ""
        : " ";


    updateDraft(
      type,
      {
        bodyTemplate:
          `${current}${separator}${placeholder}`,
      },
    );
  }


  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-4">
        <AppNav />


        <header className="px-1 py-2">
          <Link
            href={`/admin?sport=${sport}`}
            className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:underline"
          >
            ← Commissioner Center
          </Link>

          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Notification Controls
          </h1>

          <p className="mt-1 text-sm text-slate-600">
            Manage league-level notification rules and wording.
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
        !templates ||
        !defaults ? (
          <div className="border-y border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">
            Loading notification settings…
          </div>
        ) : (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

            <div className="hidden grid-cols-[minmax(180px,1.1fr)_120px_minmax(220px,1fr)_72px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 sm:grid">
              <div>
                Notification
              </div>

              <div>
                Status
              </div>

              <div>
                Message
              </div>

              <div className="text-right">
                Action
              </div>
            </div>


            {TEMPLATE_ORDER.map(
              (
                type,
              ) => {
                const template =
                  templates[
                    type
                  ];

                const draft =
                  drafts[
                    type
                  ];

                const defaultTemplate =
                  defaults[
                    type
                  ];

                const inheritedFrom =
                  INHERITED_ENABLE_SOURCE[
                    type
                  ];

                const enabled =
                  effectiveEnabled(
                    type,
                  );

                const editing =
                  editingType ===
                  type;

                const saving =
                  savingType ===
                  type;

                const justSaved =
                  savedType ===
                  type;


                return (
                  <div
                    key={
                      type
                    }
                    className="border-b border-slate-200 last:border-b-0"
                  >
                    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(180px,1.1fr)_120px_minmax(220px,1fr)_72px] sm:items-center sm:gap-4">

                      <div>
                        <div className="font-semibold">
                          {
                            labels[
                              type
                            ]
                          }
                        </div>

                        <div className="mt-0.5 text-xs text-slate-500">
                          {
                            template.description
                          }
                        </div>
                      </div>


                      <div>
                        {inheritedFrom ? (
                          <div className="space-y-1">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                                enabled
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-200 text-slate-600"
                              }`}
                            >
                              {enabled
                                ? "ON"
                                : "OFF"}
                            </span>

                            <div className="text-[11px] leading-4 text-slate-500">
                              Inherits{" "}
                              {
                                labels[
                                  inheritedFrom
                                ]
                              }
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={
                              savingType ===
                              type
                            }
                            onClick={() =>
                              void quickToggle(
                                type,
                                !draft.enabled,
                              )
                            }
                            aria-pressed={
                              draft.enabled
                            }
                            aria-label={`${
                              draft.enabled
                                ? "Disable"
                                : "Enable"
                            } ${labels[type]}`}
                            title={
                              draft.enabled
                                ? "Click to turn off"
                                : "Click to turn on"
                            }
                            className="inline-flex items-center gap-2 disabled:cursor-wait disabled:opacity-60"
                          >
                            <span
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                                draft.enabled
                                  ? "bg-emerald-500"
                                  : "bg-slate-300"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                  draft.enabled
                                    ? "translate-x-[22px]"
                                    : "translate-x-0.5"
                                }`}
                              />
                            </span>

                            <span
                              className={`min-w-7 text-left text-xs font-bold ${
                                draft.enabled
                                  ? "text-emerald-700"
                                  : "text-slate-500"
                              }`}
                            >
                              {savingType ===
                              type
                                ? "…"
                                : draft.enabled
                                  ? "ON"
                                  : "OFF"}
                            </span>
                          </button>
                        )}
                      </div>


                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800">
                          {
                            draft.titleTemplate
                          }
                        </div>

                        <div className="mt-0.5 truncate text-xs text-slate-500">
                          {shortMessage(
                            draft.bodyTemplate,
                          )}
                        </div>
                      </div>


                      <div className="sm:text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingType(
                              editing
                                ? null
                                : type,
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
                            {COMMISSIONER_TOGGLE_TYPES.has(
                              type,
                            ) ? (
                              <label className="flex items-center gap-3 text-sm font-medium">
                                <input
                                  type="checkbox"
                                  checked={
                                    draft.enabled
                                  }
                                  disabled={
                                    savingType ===
                                    type
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    void quickToggle(
                                      type,
                                      event.target.checked,
                                    )
                                  }
                                  className="h-4 w-4"
                                />

                                Send this notification
                              </label>
                            ) : inheritedFrom ? (
                              <div
                                className={`rounded-lg border px-3 py-2 text-sm ${
                                  enabled
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-slate-300 bg-slate-100 text-slate-600"
                                }`}
                              >
                                <strong>
                                  {enabled
                                    ? "Enabled"
                                    : "Disabled"}
                                </strong>
                                {" "}because{" "}
                                <strong>
                                  {
                                    labels[
                                      inheritedFrom
                                    ]
                                  }
                                </strong>
                                {" "}is{" "}
                                {enabled
                                  ? "enabled"
                                  : "disabled"}.
                              </div>
                            ) : null}


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
                                  updateDraft(
                                    type,
                                    {
                                      titleTemplate:
                                        event.target.value,
                                    },
                                  )
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
                                  updateDraft(
                                    type,
                                    {
                                      bodyTemplate:
                                        event.target.value,
                                    },
                                  )
                                }
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                              />
                            </div>


                            <div>
                              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                Placeholders
                              </div>

                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {template
                                  .availablePlaceholders
                                  .map(
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
                                            type,
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
                                  !unsavedChanges[
                                    type
                                  ]
                                }
                                onClick={() =>
                                  void saveTemplate(
                                    type,
                                    false,
                                  )
                                }
                                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                                  unsavedChanges[
                                    type
                                  ]
                                    ? "bg-sky-600 text-white hover:bg-sky-700 disabled:bg-sky-400"
                                    : "bg-emerald-600 text-white"
                                }`}
                              >
                                {saving
                                  ? "Saving…"
                                  : unsavedChanges[
                                        type
                                      ]
                                    ? "Save Changes"
                                    : "Saved ✓"}
                              </button>


                              <button
                                type="button"
                                disabled={
                                  saving
                                }
                                onClick={() =>
                                  void saveTemplate(
                                    type,
                                    true,
                                  )
                                }
                                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
                              >
                                Restore Default
                              </button>


                              {unsavedChanges[
                                type
                              ] ? (
                                <button
                                  type="button"
                                  disabled={
                                    saving
                                  }
                                  onClick={() =>
                                    discardChanges(
                                      type,
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
                                    previewValues,
                                    sportEmoji,
                                  )}
                                </div>

                                <div className="mt-1 text-xs leading-5 text-slate-600">
                                  {renderPreview(
                                    draft.bodyTemplate,
                                    previewValues,
                                    sportEmoji,
                                  )}
                                </div>
                              </div>
                            </div>


                            <div className="text-[11px] leading-4 text-slate-400">
                              Platform default:
                              <div className="mt-1 font-medium text-slate-500">
                                {
                                  defaultTemplate.titleTemplate
                                }
                              </div>
                            </div>
                          </aside>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              },
            )}
          </section>
        )}
      </div>
    </main>
  );
}


export default function NotificationTemplatesPage() {
  const {
    selectedSport,
  } =
    useSelectedSport();


  if (
    selectedSport === "ncaa"
  ) {
    return (
      <NcaaPickEmNotificationControl />
    );
  }


  if (
    selectedSport === "nba-skins" ||
    selectedSport === "nba_skins"
  ) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
        <div className="mx-auto max-w-6xl space-y-4">
          <AppNav />

          <header className="px-1 py-2">
            <Link
              href="/admin?sport=nba-skins"
              className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:underline"
            >
              ← Commissioner Center
            </Link>

            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">
              🏀 NBA Skins
            </div>

            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              Notification Controls
            </h1>

            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              NBA Skins does not use automated draft or game notifications.
            </p>
          </header>
        </div>
      </main>
    );
  }


  return (
    <StandardNotificationControl />
  );
}
