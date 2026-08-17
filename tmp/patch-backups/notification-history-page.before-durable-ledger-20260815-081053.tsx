"use client";

import AppNav from "@/components/AppNav";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type SportKey = "nba" | "nfl" | "golf";

type DeliveryStatus =
  | "waiting"
  | "missed"
  | "pending"
  | "sent"
  | "partial"
  | "failed"
  | "skipped";

type DeviceResult = {
  subscriptionId?: string;
  deviceName?: string;
  status?: "sent" | "failed";
  reason?: string;
  statusCode?: number | null;
};

type HistoryRow = {
  id: string;
  event_key: string;
  notification_type: string;
  user_id: string | null;
  team_id: number | null;
  slate_id: number | null;
  player_id: number | null;
  sport: SportKey | null;
  title: string;
  body: string;
  status: DeliveryStatus;
  sent_count: number;
  failed_count: number;
  skipped?: boolean;
  reason: string | null;
  created_at: string;
  completed_at: string | null;
  recipientName: string;
  teamName: string | null;
  playerName: string | null;
  slateLabel: string | null;
  metadata: {
    devices?: DeviceResult[];
    [key: string]: unknown;
  } | null;
};

type Summary = {
  total: number;
  sent: number;
  partial: number;
  failed: number;
  skipped: number;
  pending: number;
  waiting: number;
  missed: number;
  devicesSent: number;
  devicesFailed: number;
};

const EMPTY_SUMMARY: Summary = {
  total: 0,
  sent: 0,
  partial: 0,
  failed: 0,
  skipped: 0,
  pending: 0,
  waiting: 0,
  missed: 0,
  devicesSent: 0,
  devicesFailed: 0,
};

const STATUS_STYLES: Record<
  DeliveryStatus,
  string
> = {
  waiting:
    "border-sky-700 bg-sky-950/50 text-sky-300",
  missed:
    "border-red-700 bg-red-950/60 text-red-200",
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
      ? "Golfer Finished"
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

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function dateRangeForKey(dateKey: string) {
  const [year, month, day] = dateKey
    .split("-")
    .map(Number);

  const start = new Date(
    year,
    month - 1,
    day,
    0,
    0,
    0,
    0
  );

  const end = new Date(
    year,
    month - 1,
    day + 1,
    0,
    0,
    0,
    0
  );

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function buildDateOptions() {
  const today = new Date();

  return Array.from(
    { length: 30 },
    (_, index) => {
      const date = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - index
      );

      const key = localDateKey(date);

      let label = date.toLocaleDateString(
        undefined,
        {
          weekday: "short",
          month: "short",
          day: "numeric",
          year:
            date.getFullYear() !==
            today.getFullYear()
              ? "numeric"
              : undefined,
        }
      );

      if (index === 0) {
        label = `Today · ${label}`;
      } else if (index === 1) {
        label = `Yesterday · ${label}`;
      }

      return {
        key,
        label,
      };
    }
  );
}

function formatTime(
  value: string,
  isExpected = false
) {
  if (isExpected) {
    return "—";
  }

  return new Date(value).toLocaleTimeString(
    undefined,
    {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-1 text-2xl font-black text-white">
        {value}
      </div>

      {detail ? (
        <div className="mt-1 text-xs text-slate-400">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export default function NotificationHistoryPage() {
  const dateOptions = useMemo(
    () => buildDateOptions(),
    []
  );

  const [selectedDate, setSelectedDate] =
    useState(() => localDateKey(new Date()));

  const [history, setHistory] = useState<
    HistoryRow[]
  >([]);

  const [summary, setSummary] =
    useState<Summary>(EMPTY_SUMMARY);

  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] =
    useState("");
  const [sportFilter, setSportFilter] =
    useState("all");
  const [searchFilter, setSearchFilter] =
    useState("");

  const [expandedRows, setExpandedRows] =
    useState<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [
    actionRowId,
    setActionRowId,
  ] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      setMessage("");

      const params = new URLSearchParams();

      const range =
        dateRangeForKey(selectedDate);

      params.set("start", range.start);
      params.set("end", range.end);

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
        {
          cache: "no-store",
        }
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
      setSummary(
        result.summary ?? EMPTY_SUMMARY
      );
      setExpandedRows(new Set());
    } catch (error) {
      console.error(error);

      setMessage(
        "Something went wrong while loading notification history."
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    selectedDate,
    statusFilter,
    typeFilter,
    sportFilter,
  ]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const visibleHistory = useMemo(() => {
    const search =
      searchFilter.trim().toLowerCase();

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
        row.title,
        row.body,
        row.event_key,
        row.reason,
        ...deviceNames,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value)
            .toLowerCase()
            .includes(search)
        );
    });
  }, [history, searchFilter]);

  async function runRecoveryAction(
    row: HistoryRow,
    action: "send" | "retry"
  ) {
    if (actionRowId) {
      return;
    }

    try {
      setActionRowId(row.id);
      setMessage("");

      const response = await fetch(
        "/api/admin/notification-history/action",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            action,
            historyId:
              row.id.startsWith(
                "expected:"
              )
                ? null
                : row.id,
            eventKey:
              row.event_key,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error ||
            "Notification recovery failed."
        );
        return;
      }

      await loadHistory();
    } catch (error) {
      console.error(error);

      setMessage(
        "Something went wrong while recovering the notification."
      );
    } finally {
      setActionRowId(null);
    }
  }

  function toggleRow(id: string) {
    setExpandedRows((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 text-slate-100 sm:px-4 sm:py-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <AppNav />

        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-400">
                Admin Operations
              </div>

              <h1 className="mt-1 text-3xl font-black tracking-tight">
                Notification Monitor
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Expected-event and delivery audit for 111 Sports.
                Golf round-finished notifications appear here before
                delivery, making missing triggers visible alongside
                successful and failed pushes.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={isLoading}
              className="rounded-xl border border-slate-600 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-sky-400 hover:bg-slate-800 disabled:opacity-50"
            >
              {isLoading
                ? "Refreshing…"
                : "Refresh"}
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
          <SummaryCard
            label="Expected"
            value={summary.total}
          />

          <SummaryCard
            label="Waiting"
            value={summary.waiting}
          />

          <SummaryCard
            label="Missed"
            value={summary.missed}
          />

          <SummaryCard
            label="Sent"
            value={summary.sent}
          />

          <SummaryCard
            label="Partial"
            value={summary.partial}
          />

          <SummaryCard
            label="Failed"
            value={summary.failed}
          />

          <SummaryCard
            label="Skipped"
            value={summary.skipped}
          />

          <SummaryCard
            label="Pending"
            value={summary.pending}
          />

          <SummaryCard
            label="Devices"
            value={summary.devicesSent}
            detail={
              summary.devicesFailed > 0
                ? `${summary.devicesFailed} failed`
                : "0 failed"
            }
          />
        </section>

        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Date
              </span>

              <select
                value={selectedDate}
                onChange={(event) =>
                  setSelectedDate(
                    event.target.value
                  )
                }
                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"
              >
                {dateOptions.map((option) => (
                  <option
                    key={option.key}
                    value={option.key}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Sport
              </span>

              <select
                value={sportFilter}
                onChange={(event) =>
                  setSportFilter(
                    event.target.value
                  )
                }
                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"
              >
                <option value="all">
                  All sports
                </option>
                <option value="nba">NBA</option>
                <option value="nfl">NFL</option>
                <option value="golf">Golf</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Type
              </span>

              <select
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(
                    event.target.value
                  )
                }
                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"
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
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Status
              </span>

              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value
                  )
                }
                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"
              >
                <option value="">
                  All statuses
                </option>
                <option value="waiting">
                  Waiting
                </option>
                <option value="missed">
                  Missed
                </option>
                <option value="sent">
                  Sent
                </option>
                <option value="partial">
                  Partial
                </option>
                <option value="failed">
                  Failed
                </option>
                <option value="skipped">
                  Skipped
                </option>
                <option value="pending">
                  Pending
                </option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Search
              </span>

              <input
                type="search"
                value={searchFilter}
                onChange={(event) =>
                  setSearchFilter(
                    event.target.value
                  )
                }
                placeholder="Person, athlete, event…"
                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600"
              />
            </label>
          </div>
        </section>

        {message ? (
          <div className="rounded-2xl border border-red-700 bg-red-950/60 px-4 py-3 text-sm text-red-200">
            {message}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-sm">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-slate-400">
              Loading notification monitor…
            </div>
          ) : visibleHistory.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              No notification records match
              this date and filter set.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1200px] w-full border-collapse text-left text-xs">
                <thead className="bg-slate-950 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3">
                      Time
                    </th>
                    <th className="px-3 py-3">
                      Sport
                    </th>
                    <th className="px-3 py-3">
                      Type
                    </th>
                    <th className="px-3 py-3">
                      Recipient
                    </th>
                    <th className="px-3 py-3">
                      Athlete
                    </th>
                    <th className="px-3 py-3">
                      Event
                    </th>
                    <th className="px-3 py-3">
                      Status
                    </th>
                    <th className="px-3 py-3 text-center">
                      Sent
                    </th>
                    <th className="px-3 py-3 text-center">
                      Failed
                    </th>
                    <th className="px-3 py-3">
                      Result
                    </th>
                    <th className="px-3 py-3 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {visibleHistory.map((row) => {
                    const expanded =
                      expandedRows.has(row.id);

                    const devices =
                      row.metadata?.devices ?? [];

                    return (
                      <Fragment key={row.id}>
                        <tr
                          className="border-t border-slate-800 align-top hover:bg-slate-800/50"
                        >
                          <td className="whitespace-nowrap px-3 py-3 font-mono text-slate-300">
                            {formatTime(
                              row.created_at,
                              row.id.startsWith(
                                "expected:"
                              )
                            )}
                          </td>

                          <td className="whitespace-nowrap px-3 py-3">
                            {getSportLabel(
                              row.sport
                            )}
                          </td>

                          <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-200">
                            {getTypeLabel(row)}
                          </td>

                          <td className="px-3 py-3">
                            <div className="font-semibold text-white">
                              {
                                row.recipientName
                              }
                            </div>

                            {row.teamName &&
                            row.teamName !==
                              row.recipientName ? (
                              <div className="mt-0.5 text-[10px] text-slate-500">
                                {row.teamName}
                              </div>
                            ) : null}
                          </td>

                          <td className="px-3 py-3 text-slate-300">
                            {row.playerName ??
                              "—"}
                          </td>

                          <td className="max-w-[220px] px-3 py-3 text-slate-300">
                            <div className="truncate">
                              {row.slateLabel ??
                                "—"}
                            </div>
                          </td>

                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${
                                STATUS_STYLES[
                                  row.status
                                ]
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>

                          <td className="px-3 py-3 text-center font-mono text-emerald-300">
                            {row.sent_count}
                          </td>

                          <td className="px-3 py-3 text-center font-mono text-red-300">
                            {row.failed_count}
                          </td>

                          <td className="max-w-[260px] px-3 py-3 text-slate-400">
                            <div className="truncate">
                              {row.reason ??
                                (row.status ===
                                "sent"
                                  ? "Delivered"
                                  : row.status ===
                                      "waiting"
                                    ? "Awaiting event"
                                    : row.status ===
                                        "missed"
                                      ? "Expected event missing"
                                      : "—")}
                            </div>
                          </td>

                          <td className="px-3 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {row.status ===
                              "missed" ? (
                                <button
                                  type="button"
                                  disabled={
                                    actionRowId !==
                                    null
                                  }
                                  onClick={() =>
                                    void runRecoveryAction(
                                      row,
                                      "send"
                                    )
                                  }
                                  className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {actionRowId ===
                                  row.id
                                    ? "Sending…"
                                    : "Send"}
                                </button>
                              ) : null}

                              {row.status ===
                              "failed" ? (
                                <button
                                  type="button"
                                  disabled={
                                    actionRowId !==
                                    null
                                  }
                                  onClick={() =>
                                    void runRecoveryAction(
                                      row,
                                      "retry"
                                    )
                                  }
                                  className="rounded-lg border border-amber-700 bg-amber-950/40 px-2.5 py-1.5 text-[11px] font-bold text-amber-300 hover:bg-amber-950 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {actionRowId ===
                                  row.id
                                    ? "Retrying…"
                                    : "Retry"}
                                </button>
                              ) : null}

                              <button
                                type="button"
                                onClick={() =>
                                  toggleRow(
                                    row.id
                                  )
                                }
                                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 hover:border-sky-600"
                              >
                                {expanded
                                  ? "Hide"
                                  : "Details"}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {expanded ? (
                          <tr
                            key={`${row.id}-detail`}
                            className="border-t border-slate-800 bg-slate-950/70"
                          >
                            <td
                              colSpan={11}
                              className="px-4 py-4"
                            >
                              <div className="grid gap-4 lg:grid-cols-3">
                                <div>
                                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                    Notification
                                  </div>

                                  <div className="mt-2 font-semibold text-white">
                                    {row.title}
                                  </div>

                                  <div className="mt-1 text-sm leading-5 text-slate-300">
                                    {row.body}
                                  </div>
                                </div>

                                <div className="space-y-1 font-mono text-[11px] text-slate-400">
                                  <div>
                                    Event key:{" "}
                                    <span className="text-slate-200">
                                      {
                                        row.event_key
                                      }
                                    </span>
                                  </div>

                                  <div>
                                    History ID:{" "}
                                    <span className="text-slate-200">
                                      {row.id}
                                    </span>
                                  </div>

                                  <div>
                                    User ID:{" "}
                                    <span className="text-slate-200">
                                      {row.user_id ??
                                        "—"}
                                    </span>
                                  </div>

                                  <div>
                                    Team ID:{" "}
                                    <span className="text-slate-200">
                                      {row.team_id ??
                                        "—"}
                                    </span>
                                  </div>

                                  <div>
                                    Player ID:{" "}
                                    <span className="text-slate-200">
                                      {row.player_id ??
                                        "—"}
                                    </span>
                                  </div>

                                  <div>
                                    Slate ID:{" "}
                                    <span className="text-slate-200">
                                      {row.slate_id ??
                                        "—"}
                                    </span>
                                  </div>

                                  <div>
                                    Created:{" "}
                                    <span className="text-slate-200">
                                      {new Date(
                                        row.created_at
                                      ).toLocaleString()}
                                    </span>
                                  </div>

                                  <div>
                                    Completed:{" "}
                                    <span className="text-slate-200">
                                      {row.completed_at
                                        ? new Date(
                                            row.completed_at
                                          ).toLocaleString()
                                        : "—"}
                                    </span>
                                  </div>
                                </div>

                                <div>
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                      Device delivery
                                    </div>

                                    <div className="text-[10px] text-slate-500">
                                      {row.sent_count} sent
                                      ·{" "}
                                      {
                                        row.failed_count
                                      }{" "}
                                      failed
                                    </div>
                                  </div>

                                  {devices.length ===
                                  0 ? (
                                    <div className="mt-2 text-xs text-slate-500">
                                      No individual
                                      device details
                                      recorded.
                                    </div>
                                  ) : (
                                    <div className="mt-2 space-y-1.5">
                                      {devices.map(
                                        (
                                          device,
                                          index
                                        ) => (
                                          <div
                                            key={
                                              device.subscriptionId ??
                                              `${row.id}-${index}`
                                            }
                                            className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs"
                                          >
                                            <div>
                                              <div className="font-semibold text-slate-200">
                                                {device.deviceName ??
                                                  "Unknown device"}
                                              </div>

                                              {device.reason ? (
                                                <div className="mt-0.5 text-[10px] text-red-300">
                                                  {
                                                    device.reason
                                                  }
                                                  {device.statusCode
                                                    ? ` (${device.statusCode})`
                                                    : ""}
                                                </div>
                                              ) : null}
                                            </div>

                                            <div
                                              className={
                                                device.status ===
                                                "sent"
                                                  ? "font-bold text-emerald-400"
                                                  : "font-bold text-red-400"
                                              }
                                            >
                                              {device.status ===
                                              "sent"
                                                ? "✓ SENT"
                                                : "✕ FAILED"}
                                            </div>
                                          </div>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {row.metadata ? (
                                <details className="mt-4">
                                  <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-200">
                                    Raw metadata
                                  </summary>

                                  <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-800 bg-black/30 p-3 text-[10px] leading-4 text-slate-400">
                                    {JSON.stringify(
                                      row.metadata,
                                      null,
                                      2
                                    )}
                                  </pre>
                                </details>
                              ) : null}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-4 py-3 text-xs leading-5 text-slate-400">
          <span className="font-bold text-slate-300">
            Expected-event ledger:
          </span>{" "}
          Golf round-finished notifications now appear before delivery.
          Waiting means the drafted golfer has not completed that round.
          Missed means the persisted round is complete but no matching
          notification event reached the delivery pipeline. Delivery
          records remain authoritative once an event is created.
        </div>
      </div>
    </main>
  );
}
