"use client";

import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import type {
  GolfHoleStat,
  GolfRoundStat,
  Player,
  PlayerStat,
} from "@/components/lineups/types";

type Props = {
  player: Player;
  stat: PlayerStat | null;
  onClose: () => void;
};

function formatToPar(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : String(value);
}

function formatPosition(value: number | null | undefined) {
  if (!value) return "—";
  return `T${value}`;
}

function statusLabel(stat: PlayerStat | null) {
  const status = stat?.status ?? "scheduled";

  if (status === "active") {
    return stat?.last_hole
      ? `Round ${stat.current_round ?? "—"} · Thru ${stat.last_hole}`
      : `Round ${stat?.current_round ?? "—"}`;
  }

  if (status === "finished") return "Tournament complete";
  if (status === "cut") return "Missed cut";
  if (status === "withdrawn") return "Withdrawn";
  if (status === "disqualified") return "Disqualified";
  if (status === "did_not_start") return "Did not start";

  return stat?.tee_time_raw || "Scheduled";
}

function holeClass(hole: GolfHoleStat) {
  const relative = hole.relative_to_par;

  if (relative === null) {
    return "border-slate-200 bg-slate-50 text-slate-400";
  }

  if (relative <= -2) {
    return "border-emerald-700 bg-emerald-700 text-white ring-2 ring-emerald-200";
  }

  if (relative === -1) {
    return "border-emerald-300 bg-emerald-100 text-emerald-900";
  }

  if (relative === 0) {
    return "border-slate-200 bg-white text-slate-700";
  }

  if (relative === 1) {
    return "border-red-300 bg-red-100 text-red-900";
  }

  return "border-red-700 bg-red-700 text-white ring-2 ring-red-200";
}

function holeValue(hole: GolfHoleStat) {
  if (hole.relative_to_par === null) return "—";
  if (hole.relative_to_par === 0) return "E";
  return hole.relative_to_par > 0
    ? `+${hole.relative_to_par}`
    : String(hole.relative_to_par);
}

function PenaltyRound({
  roundNumber,
  score,
  status,
}: {
  roundNumber: number;
  score: number;
  status: string;
}) {
  const label =
    status === "cut"
      ? "Missed-cut penalty"
      : status === "withdrawn"
        ? "Withdrawal penalty"
        : status === "disqualified"
          ? "Disqualification penalty"
          : "Penalty round";

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <header className="flex items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
            Round {roundNumber}
          </span>

          <div className="mt-1 text-sm text-amber-800">
            {label}
          </div>
        </div>

        <strong className="text-2xl font-black text-amber-950">
          {formatToPar(score)}
        </strong>
      </header>

      <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-white/60 px-4 py-4 text-sm text-amber-900">
        No holes played. This round score was added under the league penalty
        rule.
      </div>
    </section>
  );
}

function RoundScorecard({ round }: { round: GolfRoundStat }) {
  const holesByNumber = new Map(
    round.holes.map((hole) => [hole.hole_number, hole]),
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Round {round.round_number}
          </span>

          <div className="mt-1 text-sm text-slate-600">
            {round.holes_completed} holes completed
          </div>
        </div>

        <div className="text-right">
          <strong className="text-2xl font-black text-slate-950">
            {formatToPar(round.score_to_par)}
          </strong>

          <span className="ml-2 text-xs font-bold uppercase text-slate-500">
            {round.strokes ?? "—"} strokes
          </span>
        </div>
      </header>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[700px] grid-cols-18 gap-1.5">
          {Array.from({ length: 18 }, (_, index) => index + 1).map(
            (holeNumber) => (
              <div
                key={`number-${holeNumber}`}
                className="text-center text-[10px] font-bold text-slate-400"
              >
                {holeNumber}
              </div>
            ),
          )}

          {Array.from({ length: 18 }, (_, index) => index + 1).map(
            (holeNumber) => {
              const hole =
                holesByNumber.get(holeNumber) ??
                ({
                  hole_number: holeNumber,
                  strokes: null,
                  relative_to_par: null,
                  score_display: null,
                } satisfies GolfHoleStat);

              return (
                <div
                  key={`score-${holeNumber}`}
                  className={`flex h-9 items-center justify-center rounded-lg border text-xs font-black ${holeClass(
                    hole,
                  )}`}
                  title={
                    hole.strokes
                      ? `Hole ${holeNumber}: ${hole.strokes} strokes`
                      : `Hole ${holeNumber}: not played`
                  }
                >
                  {holeValue(hole)}
                </div>
              );
            },
          )}
        </div>
      </div>
    </section>
  );
}

export default function GolfPlayerModal({
  player,
  stat,
  onClose,
}: Props) {
  const rounds = [...(stat?.rounds ?? [])].sort(
    (a, b) => a.round_number - b.round_number,
  );

  const completedRoundNumbers = new Set(
    rounds
      .filter(
        (round) =>
          round.holes_completed > 0 ||
          round.strokes !== null,
      )
      .map((round) => round.round_number),
  );

  const missingRoundNumbers = [1, 2, 3, 4].filter(
    (roundNumber) =>
      !completedRoundNumbers.has(roundNumber),
  );

  const totalPenalty = Number(
    stat?.penalty_strokes ?? 0,
  );

  const penaltyRoundNumbers =
    totalPenalty > 0
      ? missingRoundNumbers
      : [];

  const penaltyPerRound =
    penaltyRoundNumbers.length > 0
      ? totalPenalty / penaltyRoundNumbers.length
      : 0;

  return (
    <div
      className="mobile-modal-safe fixed inset-0 z-[11000] flex items-end justify-center bg-slate-950/60 px-3 py-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${player.name} Golf scorecard`}
        className="mobile-modal-panel-safe flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl"
      >
        <header className="relative border-b border-slate-200 bg-slate-950 px-5 py-6 text-white">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl transition hover:bg-white/20"
            aria-label="Close Golf scorecard"
          >
            ×
          </button>

          <div className="flex items-center gap-4 pr-12">
            <PlayerHeadshot
              espnGolfPlayerId={player.espn_player_id}
              imageUrl={player.headshot_url}
              playerName={player.name}
              size="xl"
              className="border-white/20 bg-white/10"
            />

            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                Tournament scorecard
              </div>

              <h2 className="mt-2 truncate text-3xl font-black">
                {player.name}
              </h2>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                {player.country ? <span>{player.country}</span> : null}

                <span>{statusLabel(stat)}</span>

                <span>
                  OWGR{" "}
                  {player.owgr_rank
                    ? `#${player.owgr_rank}`
                    : "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/10 p-3">
              <span className="block text-xs uppercase text-slate-400">
                Position
              </span>

              <strong className="mt-1 block text-2xl">
                {formatPosition(stat?.leaderboard_order)}
              </strong>
            </div>

            <div className="rounded-2xl bg-emerald-500/20 p-3">
              <span className="block text-xs uppercase text-emerald-200">
                Score
              </span>

              <strong className="mt-1 block text-2xl">
                {formatToPar(stat?.fantasy_points)}
              </strong>
            </div>
          </div>

          {Number(stat?.penalty_strokes ?? 0) > 0 ? (
            <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              Includes +{stat?.penalty_strokes} from unplayed-round
              penalties.
            </div>
          ) : null}
        </header>

        <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
          {rounds.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
              No completed holes are available yet.
            </div>
          ) : (
            <>
              {rounds.map((round) => (
                <RoundScorecard
                  key={`played-${round.round_number}`}
                  round={round}
                />
              ))}

              {penaltyRoundNumbers.map(
                (roundNumber) => (
                  <PenaltyRound
                    key={`penalty-${roundNumber}`}
                    roundNumber={roundNumber}
                    score={penaltyPerRound}
                    status={stat?.status ?? ""}
                  />
                ),
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
