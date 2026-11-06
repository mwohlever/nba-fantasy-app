"use client";
import type { ResearchBrowserProps } from "./ResearchBrowser";

/** Drafting remains available while the separately approved statistical profiles are deactivated. */
export default function CatalogBrowser(props: ResearchBrowserProps) {
  const positions = props.positions ?? ["All", "G", "F/C"];
  const rows = [...(props.entries ?? [])].filter(row => !props.search || row.identity.name.toLowerCase().includes(props.search.toLowerCase())).sort((a,b) => a.identity.name.localeCompare(b.identity.name));
  return <section className="pc pc-browser" data-sport={props.sport} aria-label={`${props.sport.toUpperCase()} player catalog`}>
    <div className="pc-browser-controls"><label className="pc-search">Search players<input type="search" placeholder="Search players…" value={props.search ?? ""} onChange={event => props.onSearch?.(event.target.value)} /></label>
      {!props.hidePositionFilter && <label>Position<select aria-label="Position filter" value={props.position ?? "All"} onChange={event => props.onPosition?.(event.target.value)}>{positions.map(value => <option key={value}>{value}</option>)}</select></label>}
    </div>
    <div className="pc-browser-subcontrols">{props.extras}</div>
    <p className="pc-footnote">Players are listed alphabetically. Historical statistical profiles are not activated.</p>
    <div className="pc-table-scroll" role="region" aria-label="Player catalog" tabIndex={0}><table className="pc-table pc-pool-table"><thead><tr><th className="pc-sticky">Player</th><th>Position</th><th>Status</th><th>Profile</th></tr></thead><tbody>{rows.map(({identity,status}) => <tr key={identity.id}>
      <th className="pc-sticky"><button type="button" className="draft-player-card pc-player-button" disabled={props.disabled} onClick={() => (props.onSelect ?? props.onInspect)(identity)}><span>{identity.name}<small>{identity.teamAbbreviation}</small></span></button></th>
      <td>{identity.positionGroup ?? "—"}</td><td>{status}</td><td><button type="button" className="pc-info" disabled={props.disabled} onClick={() => props.onInspect(identity)}>Info</button></td>
    </tr>)}</tbody></table></div>
    {!rows.length && <p className="pc-empty">No players match these filters.</p>}
  </section>;
}
