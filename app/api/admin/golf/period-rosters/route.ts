import { NextResponse } from 'next/server';
import { authorizeSlateResource } from '@/lib/security/resourceAuthorization';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  const slateId = Number(new URL(request.url).searchParams.get('slateId'));
  if (!Number.isSafeInteger(slateId) || slateId <= 0) return NextResponse.json({ error: 'Valid slate required.' }, { status: 400 });
  const auth = await authorizeSlateResource(request, slateId, { requireCommissioner: true });
  if (!auth.ok) return auth.response;
  const results = await Promise.all([
    supabaseAdmin.from('golf_snake_period_lineups').select('team_id, player_ids, revision').eq('slate_id', slateId),
    supabaseAdmin.from('golf_roster_periods').select('period_key, opened_at, locked_at, completed_at, evidence_snapshot').eq('slate_id', slateId),
    supabaseAdmin.from('golf_event_players').select('player_id, golf_players!inner(display_name)').eq('slate_id', slateId),
  ]);
  const error = results.find(r => r.error)?.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rosters: results[0].data, periods: results[1].data, field: results[2].data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const body = await request.json();
  const slateId = Number(body.slateId);
  if (!Number.isSafeInteger(slateId) || slateId <= 0) return NextResponse.json({ error: 'Valid slate required.' }, { status: 400 });
  const auth = await authorizeSlateResource(request, slateId, { requireCommissioner: true });
  if (!auth.ok) return auth.response;
  if (!auth.user) return NextResponse.json({ error: 'Login required.' }, { status: 401 });
  const scope = { p_slate: slateId, p_group: auth.target.groupId, p_league: auth.target.leagueId, p_actor: auth.user.id };
  if (body.action === 'initialize') {
    const result = await supabaseAdmin.rpc('initialize_golf_lifecycle', scope);
    return NextResponse.json(result.error ? { error: result.error.message } : { success: true }, { status: result.error ? 400 : 200 });
  }
  if (!Array.isArray(body.playerIds) || body.playerIds.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) <= 0) ||
    !Number.isSafeInteger(body.teamId) || (body.expectedRevision !== null && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0))) {
    return NextResponse.json({ error: 'Valid team, golfers, and revision required.' }, { status: 400 });
  }
  const result = await supabaseAdmin.rpc('save_golf_snake_weekend_roster', { ...scope, p_team: body.teamId,
    p_player_ids: body.playerIds, p_expected_revision: body.expectedRevision });
  return NextResponse.json(result.error ? { error: result.error.message } : { success: true }, { status: result.error ? 400 : 200 });
}
