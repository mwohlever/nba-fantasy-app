"use client";

import { useEffect, useState } from "react";

type SlateDetail = {
  success: boolean;
  slate: {
    id: number;
    label: string;
  };
  selectedTeam: {
    id: number;
    name: string;
    score: number;
    finishPosition: number | null;
    draftPosition: number | null;
    roster: Array<{
      playerId: number;
      playerName: string;
      positionGroup: string | null;
      fantasyPoints: number | null;
    }>;
    topPlayer: {
      playerId: number;
      playerName: string;
      positionGroup: string | null;
      fantasyPoints: number | null;
    } | null;
  };
  standings: Array<{
    teamId: number;
    teamName: string;
    score: number;
    finishPosition: number | null;
    gamesCompleted: number;
    gamesInProgress: number;
    gamesRemaining: number;
  }>;
};

type Props = {
  slateId: number;
  teamId: number;
  onClose: () => void;
};

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(1);
}

function ordinal(position: number | null) {
  if (!position) return "Result pending";

  const mod100 = position % 100;

  if (mod100 >= 11 && mod100 <= 13) {
    return `${position}th`;
  }

  const suffix =
    position % 10 === 1
      ? "st"
      : position % 10 === 2
        ? "nd"
        : position % 10 === 3
          ? "rd"
          : "th";

  return `${position}${suffix}`;
}

function medal(position: number | null) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return "";
}

export default function SlateDetailModal({
  slateId,
  teamId,
  onClose,
}: Props) {
  const [detail, setDetail] =
    useState<SlateDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;

    async function loadDetail() {
      try {
        setIsLoading(true);
        setMessage("");

        const response = await fetch(
          `/api/slate-profile-detail?slateId=${slateId}&teamId=${teamId}`,
          {
            cache: "no-store",
          }
        );

        const result = await response.json();

        if (!response.ok) {
          if (active) {
            setMessage(
              result.error || "Unable to load this slate."
            );
          }
          return;
        }

        if (active) {
          setDetail(result as SlateDetail);
        }
      } catch (error) {
        console.error("Failed to load slate detail", error);

        if (active) {
          setMessage("Unable to load this slate.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadDetail();

    return () => {
      active = false;
    };
  }, [slateId, teamId]);

  return (
    <div
      className="mobile-modal-safe fixed inset-0 z-[11000] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Slate detail"
        className="mobile-modal-panel-safe slate-detail-modal w-full max-w-4xl overflow-hidden rounded-3xl border shadow-2xl"
      >
        <header className="slate-detail-header flex items-start justify-between gap-4 border-b p-5">
          <div>
            <div className="slate-detail-kicker">
              Slate recap
            </div>

            <h2 className="mt-1 text-2xl font-black">
              {detail?.slate.label ?? "Loading slate..."}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close slate detail"
            className="slate-detail-close"
          >
            ×
          </button>
        </header>

        <div className="max-h-[78dvh] overflow-y-auto p-5">
          {isLoading ? (
            <div className="slate-detail-empty">
              Loading slate recap...
            </div>
          ) : message ? (
            <div className="slate-detail-error">
              {message}
            </div>
          ) : detail ? (
            <div className="space-y-5">
              <section
                className={`slate-detail-summary ${
                  detail.selectedTeam.finishPosition === 1
                    ? "slate-detail-summary--winner"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="slate-detail-summary-label">
                      {detail.selectedTeam.name}
                    </div>

                    <div className="mt-2 text-3xl font-black">
                      {medal(
                        detail.selectedTeam.finishPosition
                      )}{" "}
                      {ordinal(
                        detail.selectedTeam.finishPosition
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="slate-detail-summary-label">
                      Final Score
                    </div>

                    <div className="mt-2 text-3xl font-black">
                      {fmt(detail.selectedTeam.score)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="slate-detail-summary-stat">
                    <div className="slate-detail-summary-label">
                      Draft Position
                    </div>

                    <div className="mt-1 text-xl font-black">
                      {detail.selectedTeam.draftPosition
                        ? `#${detail.selectedTeam.draftPosition}`
                        : "—"}
                    </div>
                  </div>

                  <div className="slate-detail-summary-stat">
                    <div className="slate-detail-summary-label">
                      Top Player
                    </div>

                    <div className="mt-1 font-black">
                      {detail.selectedTeam.topPlayer
                        ?.playerName ?? "—"}
                    </div>

                    <div className="mt-0.5 text-sm font-bold">
                      {detail.selectedTeam.topPlayer
                        ?.fantasyPoints !== null &&
                      detail.selectedTeam.topPlayer
                        ?.fantasyPoints !== undefined
                        ? `${fmt(
                            detail.selectedTeam.topPlayer
                              .fantasyPoints
                          )} FP`
                        : ""}
                    </div>
                  </div>
                </div>
              </section>

              <section className="slate-detail-section">
                <div className="slate-detail-section-kicker">
                  Your lineup
                </div>

                <h3 className="slate-detail-section-title">
                  Player breakdown
                </h3>

                {detail.selectedTeam.roster.length === 0 ? (
                  <div className="slate-detail-empty mt-4">
                    No lineup was found for this slate.
                  </div>
                ) : (
                  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
                    {detail.selectedTeam.roster.map(
                      (player, index) => (
                        <div
                          key={player.playerId}
                          className="slate-detail-roster-row"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="slate-detail-rank">
                              {index + 1}
                            </div>

                            <div className="min-w-0">
                              <div className="truncate font-bold">
                                {player.playerName}
                              </div>

                              <div className="text-xs">
                                {player.positionGroup ??
                                  "Player"}
                              </div>
                            </div>
                          </div>

                          <div className="text-right text-lg font-black">
                            {fmt(player.fantasyPoints)}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </section>

              <section className="slate-detail-section">
                <div className="slate-detail-section-kicker">
                  League results
                </div>

                <h3 className="slate-detail-section-title">
                  Final standings
                </h3>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
                  {detail.standings.map((row) => (
                    <div
                      key={row.teamId}
                      className={`slate-detail-standing-row ${
                        row.teamId === teamId
                          ? "slate-detail-standing-row--selected"
                          : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="slate-detail-rank">
                          {row.finishPosition ??
                            detail.standings.indexOf(row) + 1}
                        </div>

                        <div className="min-w-0">
                          <div className="truncate font-bold">
                            {medal(row.finishPosition)}{" "}
                            {row.teamName}
                          </div>
                        </div>
                      </div>

                      <div className="text-lg font-black">
                        {fmt(row.score)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
