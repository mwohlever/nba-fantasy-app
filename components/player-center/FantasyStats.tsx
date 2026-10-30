"use client";

import { useId, useRef, useState } from "react";
import { formatStat, gameIdentifier, venueLabel } from "@/lib/player-center/display";
import type { CenterProfile } from "@/lib/player-center/presentation";
import { defaultTrendPeriod, fantasyTrend, fantasyTrendGames, trendGeometry, type TrendPeriod } from "@/lib/player-center/fantasyTrend";

export default function FantasyStats({ profile, position, basis }: { profile: CenterProfile; position: string; basis: string }) {
  const [period, setPeriod] = useState<TrendPeriod>(() => defaultTrendPeriod(fantasyTrendGames(profile)));
  const [selected, setSelected] = useState<string | null>(null);
  const chart = useRef<HTMLDivElement>(null), description = useId();
  if (position === "K") return <div className="pc-empty"><strong>Kicker fantasy scoring unavailable</strong><p>{profile.kickerScoringDecision} Verified FG and PAT statistics are available in the game log.</p></div>;
  const trend = fantasyTrend(profile, period), geometry = trendGeometry(trend.points);
  const selectedIndex = Math.max(0, selected === null ? trend.points.length - 1 : trend.points.findIndex(point => point.game.eventId === selected));
  const active = trend.points[selectedIndex];
  const shortLabel = (index: number) => {
    const game = trend.points[index].game;
    const date = new Date(game.gameAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    return `${profile.player.sport === "nfl" && game.week !== null ? `W${game.week}` : date} ${venueLabel(game)} ${game.opponent ?? "?"}`;
  };
  const selectNearest = (clientX: number) => {
    const bounds = chart.current?.getBoundingClientRect();
    if (!bounds || !trend.points.length) return;
    const x = (clientX - bounds.left) / bounds.width * 100;
    const index = geometry.coordinates.reduce((best, point, index, all) => Math.abs(point.x - x) < Math.abs(all[best].x - x) ? index : best, 0);
    setSelected(trend.points[index].game.eventId);
  };
  return <section className="pc-fantasy pc-trend" aria-label="Fantasy performance trends">
    <div className="pc-trend-heading"><h3>Fantasy trends</h3><div className="pc-window" aria-label="Fantasy chart period">
      {([["last5", "Last 5"], ["last10", "Last 10"], ["season", "Season"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); setSelected(null); }}>{label}</button>)}
    </div></div>
    <dl className="pc-trend-metrics" aria-label="Selected period fantasy metrics">
      <div><dt>{trend.complete ? "Average FP" : "Verified-game average FP"}</dt><dd>{formatStat(trend.average, 2)}</dd></div>
      <div><dt>High FP</dt><dd>{formatStat(trend.high, 2)}</dd></div>
      <div><dt>Low FP</dt><dd>{formatStat(trend.low, 2)}</dd></div>
    </dl>
    <p className="pc-trend-sample">{trend.verified} / {trend.points.length} observed games scored{!trend.complete && trend.points.length > 0 ? " · verified scores only; period coverage incomplete" : ""}</p>
    {trend.points.length ? <>
      <div className="pc-trend-legend"><span><i />Game FP</span>{trend.average !== null && <span><i className="pc-trend-dash" />{trend.complete ? "Period average" : "Verified-game average"}</span>}{trend.verified < trend.points.length && <span>× Unavailable</span>}</div>
      <div className="pc-trend-chart" role="group" aria-label="Chronological fantasy points chart" aria-describedby={description}>
        <div className="pc-trend-axis" aria-hidden="true">{geometry.ticks.map((value, i) => <span key={i} style={{ top: `${8 + i * 42}%` }}>{formatStat(value)}</span>)}</div>
        <div className="pc-trend-plot" ref={chart} onPointerMove={event => { if (event.pointerType === "mouse") selectNearest(event.clientX); }} onClick={event => selectNearest(event.clientX)}>
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {[8, 50, 92].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y} className="pc-trend-grid" />)}
            {trend.average !== null && <line x1="0" x2="100" y1={geometry.y(trend.average)} y2={geometry.y(trend.average)} className="pc-trend-average" />}
            <path d={geometry.path} className="pc-trend-line" />
          </svg>
          {trend.points.map((point, index) => {
            const coordinate = geometry.coordinates[index], label = gameIdentifier(point.game, profile.player.sport);
            return <button type="button" key={point.game.eventId} className={`pc-trend-point${point.points === null ? " pc-trend-missing" : ""}`} data-event-id={point.game.eventId} data-fp={point.points ?? "unavailable"}
              style={{ left: `${coordinate.x}%`, top: coordinate.y === null ? "calc(100% + 13px)" : `${coordinate.y}%`, width: `min(36px, ${90 / Math.max(1, trend.points.length - 1)}%)` }}
              aria-label={`${label}: ${point.points === null ? "Fantasy points unavailable; incomplete scoring data" : `${formatStat(point.points, 10)} fantasy points`}`}
              aria-pressed={index === selectedIndex} tabIndex={index === selectedIndex ? 0 : -1}
              onFocus={() => setSelected(point.game.eventId)} onClick={event => { event.stopPropagation(); setSelected(point.game.eventId); }} onKeyDown={event => {
                const next = event.key === "ArrowRight" ? Math.min(index + 1, trend.points.length - 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? trend.points.length - 1 : null;
                if (next !== null) { event.preventDefault(); chart.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus(); }
              }}><span aria-hidden="true">{point.points === null ? "×" : ""}</span></button>;
          })}
        </div>
        <div className="pc-trend-labels" aria-hidden="true">{[...new Set([0, ...(trend.points.length > 4 ? [Math.floor((trend.points.length - 1) / 2)] : []), trend.points.length - 1])].map(index => <span key={index}>{shortLabel(index)}</span>)}</div>
      </div>
      <div className="pc-trend-detail" role="status" aria-live="polite" aria-atomic="true"><span>{active && gameIdentifier(active.game, profile.player.sport)}</span><strong>{active?.points == null ? "Unavailable" : `${formatStat(active.points, 10)} FP`}</strong>{active?.points == null && <small>Incomplete scoring data · no score plotted</small>}</div>
      <p className="pc-footnote" id={description}>Oldest → newest. Hover, tap or focus a point; use arrow keys to move between games.{trend.verified < trend.points.length ? " × marks an unavailable score below the plot; the line breaks across gaps." : ""}</p>
    </> : <div className="pc-empty"><strong>No completed fantasy scores yet</strong><p>Verified completed appearances will appear here. Missing games, DNP, live games and byes are not zero-point games.</p></div>}
    <p className="pc-scoring-basis">{basis} · actual research scores, not saved slate results. {trend.complete ? "Verified period." : "Averages and high/low describe verified scores only, not a certified full-period comparison."}</p>
  </section>;
}
