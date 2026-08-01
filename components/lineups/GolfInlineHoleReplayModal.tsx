"use client";

import GolfHoleReplayPanel from "@/components/lineups/GolfHoleReplayPanel";

export type InlineGolfHoleReplay = {
  playerId: number;
  roundNumber: number;
  holeNumber: number;
  par: number | null;
  yardage: number | null;
  result: string;
};

type Props = {
  slateId: number | null;
  replay: InlineGolfHoleReplay | null;
  onClose: () => void;
  inline?: boolean;
};

function ReplayUnavailable({
  onClose,
  inline,
}: {
  onClose: () => void;
  inline: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-950 px-5 py-6 text-center text-slate-300 shadow-sm">
      <div className="text-sm font-bold text-white">
        Shot tracking unavailable
      </div>

      <p className="mt-2 text-xs leading-5 text-slate-500">
        This scorecard is not connected to a Golf slate.
      </p>

      {!inline ? (
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200"
        >
          Close
        </button>
      ) : null}
    </section>
  );
}

export default function GolfInlineHoleReplayModal({
  slateId,
  replay,
  onClose,
  inline = false,
}: Props) {
  if (!replay) return null;

  const content = slateId ? (
    <GolfHoleReplayPanel
      slateId={slateId}
      playerId={replay.playerId}
      roundNumber={replay.roundNumber}
      holeNumber={replay.holeNumber}
      fallbackPar={replay.par}
      fallbackYardage={replay.yardage}
      fallbackResult={replay.result}
      onClose={onClose}
    />
  ) : (
    <ReplayUnavailable
      onClose={onClose}
      inline={inline}
    />
  );

  if (inline) {
    return content;
  }

  return (
    <div
      className="mobile-modal-safe fixed inset-0 z-[12000] flex items-end justify-center bg-slate-950/80 px-2 py-2 backdrop-blur-sm sm:items-center sm:px-4 sm:py-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="mobile-modal-panel-safe max-h-[96dvh] w-full max-w-3xl overflow-y-auto rounded-2xl sm:max-h-[92dvh] sm:rounded-3xl">
        {content}
      </div>
    </div>
  );
}
