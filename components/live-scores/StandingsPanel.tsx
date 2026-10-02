"use client";
import { useEffect, useRef } from "react";
import { useLiveRequest, type LiveRequestIdentity } from "@/lib/live-scores/useLiveRequest";
import type { NcaaStandings, ProStandings } from "@/lib/live-scores/standings";
import type { NbaStandingsView as NbaSelection, NflStandingsView as NflSelection } from "@/lib/live-scores/urlState";
import type { NcaaStandingsSelection } from "@/lib/live-scores/ncaaUrlState";
import { NbaStandingsView, NflStandingsView, NcaaStandingsView } from "./StandingsViews";

type Scope = Omit<LiveRequestIdentity, "resource">;
type Props = { scope: Scope | null; waitingForScope?: boolean } & (
  | { sport: "nba"; selection: NbaSelection; onChange: (value: NbaSelection) => void }
  | { sport: "nfl"; selection: NflSelection; onChange: (value: NflSelection) => void }
  | { sport: "ncaa"; selection: NcaaStandingsSelection; onChange: (value: NcaaStandingsSelection) => void }
);

export default function StandingsPanel(props: Props) {
  const { scope, sport } = props;
  const params = scope ? new URLSearchParams({ groupId: scope.groupId, leagueId: scope.leagueId }) : null;
  if (params && scope && sport !== "ncaa") params.set("viewerId", scope.viewerId);
  if (params && scope?.context === "nba-skins") params.set("context", "nba-skins");
  const endpoint = sport === "ncaa" ? "/api/ncaa-pickem/live-standings" : `/api/live-scores/${sport}/standings`;
  const url = params ? `${endpoint}?${params}` : null;
  const { data, error, loading, refreshing, refresh } = useLiveRequest<ProStandings | NcaaStandings>(scope ? { ...scope, resource: "current-real-world-standings" } as LiveRequestIdentity : null, url);
  const lastAttempt = useRef(0);
  useEffect(() => { lastAttempt.current = Date.now(); }, [url, data, error]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || loading || refreshing || Date.now() - lastAttempt.current < 300000) return;
      lastAttempt.current = Date.now();
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, loading, refreshing]);
  return <section className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
    <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-500"><span>Current real-world season · ESPN</span>
      <button type="button" aria-label="Refresh standings" disabled={!scope || loading || refreshing} onClick={() => { lastAttempt.current = Date.now(); void refresh(); }} className="px-2 py-1 text-xl disabled:opacity-40">↻</button>
    </div>
    {error ? <p role="alert" className="mb-3 text-sm text-rose-600">{data ? `Showing the last loaded standings. ${error}` : error}</p> : null}
    {!scope && props.waitingForScope === false ? <p role="status" className="py-6 text-center text-sm text-slate-500">Select a Group with NCAA Pick &apos;Em enabled to view standings.</p>
      : !scope || loading ? <p role="status" className="py-6 text-center text-sm text-slate-500">Loading standings…</p> : null}
    {props.sport === "nba" && data?.sport === "nba" ? <NbaStandingsView data={data} selection={props.selection} onChange={props.onChange} /> : null}
    {props.sport === "nfl" && data?.sport === "nfl" ? <NflStandingsView data={data} selection={props.selection} onChange={props.onChange} /> : null}
    {props.sport === "ncaa" && data?.sport === "ncaa" ? <NcaaStandingsView data={data} selection={props.selection} onChange={props.onChange} /> : null}
  </section>;
}
