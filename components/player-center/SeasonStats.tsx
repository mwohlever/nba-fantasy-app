import type { CenterSeasonStats } from "@/lib/player-center/espn";
import { seasonTables, type SeasonTable } from "@/lib/player-center/seasonTables";
import { seasonLabel, type CenterSport } from "@/lib/player-center/types";

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

export default function SeasonStats({ stats, sport, position, season }: { stats: CenterSeasonStats | null; sport: CenterSport; position: string; season: number }) {
  // Keep this boundary strict even if an unexpected provider response reaches presentation.
  const verified = stats?.season === season && stats.phase === "regular" ? stats : null;
  const tables = verified ? seasonTables(verified, sport, position) : [];
  const primary = tables.filter(table => !table.secondary), secondary = tables.filter(table => table.secondary);
  return <>
    <div className="pc-section-title"><h3>{seasonLabel(sport, season)} season statistics</h3><span>Regular season · {verified?.expectedGames != null ? `${verified.expectedGames} provider GP` : "GP unverified"}</span></div>
    {tables.length ? <>
      {primary.map(table => <StatTable key={table.key} table={table} />)}
      {secondary.length > 0 && <details className="pc-expand pc-season-details" open={primary.length ? undefined : true}><summary>Season totals, shooting &amp; more</summary><div>{secondary.map(table => <StatTable key={table.key} table={table} />)}</div></details>}
      <p className="pc-footnote">Provider values for this season; units are labeled per column. Team splits stay separate. — means unavailable.</p>
    </> : <div className="pc-empty"><strong>Season totals unavailable</strong><p>No verified season statistics were returned for this position. The game log remains available where supported.</p></div>}
  </>;
}
