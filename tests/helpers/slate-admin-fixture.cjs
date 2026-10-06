/* In-memory route fixture: no network, credentials, or production database writes. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

function createSlateAdminFixture({ sport = 'nfl', frozen = false, historical = false, stale = false, newMember = false, commissioner = true, user = { id: 'commissioner', systemRole: 'user' }, nflWeek = 6 } = {}) {
  const memberships = [1, 2, 3, 4].map(id => ({ group_id: '111', user_id: `u${id}`, is_active: true }));
  memberships.push({ group_id: '111', user_id: 'u5', is_active: false }, { group_id: 'other', user_id: 'u5', is_active: true });
  if (newMember) memberships.push({ group_id: '111', user_id: 'u6', is_active: true });
  const tables = {
    teams: ['Andy', 'Josh', 'Jon', 'Mark', 'Mark YMCA'].map((name, index) => ({ id: index + 1, name, group_id: '111', user_id: `u${index + 1}` })),
    group_memberships: memberships,
    leagues: [{ id: `${sport}-111`, group_id: '111', sport_key: sport }, { id: `${sport}-other`, group_id: 'other', sport_key: sport }],
    slates: [
      { id: 191, sport, league_id: `${sport}-111`, date: '2099-10-08', start_date: '2099-10-08', end_date: '2099-10-12', is_locked: historical, archived_at: null, display_name: 'Week 5', nba_team_abbreviations: [], cut_penalty_per_round: 10 },
      { id: 190, sport, league_id: `${sport}-111`, date: '2099-10-01', start_date: '2099-10-01', end_date: '2099-10-05', is_locked: true },
      { id: 300, sport, league_id: `${sport}-other`, date: '2099-10-08', start_date: '2099-10-08', end_date: '2099-10-12', is_locked: false },
    ],
    slate_teams: [2, 3, 4, 1].map((team_id, i) => ({ slate_id: 191, team_id, draft_order: i + 1, is_participating: team_id !== 3 })),
    team_slate_results: [1, 4, 3, 2, 5].map((team_id, i) => ({ slate_id: 190, team_id, finish_position: i + 1, fantasy_points: 120 - i * 10 })),
    fantasy_drafts: frozen ? [{ slate_id: 191, participant_ids: [2, 4, 1] }] : [],
    draft_picks: frozen ? [{ slate_id: 191, team_id: 2, overall_pick: 1 }] : [],
    draft_corrections: [], lineups: [], lineup_players: [], golf_event_players: [],
    player_slate_stats: [], player_nfl_slate_stats: [], nfl_sync_state: [], notification_history: [],
    golf_salary_cap_lineups: [], golf_snake_period_lineups: [], roster_slots: [], slate_nba_games: [],
  };
  tables.teams.push({ id: 11, name: 'Other Group YMCA', group_id: 'other', user_id: 'u5' });
  tables.slate_teams.push({ slate_id: 300, team_id: 11, draft_order: 1, is_participating: true });
  if (newMember) tables.teams.push({ id: 6, name: 'New Member', group_id: '111', user_id: 'u6' });
  if (stale || historical) tables.slate_teams.push({ slate_id: 191, team_id: 5, draft_order: 5, is_participating: historical });
  const writes = [], reads = [], errors = {}, rpcCalls = [], rpcErrors = {};
  let discardResult;
  const db = { from(table) {
    if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
    const filters = [], orders = [];
    let limit = Infinity, single = false, operation = null, payload;
    const q = {
      select() { return q; }, eq(key, value) { filters.push(row => row[key] === value); return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); return q; },
      lt(key, value) { filters.push(row => row[key] < value); return q; },
      is(key, value) { filters.push(row => (row[key] ?? null) === value); return q; },
      order(key, options = {}) { orders.push([key, options.ascending !== false]); return q; },
      limit(value) { limit = value; return q; }, single() { single = true; return q; }, maybeSingle() { single = true; return q; },
      insert(value) { operation = 'insert'; payload = value; return q; },
      upsert(value) { operation = 'upsert'; payload = value; return q; },
      update(value) { operation = 'update'; payload = value; return q; },
      delete() { throw new Error('Deletion is forbidden in this fixture'); },
      then(resolve, reject) {
        try {
          if (errors[table]) return Promise.resolve(resolve({ data: null, error: errors[table] }));
          let data = tables[table].filter(row => filters.every(filter => filter(row)));
          if (operation) {
            if (!['slates', 'slate_teams', 'roster_slots', 'slate_nba_games'].includes(table)) throw new Error(`Forbidden mutation of ${table}`);
            writes.push({ table, operation, payload: structuredClone(payload) });
            if (operation === 'update') data.forEach(row => Object.assign(row, payload));
            else {
              data = (Array.isArray(payload) ? payload : [payload]).map(row => {
                const existing = operation === 'upsert' && tables[table].find(r => r.slate_id === row.slate_id && r.team_id === row.team_id);
                if (existing) return Object.assign(existing, row);
                const added = { id: table === 'slates' ? 400 : tables[table].length + 1, ...row };
                tables[table].push(added); return added;
              });
            }
          } else reads.push({ table, data: structuredClone(data) });
          data = [...data].sort((a, b) => {
            for (const [key, asc] of orders) if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (asc ? 1 : -1);
            return 0;
          }).slice(0, limit);
          return Promise.resolve(resolve({ data: single ? data[0] ?? null : structuredClone(data), error: null, count: data.length }));
        } catch (error) { return reject ? reject(error) : Promise.reject(error); }
      },
    }; return q;
  } };
  // Browser/API fixture only; real permissions, atomicity and concurrency are
  // tested separately against the actual migrations in isolated PostgreSQL.
  db.rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (rpcErrors[name]) return { data: null, error: rpcErrors[name] };
    const slate = tables.slates.find(s => s.id === args.p_slate_id);
    let code = !slate ? 'not_found' : slate.sport !== 'nfl' ? 'unsupported_sport'
      : slate.is_locked ? 'locked' : !slate.start_date || slate.start_date < '2099-01-01' ? 'not_pre_game'
      : ['team_slate_results', 'player_slate_stats', 'player_nfl_slate_stats'].some(t => tables[t].some(r => r.slate_id === slate.id)) ? 'scoring_exists'
      : tables.nfl_sync_state.some(r => r.slate_id === slate.id) ? 'scoring_activity' : 'eligible';
    const reason = code === 'eligible' ? null : `Discard rejected: ${code}`;
    if (name === 'inspect_nfl_slate_discard') return { data: { eligible: code === 'eligible', code, reason }, error: null };
    if (name !== 'discard_abandoned_nfl_slate') throw new Error(`Unexpected RPC ${name}`);
    if (discardResult) return { data: discardResult, error: null };
    if (code !== 'eligible') return { data: { success: false, code, reason }, error: null };
    const ids = tables.lineups.filter(l => l.slate_id === slate.id).map(l => l.id);
    tables.lineup_players = tables.lineup_players.filter(p => !ids.includes(p.lineup_id));
    for (const table of ['draft_corrections', 'draft_picks', 'lineups', 'fantasy_drafts', 'slate_teams']) {
      tables[table] = tables[table].filter(row => row.slate_id !== slate.id);
    }
    let notificationsDetached = 0;
    tables.notification_history.filter(n => n.slate_id === slate.id).forEach(n => {
      n.slate_id = null; n.metadata = { ...n.metadata, discardedSlate: { id: slate.id } }; notificationsDetached++;
    });
    tables.slates = tables.slates.filter(s => s.id !== slate.id);
    return { data: { success: true, code: 'discarded', notificationsDetached }, error: null };
  };
  let groupId = '111';
  const context = () => ({ group: { id: groupId }, canAdministerGroup: commissioner, leagues: [{ id: `${sport}-${groupId}`, isEnabled: true }] });
  const mocks = {
    'server-only': {},
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/lib/auth': { getCurrentUser: async () => user },
    '@/lib/groups/context': {
      getGroupContextForUser: async () => context(),
      getActiveLeagueForSport: async () => ({ context: context(), league: { id: `${sport}-${groupId}`, settings: {}, settingsVersion: 1 } }),
    },
    '@/lib/requireAdminApi': { requireAdminApi: async () => null },
    '@/lib/providers/nflWeeks': {
      fetchNflWeek: async () => ({ name: `2099 Week ${nflWeek}`, startDate: nflWeek === 5 ? '2099-10-08' : '2099-10-15', endDate: nflWeek === 5 ? '2099-10-12' : '2099-10-19' }),
      fetchNflWeekSelection: async () => ({ season: 2099, week: nflWeek, name: `2099 Week ${nflWeek}`, startDate: nflWeek === 5 ? '2099-10-08' : '2099-10-15', endDate: nflWeek === 5 ? '2099-10-12' : '2099-10-19', gameCount: 15, weeks: [{ value: nflWeek, label: `Week ${nflWeek}` }] }),
      validateNflWeekDates: () => true,
      isDuplicateNflWeek: (slate, leagueId, week) => load('lib/providers/nflWeeks.ts').isDuplicateNflWeek(slate, leagueId, week),
    },
  };
  const cache = {};
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache[filename]) return cache[filename];
    const exports = cache[filename] = {};
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
    }).outputText;
    new Function('require', 'exports', code)(id => {
      if (id in mocks) return mocks[id];
      const target = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(filename), id);
      return load(target.endsWith('.ts') ? target : `${target}.ts`);
    }, exports);
    return exports;
  }
  return {
    db, tables, writes, reads, errors, rpcCalls, rpcErrors, load,
    setDiscardResult: result => { discardResult = result; }, switchGroup: id => { groupId = id; },
    route: load('app/api/admin/slates/[slateId]/route.ts'),
    list: load('app/api/admin/slates/route.ts'),
    reseed: load('app/api/admin/slates/[slateId]/reseed/route.ts'),
    creation: load('app/api/slates/route.ts'),
    week: load('app/api/slates/nfl-week/route.ts'),
    context: id => ({ params: Promise.resolve({ slateId: String(id ?? 191) }) }),
    request: body => ({ json: async () => body }),
  };
}
module.exports = { createSlateAdminFixture };
