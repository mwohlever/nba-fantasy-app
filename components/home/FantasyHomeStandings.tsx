import TeamAvatar from "@/components/ui/TeamAvatar";

type Row = {
  team_id: number;
  teamName: string;
  avatarUrl?: string | null;
  fantasy_points: number | null;
  games_completed: number | null;
  games_in_progress: number | null;
  games_remaining: number | null;
};

/** Home is a glance at the existing ranking; roster inspection belongs on Scores. */
export default function FantasyHomeStandings({ rows, onProfile }: { rows: Row[]; onProfile: (team: { id: number; name: string }) => void }) {
  return <ol className="fantasy-home-standings m-0 w-full min-w-0 list-none p-0" aria-label="Current fantasy standings">
    {rows.map((row, index) => <li key={row.team_id}
      className="fantasy-home-row grid grid-cols-[1.25rem_2rem_minmax(0,1fr)_auto] items-start gap-x-2 border-t border-[var(--app-border)] py-3">
      <span className="fantasy-home-rank pt-0.5 text-sm text-[var(--app-text-muted)]" aria-label={`Rank ${index + 1}`}>{index + 1}.</span>
      <button type="button" aria-label={`View ${row.teamName} profile`}
        onClick={() => onProfile({ id: row.team_id, name: row.teamName })}
        className="fantasy-home-avatar h-8 w-8 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2">
        <TeamAvatar teamName={row.teamName} avatarUrl={row.avatarUrl} size="sm" />
      </button>
      <div className="fantasy-home-details min-w-0">
        <button type="button" aria-label={`View ${row.teamName} profile`}
          onClick={() => onProfile({ id: row.team_id, name: row.teamName })}
          className="fantasy-home-name block max-w-full truncate text-left text-sm font-bold leading-5 focus-visible:outline-2 focus-visible:outline-offset-2" title={row.teamName}>{row.teamName}</button>
        <span className="fantasy-home-games mt-0.5 block text-xs leading-4 text-[var(--app-text-muted)]">
          {row.games_completed ?? 0} final · {row.games_in_progress ?? 0} live · {row.games_remaining ?? 0} left
        </span>
      </div>
      <strong className="fantasy-home-score flex items-baseline justify-self-end gap-1 whitespace-nowrap text-right text-sm leading-5 tabular-nums">
        <span>{Number(row.fantasy_points ?? 0).toFixed(1)}</span>
        <small className="text-xs font-normal text-[var(--app-text-muted)]">FP</small>
      </strong>
    </li>)}
  </ol>;
}
