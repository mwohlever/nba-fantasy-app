"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";

import { currentPreparationInput, isShotcast3DView, matchesReplayEndpoints, shotcastContextKey, type Shotcast3DView } from "@/lib/shotcast/shotcast3dView";
import { freezeHoleWorld } from "@/lib/shotcast/holeWorld";
import { freezePuttPath } from "@/lib/shotcast/puttReplay";
import type { ShotReplayRequest } from "@/lib/shotcast/shotReplay";
import { freezeFlightPath } from "@/lib/shotcast/flightReplay";
import type { GolfHoleReplay } from "@/lib/providers/pgaTourShots";
import { planShotcastVisualization, type ExistingShotcastHole } from "@/lib/shotcast/visualizationCapabilities";

const GolfShotcast3D = dynamic(() => import("./GolfShotcast3D"), { ssr: false });

class ViewErrorBoundary extends Component<{ children: ReactNode; onFailure(reason: string): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onFailure(`render_error: ${error.message}`); }
  render() { return this.state.failed ? null : this.props.children; }
}

type Props = {
  active: boolean;
  viewMode: "course" | "green";
  onStatic3DAvailable(available: boolean, strokes?: readonly number[]): void;
  replayRequest: ShotReplayRequest;
  resetRequest: number;
  replay: ExistingShotcastHole & { pinWorld: { x: number; y: number; z?: number | null } | null } & Partial<Pick<GolfHoleReplay, "fairwayWorld">>;
  selectedStrokeNumber: number | null;
  onSelectStroke(strokeNumber: number): void;
  children: ReactNode;
};

/** Current Scores and Live share this visual layer; production always retains 2D. */
export default function GolfShotcastVisualizationSlot(props: Props) {
  if (process.env.NODE_ENV !== "development") return <>{props.children}</>;
  // A refreshed hole with changed coordinates must earn its own first frame.
  return <EnabledShotcastVisualizationSlot key={JSON.stringify(currentPreparationInput(props.replay))} {...props} />;
}

function EnabledShotcastVisualizationSlot({ replay, active, viewMode, onStatic3DAvailable, selectedStrokeNumber, onSelectStroke, resetRequest, replayRequest, children }: Props) {
  const [result, setResult] = useState<{ body: string; view: Shotcast3DView | null; reason: string } | null>(null);
  const [readyBody, setReadyBody] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ body: string; reason: string } | null>(null);
  const context = shotcastContextKey(replay);
  const body = useMemo(() => {
    const playerHole = currentPreparationInput(replay);
    return playerHole ? JSON.stringify(playerHole) : null;
  }, [replay]);
  const view = result?.body === body ? result.view : null;
  const ready = readyBody === body && body !== null;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !body) return;
    const controller = new AbortController();
    void fetch("/api/golf/shotcast-3d-dev", { method: "POST", body, headers: { "Content-Type": "application/json" }, signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error(`preparation_http_${response.status}`);
        return response.json();
      })
      .then(value => {
        if (controller.signal.aborted) return;
        if (isShotcast3DView(value) && value.flightPaths) {
          value.flightPaths.forEach(freezeFlightPath); Object.freeze(value.flightPaths);
        }
        if (isShotcast3DView(value) && value.puttPaths) {
          value.puttPaths.forEach(freezePuttPath); Object.freeze(value.puttPaths);
        }
        setResult({ body, view: isShotcast3DView(value) ? freezeHoleWorld(value) : null, reason: value === null ? "no_prepared_context" : "invalid_prepared_context" });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ body, view: null, reason: error instanceof Error ? error.message : "preparation_request_failed" });
      });
    return () => controller.abort();
  }, [body]);

  const reason = useMemo(() => {
    if (!body) return "missing_current_coordinates";
    if (!view) return result?.body === body ? result.reason : "loading_preparation";
    if (!matchesReplayEndpoints(view, replay)) return "replay_endpoint_mismatch";
    if (viewMode === "green" && (!view.assets.green || !view.greenBounds)) return "missing_prepared_green";
    const plan = planShotcastVisualization(replay, view.prepared, selectedStrokeNumber);
    if (plan.mode === "2d_fallback") return plan.reason ?? "unsupported_context";
    return failure?.body === body ? failure.reason : (ready ? "3d_ready" : "waiting_first_frame");
  }, [view, replay, selectedStrokeNumber, body, result, failure, ready, viewMode]);
  const supported = reason === "3d_ready" || reason === "waiting_first_frame";
  useEffect(() => {
    onStatic3DAvailable(supported, supported && view ? [...(view.flightPaths ?? []), ...(view.puttPaths ?? [])].map(path => path.strokeNumber) : []);
  }, [supported, view, onStatic3DAvailable]);
  const show3D = active && supported;

  return <div className="absolute inset-0" data-shotcast-view={show3D && ready ? "3d" : "2d"} data-shotcast-reason={active ? reason : "existing_2d_playback"} data-shotcast-context={context}>
    <div className={show3D && ready ? "hidden" : undefined}>{children}</div>
    {supported && view ? <div className={`${show3D && ready ? "" : "invisible "}absolute inset-0 overflow-hidden bg-slate-950`}>
      <ViewErrorBoundary key={body} onFailure={reason => body && setFailure({ body, reason })}>
        <GolfShotcast3D view={view} active={show3D} viewMode={viewMode} selectedStrokeNumber={selectedStrokeNumber} onSelectStroke={onSelectStroke} resetRequest={resetRequest} replayRequest={replayRequest} onReady={() => setReadyBody(body)} onFailure={reason => body && setFailure({ body, reason })} />
      </ViewErrorBoundary>
      {ready ? <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-slate-950/80 px-3 py-2 text-xs font-semibold text-white">
        <span className="sm:hidden">3D ShotCast{selectedStrokeNumber ? ` · Shot ${selectedStrokeNumber}` : ""}</span>
        <span className="hidden sm:inline">3D ShotCast · {view.courseName}{selectedStrokeNumber ? ` · Shot ${selectedStrokeNumber}` : ""}</span>
      </div> : null}
    </div> : null}
  </div>;
}
