"use client";

import AppNav from "@/components/AppNav";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type SportKey = "nba" | "nfl" | "golf";

type DeviceResult = {
  subscriptionId?: string;
  deviceName?: string;
  status?: "sent" | "failed";
  reason?: string;
  statusCode?: number | null;
};

type HistoryRow = {
  id: string;
  notification_type: string;
  sport: SportKey | null;
  title: string;
  body: string;
  status:
    | "pending"
    | "sent"
    | "partial"
    | "failed"
    | "skipped";
  sent_count: number;
  failed_count: number;
  reason: string | null;
  created_at: string;
  recipientName: string;
  teamName: string | null;
  playerName: string | null;
  slateLabel: string | null;
  metadata: {
    devices?: DeviceResult[];
    [key: string]: unknown;
  } | null;
};

const STATUS_STYLES: Record<string, string> = {
  sent:
    "border-emerald-700 bg-emerald-950/50 text-emerald-300",
  partial:
    "border-amber-700 bg-amber-950/50 text-amber-300",
  failed:
    "border-red-700 bg-red-950/50 text-red-300",
  skipped:
    "border-slate-600 bg-slate-800 text-slate-300",
  pending:
    "border-sky-700 bg-sky-950/50 text-sky-300",
};

function getTypeLabel(row: HistoryRow) {
  if (row.notification_type === "draft_turn") {
    return "Draft Turn";
  }

  if (row.notification_type === "draft_final_pick") {
    return row.sport === "golf"
      ? "Last Draft Pick"
      : "Final Draft Pick";
  }

  if (row.notification_type === "player_finished") {
    return row.sport === "golf"
      ? "Golfer Finished Round"
      : "Player Finished";
  }

  if (row.notification_type === "slate_complete") {
    return row.sport === "golf"
      ? "Tournament Complete"
      : "Slate Complete";
  }

  if (
    row.notification_type === "slate_complete_winner"
  ) {
    return row.sport === "golf"
      ? "Tournament Winner"
      : "Slate Winner";
  }

  if (row.notification_type === "push_test") {
    return "Push Test";
  }

  return row.notification_type;
}

function getSportLabel(sport: SportKey | null) {
  if (sport === "golf") return "⛳ Golf";
  if (sport === "nfl") return "🏈 NFL";
  if (sport === "nba") return "🏀 NBA";
  return "General";
}

export default function NotificationHistoryPage() {
  const [history, setHistory] = useState<HistoryRow[]>(
    []
  );

  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sportFilter, setSportFilter] =
    useState("all");
  const [recipientFilter, setRecipientFilter] =
    useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      setMessage("");

      const params = new URLSearchParams();

      if (typeFilter) {
        params.set("type", typeFilter);
      }

      if (statusFilter) {
        params.set("status", statusFilter);
      }

      if (
        sportFilter &&
        sportFilter !== "all"
      ) {
        params.set("sport", sportFilter);
      }

      const response = await fetch(
        `/api/admin/notification-history?${params.toString()}`,
        { cache: "no-store" }
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error ||
            "Failed to load notification history."
        );
        return;
      }

      setHistory(result.history ?? []);
    } catch (error) {
      console.error(error);
      setMessage(
        "Something went wrong while loading notification history."
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    statusFilter,
    typeFilter,
    sportFilter,
  ]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const visibleHistory = useMemo(() => {
    const search = recipientFilter
      .trim()
      .toLowerCase();

    if (!search) return history;

    return history.filter((row) => {
      const deviceNames =
        row.metadata?.devices?.map(
          (device) => device.deviceName
        ) ?? [];

      return [
        row.recipientName,
        row.teamName,
        row.playerName,
        row.slateLabel,
        ...deviceNames,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value)
            .toLowerCase()
            .includes(search)
        );
    });
  }, [history, recipientFilter]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Notification History
              </h1>

              <p className="mt-2 text-sm leading-6 text-slate-300">
                Review recipients, sports, delivery
                results, skips, failures, and device
                delivery.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={isLoading}
              className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-sky-400 hover:bg-slate-800 disabled:opacity-50"
            >
              {isLoading
                ? "Refreshing…"
                : "Refresh"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <select
              value={sportFilter}
              onChange={(event) =>
                setSportFilter(event.target.value)
              }
              className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-sm text-slate-100"
            >
              <option value="all">All sports</option>
              <option value="nba">NBA</option>
              <option value="nfl">NFL</option>
              <option value="golf">Golf</option>
            </select>

            <select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value)
              }
              className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-sm text-slate-100"
            >
              <option value="">
                All notification types
              </option>
              <option value="draft_turn">
                Draft Turn
              </option>
              <option value="draft_final_pick">
                Final / Last Draft Pick
              </option>
              <option value="player_finished">
                Athlete Finished
              </option>
              <option value="slate_complete">
                Slate / Tournament Complete
              </option>
              <option value="slate_complete_winner">
                Slate / Tournament Winner
              </option>
              <option value="push_test">
                Push Test
              </option>
            </select>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value)
              }
              className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-sm text-slate-100"
            >
              <option value="">All statuses</option>
              <option value="sent">Sent</option>
              <option value="partial">Partial</option>
              <option value="failed">Failed</option>
              <option value="skipped">Skipped</option>
              <option value="pending">Pending</option>
            </select>

            <input
              type="search"
              value={recipientFilter}
              onChange={(event) =>
                setRecipientFilter(
                  event.target.value
                )
              }
              placeholder="Recipient, athlete, slate, or device…"
              className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </div>
        </section>

        {message ? (
          <div className="rounded-2xl border border-red-700 bg-red-950/60 px-4 py-3 text-sm text-red-200">
            {message}
          </div>
        ) : null}

        <section className="space-y-4">
          {isLoading ? (
            <div className="rounded-3xl border border-slate-700 bg-slate-900 p-6 text-sm text-slate-400">
              Loading notification history…
            </div>
          ) : visibleHistory.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-600 bg-slate-900 p-8 text-center text-sm text-slate-400">
              No notification records match these
              filters.
            </div>
          ) : (
            visibleHistory.map((row) => {
              const devices =
                row.metadata?.devices ?? [];

              return (
                <article
                  key={row.id}
                  className="rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-300">
                          {getTypeLabel(row)}
                        </span>

                        <span className="rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300">
                          {getSportLabel(row.sport)}
                        </span>

                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            STATUS_STYLES[
                              row.status
                            ] ??
                            STATUS_STYLES.pending
                          }`}
                        >
                          {row.status}
                        </span>
                      </div>

                      <h2 className="mt-3 text-lg font-semibold text-white">
                        {row.title}
                      </h2>

                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        {row.body}
                      </p>
                    </div>

                    <time className="text-xs text-slate-500">
                      {new Date(
                        row.created_at
                      ).toLocaleString()}
                    </time>
                  </div>

                  <div className="mt-4 grid gap-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <span className="font-semibold text-slate-100">
                        Recipient:
                      </span>{" "}
                      {row.recipientName}
                    </div>

                    <div>
                      <span className="font-semibold text-slate-100">
                        Team:
                      </span>{" "}
                      {row.teamName ?? "—"}
                    </div>

                    <div>
                      <span className="font-semibold text-slate-100">
                        Athlete:
                      </span>{" "}
                      {row.playerName ?? "—"}
                    </div>

                    <div>
                      <span className="font-semibold text-slate-100">
                        Slate:
                      </span>{" "}
                      {row.slateLabel ?? "—"}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white">
                        Device delivery
                      </h3>

                      <div className="text-xs text-slate-400">
                        {row.sent_count} sent ·{" "}
                        {row.failed_count} failed
                      </div>
                    </div>

                    {devices.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-400">
                        No individual device details
                        were recorded.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {devices.map(
                          (device, index) => {
                            const wasSent =
                              device.status === "sent";

                            return (
                              <div
                                key={
                                  device.subscriptionId ??
                                  `${row.id}-device-${index}`
                                }
                                className="flex flex-col gap-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    aria-hidden="true"
                                    className={
                                      wasSent
                                        ? "text-emerald-400"
                                        : "text-red-400"
                                    }
                                  >
                                    {wasSent
                                      ? "✓"
                                      : "✕"}
                                  </span>

                                  <span className="text-sm font-medium text-slate-200">
                                    {device.deviceName ??
                                      "Unknown device"}
                                  </span>
                                </div>

                                <div
                                  className={`text-xs font-semibold ${
                                    wasSent
                                      ? "text-emerald-400"
                                      : "text-red-400"
                                  }`}
                                >
                                  {wasSent
                                    ? "Sent"
                                    : "Failed"}
                                </div>

                                {!wasSent &&
                                device.reason ? (
                                  <div className="text-xs text-red-300 sm:max-w-sm sm:text-right">
                                    {device.reason}
                                    {device.statusCode
                                      ? ` (${device.statusCode})`
                                      : ""}
                                  </div>
                                ) : null}
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}
                  </div>

                  {row.reason ? (
                    <div className="mt-3 text-xs text-slate-400">
                      Overall result: {row.reason}
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
