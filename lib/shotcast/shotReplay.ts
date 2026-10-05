import { createFlightReveal, FLIGHT_REVEAL_SECONDS, type FlightPath } from "./flightReplay";
import { createPuttReplay, type PuttPath } from "./puttReplay";
import type { GreenTopography } from "./greenTopography";

export type ShotReplayRequest = { id: number; strokeNumber: number } | null;
/** One visual playback clock. Navigation remains in the existing Hole Replay.
 * Selection alone is inert; a numbered-control event calls request, even on re-click.
 * Flight reveal/math are the accepted implementation, unchanged. */
export function createShotPlayback(flights: readonly FlightPath[], putts: readonly PuttPath[], topo: GreenTopography | null) {
  const reveals = new Map(flights.map(path => [path.strokeNumber, { ...createFlightReveal(path.points), duration: FLIGHT_REVEAL_SECONDS, kind: "flight" }]));
  if (topo) for (const path of putts) reveals.set(path.strokeNumber, { ...createPuttReplay(path, topo), kind: "putt" });
  let selected: number | null = null, phase: "idle" | "playing" | "finished" = "idle";
  let elapsed = 0, previous: number | null = null;
  const reset = () => { phase = "idle"; elapsed = 0; previous = null; };
  return {
    select(stroke: number | null) { if (stroke !== selected) { selected = stroke; reset(); } },
    request(stroke: number) { selected = stroke; reset(); if (!reveals.has(stroke)) return false; phase = "playing"; return true; },
    reset,
    tick(timestamp: number, active: boolean) {
      if (!active || phase !== "playing" || selected === null || !Number.isFinite(timestamp)) { previous = null; return; }
      const duration = reveals.get(selected)!.duration;
      if (previous !== null) elapsed = Math.min(duration, elapsed + Math.max(0, (timestamp - previous) / 1000));
      previous = timestamp;
      if (elapsed === duration) { phase = "finished"; previous = null; }
    },
    snapshot() { const reveal = selected === null ? undefined : reveals.get(selected);
      return { selected, phase, elapsed, kind: reveal?.kind ?? null, duration: reveal?.duration ?? null,
        sample: phase === "idle" || !reveal ? null : reveal.sample(elapsed) }; },
  };
}
