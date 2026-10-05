// Local PostgREST-shaped boundary for browser acceptance against current routes.
// Reads captured historical SELECT results. It never connects to a database.
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';

const snapshot = JSON.parse(fs.readFileSync('tmp/shotcast-take2/history.json', 'utf8'));
const tables = snapshot.tables;
let activeSlateId = 163;
const team = tables.teams.find(row => row.name === 'Mark');
const account = { id: team.user_id, team_id: team.id, display_name: team.name, role: 'player', system_role: 'user', is_active: true,
  avatar_url: null, email: null, auth_user_id: null, pin_salt: '', pin_hash: '' };
const token = 'shotcast-take2-local-validation';
const session = { id: 'local-validation-session', user_id: account.id, token_hash: createHash('sha256').update(token).digest('hex'),
  expires_at: '2099-01-01T00:00:00Z', app_users: account };
const holes = new Map(), rounds = new Map();
for (const hole of tables.golf_holes) { const list = holes.get(hole.round_id) ?? []; list.push(hole); holes.set(hole.round_id, list); }
for (const round of tables.golf_rounds) { const list = rounds.get(round.event_player_id) ?? []; list.push({ ...round, golf_holes: holes.get(round.id) ?? [] }); rounds.set(round.event_player_id, list); }
const errors = [];
const mutations = [];
const value = input => input === 'null' ? null : input === 'true' ? true : input === 'false' ? false : /^-?\d+(\.\d+)?$/.test(input) ? Number(input) : input.replace(/^"|"$/g, '');
const property = (row, key) => key.split('.').reduce((result, part) => result?.[part], row);
function select(table, params) {
  let rows;
  if (table === 'user_sessions') rows = [session];
  else if (table === 'app_users') rows = tables.teams.map(t => ({ ...account, id: t.user_id, team_id: t.id, display_name: t.name }));
  else if (table === 'slates') rows = tables.slates.filter(row => row.id === activeSlateId);
  else if (table === 'golf_slate_shotcast_manifests') rows = [];
  else if (tables[table]) rows = tables[table];
  else { errors.push(`Unknown table ${table}`); rows = []; }
  const selection = params.get('select') ?? '';
  rows = rows.map(row => {
    if (table === 'slates' && selection.includes('golf_event_players')) return { ...row,
      golf_event_players: tables.golf_event_players.filter(p => p.slate_id === row.id).map(p => ({ ...p, golf_rounds: rounds.get(p.id) ?? [] })),
      golf_accepted_versions: tables.golf_accepted_versions.filter(v => v.slate_id === row.id),
      team_slate_results: tables.team_slate_results.filter(r => r.slate_id === row.id),
    };
    if (table === 'group_memberships' && selection.includes('groups')) return { ...row, groups: tables.groups.find(g => g.id === row.group_id) };
    if (table === 'slate_teams' && selection.includes('teams')) return { ...row, teams: tables.teams.find(t => t.id === row.team_id) };
    if (table === 'lineups' && selection.includes('lineup_players')) return { ...row, lineup_players: tables.lineup_players.filter(p => p.lineup_id === row.id) };
    if (table === 'golf_event_players') return { ...row,
      ...(selection.includes('golf_players') ? { golf_players: tables.golf_players.find(p => p.id === row.player_id) } : {}),
      ...(selection.includes('golf_rounds') ? { golf_rounds: rounds.get(row.id) ?? [] } : {}),
    };
    if (table === 'golf_rounds' && selection.includes('golf_holes')) return { ...row, golf_holes: holes.get(row.id) ?? [] };
    return row;
  });
  for (const [key, condition] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(key) || key.endsWith('.order')) continue;
    const match = condition.match(/^(eq|neq|in|is|gte|lte|gt|lt|not\.is)\.(.*)$/);
    if (!match) { errors.push(`Unsupported filter ${key}=${condition}`); continue; }
    const [, operator, operand] = match;
    rows = rows.filter(row => {
      const actual = property(row, key), expected = value(operand);
      if (operator === 'eq' || operator === 'is') return actual === expected;
      if (operator === 'neq' || operator === 'not.is') return actual !== expected;
      if (operator === 'in') return operand.slice(1, -1).split(',').map(value).includes(actual);
      if (operator === 'gte') return actual >= expected;
      if (operator === 'lte') return actual <= expected;
      if (operator === 'gt') return actual > expected;
      return actual < expected;
    });
  }
  const ordering = (params.get('order') ?? '').split(',').filter(Boolean);
  rows = [...rows].sort((a, b) => {
    for (const order of ordering) {
      const [key, direction] = order.split('.'), av = a[key], bv = b[key];
      if (av === bv) continue;
      return (av == null ? 1 : bv == null ? -1 : av < bv ? -1 : 1) * (direction === 'desc' ? -1 : 1);
    }
    return 0;
  });
  return rows.slice(Number(params.get('offset') ?? 0), params.has('limit') ? Number(params.get('offset') ?? 0) + Number(params.get('limit')) : undefined);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/__select') { activeSlateId = Number(url.searchParams.get('slateId')); response.end('{}'); return; }
  if (url.pathname === '/__report') { response.end(JSON.stringify({ source: snapshot.source, activeSlateId, errors, mutations })); return; }
  const table = url.pathname.replace('/rest/v1/', '');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    mutations.push({ method: request.method, table });
    // Current getCurrentUser updates only this local simulated session.
    if (table !== 'user_sessions') { errors.push(`Unexpected mutation ${table}`); response.statusCode = 405; }
    response.end('[]'); return;
  }
  try {
    const rows = select(table, url.searchParams);
    response.setHeader('Content-Range', `0-${Math.max(0, rows.length - 1)}/${rows.length}`);
    if ((request.headers.accept ?? '').includes('vnd.pgrst.object')) {
      if (rows.length !== 1) { response.statusCode = 406; response.end(JSON.stringify({ code: 'PGRST116', details: `The result contains ${rows.length} rows`, message: 'Expected a single row' })); return; }
      response.end(JSON.stringify(rows[0]));
    } else response.end(JSON.stringify(rows));
  } catch (error) { errors.push(String(error)); response.statusCode = 500; response.end(JSON.stringify({ message: String(error) })); }
});
server.listen(Number(process.env.SHOTCAST_HISTORY_PORT ?? 54329), '127.0.0.1', () => console.log('Read-only historical snapshot boundary ready on 54329'));
