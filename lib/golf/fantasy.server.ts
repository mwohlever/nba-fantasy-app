import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { resolveGolfRules } from '../rules/leagueRules';
import { resolveGolfScoringRosters, type GolfStoredRoster } from './rosterResolution';
import { calculateGolfCompetition } from './competition';
import { canViewerSeeGolfRosterPeriod, type GolfRosterVisibilityPeriod } from './rosterVisibility';

function checked(result: { data: any; error: { message: string } | null }) {
  if (result.error) throw new Error(`Golf fantasy: ${result.error.message}`);
  return result.data;
}

/** Callers authorize Group/slate access first. All source queries retain slate scope. */
export async function loadGolfRosters(slateId: number, snapshot: Record<string, unknown> | null, teamIds: number[]) {
  const rules = resolveGolfRules(snapshot);
  let snake: Array<{ team_id: number; lineup_players: Array<{ player_id: number }> }> = [];
  let salaryCap: GolfStoredRoster[] = [], snakePeriods: GolfStoredRoster[] = [];
  if (rules.draft.type === 'salary_cap') {
    const rows = checked(await supabaseAdmin.from('golf_salary_cap_lineups')
      .select('team_id, golf_roster_periods!inner(period_key), golf_salary_cap_lineup_players(player_id)').eq('slate_id', slateId));
    salaryCap = (rows ?? []).map((r: any) => ({ team_id: Number(r.team_id),
      period_key: r.golf_roster_periods.period_key,
      player_ids: (r.golf_salary_cap_lineup_players ?? []).map((p: any) => Number(p.player_id)) }));
  } else {
    snake = checked(await supabaseAdmin.from('lineups').select('team_id, lineup_players(player_id)').eq('slate_id', slateId)) ?? [];
    if (rules.rosterPeriods.type === 'split_after_round_2') {
      snakePeriods = checked(await supabaseAdmin.from('golf_snake_period_lineups').select('team_id, period_key, player_ids').eq('slate_id', slateId)) ?? [];
    }
  }
  return resolveGolfScoringRosters({ snapshot, teamIds, snake, salaryCap, snakePeriods });
}

export async function loadGolfFantasy(slateId: number, scope?: { groupId: string; viewerTeamId?: number | null }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = checked(await supabaseAdmin.from('golf_accepted_versions').select('revision').eq('slate_id', slateId).maybeSingle());
    const results = await Promise.all([
      supabaseAdmin.from('slates').select('id, sport, rules_snapshot, has_cut, cut_penalty_per_round').eq('id', slateId).single(),
      supabaseAdmin.from('golf_event_players').select('*, golf_players(display_name, espn_player_id, headshot_url, country, owgr_rank), golf_rounds(*, golf_holes(*))').eq('slate_id', slateId),
      supabaseAdmin.from('golf_course_holes').select('hole_number, par, is_host').eq('slate_id', slateId).order('is_host', { ascending: false }).order('hole_number', { ascending: true }),
      supabaseAdmin.from('slate_teams').select('team_id, draft_order, is_participating, teams!inner(name, group_id, user_id)').eq('slate_id', slateId).eq('is_participating', true),
      scope ? supabaseAdmin.from('group_memberships').select('user_id').eq('group_id', scope.groupId).eq('is_active', true) : Promise.resolve({ data: null, error: null }),
    ]);
    const [slate, events, courseHoleRows, slateTeamRows, membershipRows] = results.map(checked);
    if (slate.sport !== 'golf') throw new Error('Golf slate required');
    const activeUsers = new Set((membershipRows ?? []).map((row: any) => String(row.user_id)));
    const slateTeams = (slateTeamRows ?? []).filter((row: any) => !scope || (
      row.teams?.group_id === scope.groupId && activeUsers.has(String(row.teams?.user_id))
    ));
    const [rosters, periodResult] = await Promise.all([
      loadGolfRosters(slateId, slate.rules_snapshot, slateTeams.map((t: any) => Number(t.team_id))),
      supabaseAdmin.from('golf_roster_periods').select('period_key, locked_at, completed_at, started_rounds, evidence_snapshot').eq('slate_id', slateId),
    ]);
    const periods = checked(periodResult) as GolfRosterVisibilityPeriod[];
    const periodByKey = new Map(periods.map(period => [period.period_key, period]));
    const after = checked(await supabaseAdmin.from('golf_accepted_versions').select('revision').eq('slate_id', slateId).maybeSingle());
    if (Number(before?.revision ?? 0) !== Number(after?.revision ?? 0)) continue;
    const teams = calculateGolfCompetition({ slateId, snapshot: slate.rules_snapshot, events, rosters, slateTeams,
      penaltyPerRound: slate.has_cut ? Number(slate.cut_penalty_per_round ?? 0) : 0 });
    const visibleRosters = rosters.map(roster => ({ ...roster, periods: roster.periods.map(period =>
      canViewerSeeGolfRosterPeriod({ snapshot: slate.rules_snapshot, period: periodByKey.get(period.period), viewerTeamId: scope?.viewerTeamId, rosterTeamId: roster.teamId })
        ? period : { ...period, playerIds: [] }) }));
    const courseHoleByNumber = new Map<number, { holeNumber: number; par: number | null }>();
    (courseHoleRows ?? []).forEach((hole: any) => {
      const holeNumber = Number(hole.hole_number);
      if (!courseHoleByNumber.has(holeNumber)) courseHoleByNumber.set(holeNumber, { holeNumber, par: hole.par == null ? null : Number(hole.par) });
    });
    return { rules: resolveGolfRules(slate.rules_snapshot), rosters: visibleRosters, events,
      courseHoles: [...courseHoleByNumber.values()],
      teams: teams.map(t => {
        const hiddenRosterPeriods = t.contributions.map(contribution => contribution.period).filter((period, index, all) =>
          all.indexOf(period) === index && !canViewerSeeGolfRosterPeriod({ snapshot: slate.rules_snapshot, period: periodByKey.get(period), viewerTeamId: scope?.viewerTeamId, rosterTeamId: t.team_id }));
        return { ...t, name: slateTeams.find((s: any) => Number(s.team_id) === t.team_id)?.teams?.name ?? 'Team',
          contributions: t.contributions.filter(contribution => !hiddenRosterPeriods.includes(contribution.period)),
          bestBallRounds: t.bestBallRounds?.filter(round => !hiddenRosterPeriods.includes(round.period)),
          hiddenRosterPeriods };
      }) };
  }
  throw new Error('Golf results changed while loading; refresh and try again.');
}
