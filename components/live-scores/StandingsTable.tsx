import type { StandingsGroup, StandingsTeam } from "@/lib/live-scores/standings";

type Mode = "nba" | "nfl" | "nfl-playoffs" | "poll" | "conference";
export default function StandingsTable({ teams, mode, label }: { teams: StandingsTeam[]; mode: Mode; label: string }) {
  const ranked = mode === "poll" || mode === "nfl-playoffs";
  return <table aria-label={label} className="w-full table-fixed text-left text-xs tabular-nums sm:text-sm">
    <thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr>
      {ranked ? <th scope="col" className="w-7 py-2">#</th> : null}
      <th scope="col" className="py-2">Team</th>
      {mode === "conference" ? <th scope="col" className="w-14 py-2 text-right">Conf</th> : null}
      <th scope="col" className="w-16 py-2 text-right">{mode === "nba" ? "W-L" : mode.startsWith("nfl") ? "W-L-T" : mode === "conference" ? "Overall" : "Record"}</th>
      {mode === "nba" || mode.startsWith("nfl") ? <th scope="col" className="w-12 py-2 text-right">PCT</th> : null}
      {mode === "nba" ? <th scope="col" className="w-9 py-2 text-right">GB</th> : null}
    </tr></thead>
    <tbody>{teams.map(team => <tr key={team.id} className="border-t border-slate-200">
      {ranked ? <td className="py-2.5 font-bold text-slate-500">{mode === "poll" ? team.rank : team.conferenceRank}</td> : null}
      <th scope="row" className="py-2.5 pr-1 font-semibold"><span className="flex min-w-0 items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">{team.logo ? <img src={team.logo} alt="" loading="lazy" className="max-h-6 max-w-6 object-contain" /> : null}</span>
        <span className="min-w-0"><span className="block truncate" title={team.name}>{team.shortName}
          {team.clincher ? <span className="ml-1 text-sky-600" title={team.clincher.description} aria-label={team.clincher.description}>{team.clincher.symbol}</span> : null}
        </span>{mode === "poll" && team.conference ? <span className="block truncate text-[10px] font-normal text-slate-500">{team.conference}</span> : null}</span>
      </span></th>
      {mode === "conference" ? <td className="py-2.5 text-right">{team.conferenceRecord ?? "—"}</td> : null}
      <td className="py-2.5 text-right">{mode.startsWith("nfl") && team.wins !== null && team.losses !== null && team.ties !== null
        ? `${team.wins}-${team.losses}-${team.ties}` : team.record ?? "—"}</td>
      {mode === "nba" || mode.startsWith("nfl") ? <td className="py-2.5 text-right text-slate-500">{team.percentage ?? "—"}</td> : null}
      {mode === "nba" ? <td className="py-2.5 text-right text-slate-500">{team.gamesBack ?? "—"}</td> : null}
    </tr>)}</tbody>
  </table>;
}

export function ConferenceTables({ group }: { group: StandingsGroup }) {
  return <div className="space-y-4">
    {group.teams.length ? <StandingsTable teams={group.teams} mode="conference" label={`${group.name} standings`} /> : null}
    {group.groups.map(child => <section key={child.id}><h3 className="text-sm font-bold">{child.name}</h3><ConferenceTables group={child} /></section>)}
  </div>;
}
