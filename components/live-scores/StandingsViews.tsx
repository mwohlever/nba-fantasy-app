"use client";

import { useEffect } from "react";
import type { NcaaStandings, ProStandings, StandingsPoll } from "@/lib/live-scores/standings";
import type { NbaStandingsView, NflStandingsView } from "@/lib/live-scores/urlState";
import type { NcaaStandingsSelection } from "@/lib/live-scores/ncaaUrlState";
import { SegmentedSelector } from "./LiveViewSelector";
import StandingsTable, { ConferenceTables } from "./StandingsTable";

export function NbaStandingsView({ data, selection, onChange }: { data: ProStandings; selection: NbaStandingsView; onChange: (value: NbaStandingsView) => void }) {
  const conference = data.conferences.find(group => group.id === (selection === "west" ? "6" : "5"));
  return <div className="space-y-4">
    <SegmentedSelector label="NBA standings view" value={selection} onChange={onChange} options={[{ value: "east", label: "East" }, { value: "west", label: "West" }, { value: "playoffs", label: "Playoffs" }]} />
    <h2 className="text-lg font-black">{data.seasonLabel} NBA Standings</h2>
    {selection === "playoffs" ? <p role="status" className="text-sm text-slate-500">{data.playoffs.message}</p>
      : !data.hasResults ? <p role="status" className="text-sm text-slate-500">Regular season has not started.</p>
      : conference ? <section><h3 className="mb-1 text-sm font-bold">{conference.name}</h3><StandingsTable teams={conference.teams} mode="nba" label={`${conference.name} standings`} /></section> : null}
  </div>;
}

export function NflStandingsView({ data, selection, onChange }: { data: ProStandings; selection: NflStandingsView; onChange: (value: NflStandingsView) => void }) {
  const conferences = selection === "playoffs" ? data.conferences : data.conferences.filter(group => group.id === (selection === "afc" ? "8" : "7"));
  return <div className="space-y-4">
    <SegmentedSelector label="NFL standings view" value={selection} onChange={onChange} options={[{ value: "afc", label: "AFC" }, { value: "nfc", label: "NFC" }, { value: "playoffs", label: "Playoffs" }]} />
    <h2 className="text-lg font-black">{data.seasonLabel} NFL {selection === "playoffs" ? "Playoff Picture" : "Standings"}</h2>
    {selection === "playoffs" ? <p role="status" className="text-xs text-slate-500">{data.playoffs.message}</p> : null}
    {!data.hasResults ? <p className="text-sm text-slate-500">Regular season has not started.</p> : null}
    {selection !== "playoffs" || data.playoffs.available ? conferences.map(conference => <section key={conference.id} className="space-y-4">
      {selection === "playoffs" ? <><h3 className="text-base font-black">{conference.shortName}</h3>
        {[{ label: "Division Leaders", min: 1, max: 4 }, { label: "Wild Card", min: 5, max: 7 }, { label: "Outside the Field", min: 8, max: 16 }].map(part => <section key={part.label}>
          <h4 className="text-xs font-bold text-slate-500">{part.label}</h4>
          <StandingsTable teams={conference.teams.filter(team => team.conferenceRank! >= part.min && team.conferenceRank! <= part.max)} mode="nfl-playoffs" label={`${conference.shortName} ${part.label}`} />
        </section>)}</> : conference.groups.map(division => <section key={division.id}><h3 className="text-sm font-bold">{division.name}</h3><StandingsTable teams={division.teams} mode="nfl" label={`${division.name} standings`} /></section>)}
    </section>) : null}
  </div>;
}

function PollTable({ poll, heading = true }: { poll: StandingsPoll; heading?: boolean }) {
  return <section>{heading ? <h3 className="text-sm font-bold">{poll.title}</h3> : null}
    {poll.publishedAt ? <p className="mt-1 text-xs text-slate-500">Released {new Date(poll.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p> : null}
    <StandingsTable teams={poll.teams} mode="poll" label={poll.title} />
  </section>;
}

export function NcaaStandingsView({ data, selection, onChange }: { data: NcaaStandings; selection: NcaaStandingsSelection; onChange: (value: NcaaStandingsSelection) => void }) {
  const conference = data.conferences.find(group => `conference:${group.id}` === selection);
  useEffect(() => {
    if (selection.startsWith("conference:") && !conference && !data.conferencesError) onChange("top25");
  }, [selection, conference, data.conferencesError, onChange]);
  return <div className="space-y-4">
    <label className="block text-xs font-bold text-slate-500">Standings view
      <select aria-label="NCAA standings view" value={selection} onChange={event => onChange(event.target.value as NcaaStandingsSelection)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900">
        <option value="top25">Top 25</option><option value="cfp">College Football Playoff</option>
        {data.conferences.map(group => <option key={group.id} value={`conference:${group.id}`}>{group.name}</option>)}
        {selection.startsWith("conference:") && !conference && data.conferencesError ? <option value={selection}>Conference standings unavailable</option> : null}
      </select>
    </label>
    <h2 className="text-lg font-black">{data.seasonLabel} {selection === "top25" ? "AP Top 25" : selection === "cfp" ? "College Football Playoff" : `${conference?.name ?? "Conference"} Standings`}</h2>
    {selection === "top25" ? data.ap ? <PollTable poll={data.ap} heading={false} /> : <p role="status" className="text-sm text-slate-500">{data.rankingsError}</p>
      : selection === "cfp" ? <div className="space-y-5"><p role="status" className="text-sm text-slate-500">{data.cfp.message}</p>
        {data.cfp.field ? <PollTable poll={data.cfp.field} /> : null}{data.cfp.rankings ? <PollTable poll={data.cfp.rankings} /> : null}
      </div> : conference ? <ConferenceTables group={conference} /> : <p role="status" className="text-sm text-slate-500">{data.conferencesError ?? "Conference standings are unavailable."}</p>}
  </div>;
}
