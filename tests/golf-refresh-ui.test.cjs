const assert = require('node:assert/strict');
const test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const React = require('react');
React.useCallback = (fn, deps) => React.useMemo(() => fn, deps);
context.capturePull = true;
const Builder = require('../components/lineups/GolfSalaryCapBuilder.tsx').default;
const { GolfFantasyRows } = require('../components/lineups/GolfScoresDashboard.tsx');
const SalarySetup = require('../components/golf/GolfSalarySetup.tsx').default;
const flush = () => new Promise(resolve => setImmediate(resolve));
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree?.props ? text(tree.props.children) : '';
test('Golf Home and Scores omit the removed tabs and duplicate real-world leaderboard', () => {
  const fs = require('node:fs');
  const scores = fs.readFileSync('components/lineups/GolfScoresDashboard.tsx', 'utf8');
  const home = fs.readFileSync('components/home/SportHomePage.tsx', 'utf8');
  assert.doesNotMatch(scores, /role="tab"|Current Leader|Tournament Leaderboard/);
  assert.doesNotMatch(home, /golfHomeTab|GolfLiveLeaderboard|Full leaderboard →/);
  assert.match(home, /View Scores/);
  assert.match(scores, /previous\?\.scope === scope \? previous : null/);
});

test('independent team expansion survives score updates; collapse affects only one team', () => {
  const h = host(GolfFantasyRows);
  const board = { rules: { gameType: 'standard' }, events: [], teams: [1, 2].map(team_id => ({ team_id, name: `Team ${team_id}`, fantasy_points: -team_id, contributions: [{ playerId: team_id, period: 'opening', score: -1 }] })) };
  const props = { scope: 'group-a:1', board, onPlayer() {} };
  const rows = tree => nodes(tree).filter(n => n.props?.className?.includes('scores-standing-toggle'));
  let tree = h.render(props); rows(tree)[0].props.onClick(); tree = h.render(props);
  rows(tree)[1].props.onClick(); tree = h.render({ ...props, board: { ...board } });
  assert.deepEqual(rows(tree).map(n => n.props['aria-expanded']), [true, true]);
  assert.doesNotMatch(text(tree), /Fantasy/);
  rows(tree)[0].props.onClick(); tree = h.render(props);
  assert.deepEqual(rows(tree).map(n => n.props['aria-expanded']), [false, true]);
  assert.deepEqual(rows(h.render({ ...props, scope: 'group-b:2' })).map(n => n.props['aria-expanded']), [false, false]);
});

test('pull refresh preserves unsaved period selections, flags invalidity and retains revision conflict', async () => {
  const oldFetch = global.fetch;
  let revision = 1, eligible = true, requests = 0;
  global.fetch = async () => { requests++; return { ok: true, json: async () => ({ slate: { id: 1 },
    period: { key: 'weekend', state: 'open' }, periods: [{ key: 'weekend', state: 'open' }], priceSet: { status: 'frozen' },
    budget: 75, rosterSize: 3, lineup: { playerIds: [1], revision },
    golfers: [1, 2, 3].map(playerId => ({ playerId, name: `Golfer ${playerId}`, eligible: playerId !== 2 || eligible, priced: true, effectiveSalary: 25 })) }) }; };
  try {
    const h = host(Builder), props = { initialSlateId: 1, slates: [{ id: 1, label: 'Test' }] };
    h.render(props, true); await flush(); let tree = h.render(props);
    nodes(tree).find(n => n.key === '2' && n.props?.className?.includes('grid w-full')).props.onClick(); tree = h.render(props);
    const refresh = context.pullOptions.onRefresh;
    const first = refresh(), second = refresh();
    assert.equal((await second).status, 'skipped'); await first;
    tree = h.render(props);
    assert.equal(requests, 2);
    assert.match(text(tree), /Unsaved/);
    assert.match(context.pullOptions.scopeKey, /weekend/);
    eligible = false; revision = 2;
    await context.pullOptions.onRefresh(); tree = h.render(props);
    assert.match(text(tree), /Your selections have been retained/);
    assert.match(text(tree), /saved lineup changed elsewhere/);
    await context.pullOptions.onRefresh(); tree = h.render(props);
    assert.match(text(tree), /saved lineup changed elsewhere/);
    assert.equal(nodes(tree).find(n => n.props?.children === 'Save Lineup').props.disabled, true);
    h.unmount();
  } finally { global.fetch = oldFetch; }
});

test('salary setup reviews editable fallback salaries and requires acknowledgement before freeze', async () => {
  const oldFetch = global.fetch;
  let priceSet = null;
  const actions = [];
  const prices = [{ player_id: 1, suggested_salary: 42, override_salary: null, effective_salary: null, value_basis: 'owgr', golf_players: { display_name: 'Supported' } },
    { player_id: 2, suggested_salary: '15.00', override_salary: null, effective_salary: '15.00', value_basis: 'fallback', golf_players: { display_name: 'Fallback' } },
    { player_id: 3, suggested_salary: '15.00', override_salary: null, effective_salary: null, value_basis: 'v1_only', golf_players: { display_name: 'Model Fifteen' } }];
  global.fetch = async (_url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body); actions.push(body);
      if (body.action === 'generate') priceSet = { status: 'generated', revision: 0 };
      if (body.action === 'override') { prices[0].override_salary = body.overrides[0].salary; priceSet.revision++; }
      if (body.action === 'freeze') { priceSet.status = 'frozen'; prices[0].effective_salary = prices[0].override_salary; }
    }
    return { ok: true, json: async () => ({ priceSet, prices }) };
  };
  try {
    const h = host(SalarySetup), props = { slateId: 1 };
    h.render(props, true); await flush(); let tree = h.render(props);
    const button = label => nodes(tree).find(n => n.type === 'button' && n.props.children === label);
    await button('Generate Salaries').props.onClick(); tree = h.render(props);
    assert.match(text(tree), /REVIEW NEEDED/);
    nodes(tree).find(n => n.type === 'input' && n.props.type === 'number').props.onChange({ target: { value: '40' } }); tree = h.render(props);
    assert.equal(button('Freeze Salaries').props.disabled, true);
    await button('Save Overrides').props.onClick(); tree = h.render(props);
    assert.equal(prices[0].suggested_salary, 42);
    assert.match(text(tree), /received the \$15\.00 fallback salary/);
    assert.match(text(tree), /I reviewed the fallback salaries/);
    assert.match(text(tree), /Fallback — review/);
    const rows = nodes(tree).filter(n => n.type === 'tr');
    assert.match(rows.find(row => text(row).includes('Fallback')).props.className, /bg-amber-950\/20/);
    assert.doesNotMatch(rows.find(row => text(row).includes('Model Fifteen')).props.className, /amber/);
    const salaryInputs = nodes(tree).filter(n => n.type === 'input' && n.props.type === 'number');
    assert.equal(salaryInputs.length, 3);
    nodes(tree).find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); tree = h.render(props);
    assert.equal(button('Freeze Salaries').props.disabled, false);
    await button('Freeze Salaries').props.onClick(); tree = h.render(props);
    assert.match(text(tree), /FROZEN/); assert.match(text(tree), /Go to Lineup/);
    assert.equal(nodes(tree).filter(n => n.type === 'input').length, 0);
    assert.deepEqual(actions.map(a => a.action), ['generate', 'override', 'freeze']);
    h.unmount();
  } finally { global.fetch = oldFetch; }
});

test('salary setup exposes regeneration only for a generated board', async () => {
  const oldFetch = global.fetch;
  let priceSet = { status: 'generated', revision: 3 };
  const actions = [];
  global.fetch = async (_url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body);
      actions.push(body.action);
      if (body.action === 'regenerate') priceSet = { status: 'generated', revision: 0 };
    }
    return { ok: true, json: async () => ({ priceSet, prices: [] }) };
  };
  const oldWindow = global.window;
  global.window = { ...(oldWindow ?? {}), confirm: () => true };
  try {
    const h = host(SalarySetup);
    h.render({ slateId: 1 }, true); await flush(); let tree = h.render({ slateId: 1 });
    const button = nodes(tree).find(n => n.type === 'button' && n.props.children === 'Regenerate Salaries');
    await button.props.onClick(); tree = h.render({ slateId: 1 });
    assert.deepEqual(actions, ['regenerate']);
    assert.match(text(tree), /GENERATED/);
    h.unmount();
  } finally {
    global.fetch = oldFetch;
    global.window = oldWindow;
  }
});
