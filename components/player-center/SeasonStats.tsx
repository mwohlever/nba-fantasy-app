import type { CenterSeasonStats } from "@/lib/player-center/espn";
import { seasonTables, type SeasonTable } from "@/lib/player-center/seasonTables";
import { statLabels, formatStat } from "@/lib/player-center/display";
import { seasonLabel, type CenterSport, type SeasonFacts } from "@/lib/player-center/types";

function StatTable({ table }: { table: SeasonTable }) {
  return <section className="pc-season-section" aria-label={table.title}>
    <h4>{table.title}</h4>
    <div className="pc-table-scroll" role="region" aria-label={`${table.title}; scroll for all statistics`} tabIndex={0}>
      <table className="pc-table pc-season-table"><thead><tr><th className="pc-sticky" scope="col">Split</th>
        {table.columns.map((column, index) => <th scope="col" key={`${column.label}-${index}`}>{column.label}<small>{column.unit}</small></th>)}
      </tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}><th scope="row" className="pc-sticky">{row.label}{row.team !== null && <small>Provider team {row.team}</small>}</th>
        {row.values.map((value, index) => <td key={index}>{value ?? "—"}</td>)}
      </tr>)}</tbody></table>
    </div>
  </section>;
}

export default function SeasonStats({ stats, sport, position, season, facts }: { facts?: SeasonFacts | null; stats: CenterSeasonStats | null; sport: CenterSport; position: string; season: number }) {
  // Keep this boundary strict even if an unexpected provider response reaches presentation.
  const verified = stats?.season === season && stats.phase === "regular" ? stats : null;
  const published = facts?.sport === sport && facts.season === season && facts.phase === "regular" ? facts : null;
  const gp = published ? published.gamesPlayed : verified?.expectedGames;
  const fields = published ? Object.entries(published.stats).filter(([key]) => sport === "nba" || (position === "K" ? /^(field_goals|extra_points)/.test(key) : !/^(field_goals|extra_points)/.test(key))) : [];
  const tables = verified ? seasonTables(verified, sport, position) : [];
  const primary = tables.filter(table => !table.secondary), secondary = tables.filter(table => table.secondary);
  return <div className={`pc-season-panel pc-season-panel-${sport}`}>
    <div className="pc-section-title"><h3>{seasonLabel(sport, season)} season statistics</h3><span>Regular season · {gp != null ? `${gp} provider GP` : "GP unverified"}</span></div>
    {published && <section className="pc-season-section" aria-label="Published season facts">
      <h4>Published season totals · {published.gamesPlayed ?? "Unknown"} GP</h4>
      <p className="pc-footnote">ESPN · {published.freshness === "fresh" ? "Fetched" : "Stale data · fetched"} {new Date(published.fetchedAt).toLocaleString("en-US")} · <a href={published.source} target="_blank" rel="noreferrer">Season source</a></p>
      <div className="pc-table-scroll" role="region" tabIndex={0} aria-label="Published season statistics; scroll for all statistics"><table className="pc-table pc-season-table"><thead><tr><th>Statistic</th><th>Total</th><th>Per game</th></tr></thead><tbody>
        {fields.map(([key, value]) => <tr key={key}><th scope="row">{statLabels[key] ?? key}</th><td>{formatStat(value, 2)}</td><td>{formatStat(value !== null && published.gamesPlayed !== null && published.gamesPlayed > 0 ? value / published.gamesPlayed : null, 2)}</td></tr>)}
      </tbody></table></div><p className="pc-footnote">Averages use published totals / GP. Missing fields remain unavailable.</p>
    </section>}
    {tables.length ? <>
      {!published && primary.map(table => <StatTable key={table.key} table={table} />)}
      {published && <details className="pc-expand"><summary>Additional provider statistics</summary>{primary.map(table => <StatTable key={table.key} table={table} />)}</details>}
      {secondary.length > 0 && <details className="pc-expand pc-season-details" open={primary.length ? undefined : true}><summary>Season totals, shooting &amp; more</summary><div>{secondary.map(table => <StatTable key={table.key} table={table} />)}</div></details>}
      <p className="pc-footnote">Provider values for this season; units are labeled per column. Team splits stay separate. — means unavailable.</p>
    </> : !published && <div className="pc-empty"><strong>Season totals unavailable</strong><p>No verified season statistics were returned for this position. The game log remains available where supported.</p></div>}
  </div>;
}
