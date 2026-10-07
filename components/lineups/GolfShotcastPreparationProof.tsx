"use client";

import { useState } from "react";
import type { GolfHoleReplay } from "@/lib/providers/pgaTourShots";
import GolfHoleMap2D from "./GolfHoleMap2D";
import GolfShotcastVisualizationSlot from "./GolfShotcastVisualizationSlot";

/** Harness for the ACTUAL accepted map controls and renderer; no second scene. */
export default function GolfShotcastPreparationProof({ replay, choices = [], activeProof = "waialae" }: { replay: GolfHoleReplay; choices?: { id: string; label: string }[]; activeProof?: string }) {
  const [selectedStrokeNumber, setSelectedStrokeNumber] = useState<number | null>(null);
  if (!replay.shotcast) return null;
  return <main className="mx-auto max-w-5xl px-3 py-5 text-white">
    {choices.length > 1 ? <nav aria-label="Prepared research proofs" className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
      {choices.map(choice => <a key={choice.id} href={`/shotcast-3d-proof?proof=${encodeURIComponent(choice.id)}`} aria-current={choice.id === activeProof ? "page" : undefined}
        className={choice.id === activeProof ? "font-semibold text-cyan-300" : "text-slate-300 underline"}>{choice.label}</a>)}
    </nav> : null}
    <p className="mb-3 text-sm">Development preparation proof · {replay.playerName} · Round {replay.roundNumber} · Hole {replay.holeNumber}</p>
    <GolfHoleMap2D title={`${replay.playerName} · Hole ${replay.holeNumber}`} imageUrl={replay.shotcast.imageUrl}
      greenImageUrl={replay.shotcast.greenImageUrl} pinWorld={replay.pinWorld} greenPin={replay.greenPin}
      shots={replay.shots} selectedStrokeNumber={selectedStrokeNumber} onSelectStroke={setSelectedStrokeNumber}
      calibration={{ xScale: 1, xOffset: 0, yScale: 1, yOffset: 0, verified: true }} imageFit="fill" showShotOverlay
      renderCourseViewport={(fallback, active, resetRequest, viewMode, onStatic3DAvailable, replayRequest, onSelectShot) => (
        <GolfShotcastVisualizationSlot replay={replay} active={active} viewMode={viewMode}
          onStatic3DAvailable={onStatic3DAvailable} replayRequest={replayRequest} resetRequest={resetRequest}
          selectedStrokeNumber={selectedStrokeNumber} onSelectStroke={onSelectShot}>
          {fallback}
        </GolfShotcastVisualizationSlot>
      )} />
  </main>;
}
