const assert = require('node:assert/strict');
const test = require('node:test');
const {host, nodes, context} = require('./helpers/scores-harness.cjs');
context.capturePull = true;
const Home = require('../components/home/SportHomePage.tsx').default;
const Refresh = require('../components/ui/ScoresRefreshButton.tsx').default;
const Indicator = require('../components/ui/PullToRefreshIndicator.tsx').default;
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = (body, ok = true) => ({ok, json: async () => body});
global.window = {setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}};
const summary = {latestSlate: {id: 1, date: '2026-09-09', first_game_start_time: '2020-01-01', is_locked: false}, latestSlateRows: [], funFacts: []};
async function setup(sport) {
  context.sport = sport; context.group = 'a'; context.loading = false;
  const calls = [];
  global.fetch = async url => { calls.push(url); return reply(url.startsWith('/api/home-summary') ? summary : {}); };
  const h = host(Home().props.children.type);
  h.render({}, true); await tick();
  let tree = h.render({}, true); await tick(); tree = h.render({});
  calls.length = 0;
  return {h, tree, calls};
}

test('NBA Home exits the loading scope for a valid no-slate response', async () => {
  context.sport = 'nba'; context.group = 'no-slate-group'; context.loading = false; context.switching = false;
  global.fetch = async url => reply(url.startsWith('/api/home-summary') ? {
    success: true, latestSlate: null, nextSlate: null, latestSlateRows: [], seasonSnapshot: [], funFacts: [], latestSeason: 2026,
  } : {});
  const h = host(Home().props.children.type);
  h.render({}, true); await tick();
  let tree = h.render({}, true); await tick(); tree = h.render({});
  assert.equal(nodes(tree).some(n => n.props?.children === 'Loading current slate...'), false);
  assert.ok(nodes(tree).some(n => n.props?.children === 'No current slate data available yet.'));
  h.unmount();
});

test('NBA Home acknowledges a failed summary response and exposes retry instead of loading forever', async () => {
  context.sport = 'nba'; context.group = 'error-group'; context.loading = false; context.switching = false;
  global.fetch = async url => reply(url.startsWith('/api/home-summary') ? {error: 'NBA summary unavailable'} : {}, false);
  const h = host(Home().props.children.type);
  h.render({}, true); await tick();
  let tree = h.render({}, true); await tick(); tree = h.render({});
  assert.equal(nodes(tree).some(n => n.props?.children === 'Loading current slate...'), false);
  assert.ok(nodes(tree).some(n => n.props?.children === 'Could not load current slate.'));
  assert.ok(nodes(tree).some(n => n.props?.children === 'Try again'));
  h.unmount();
});

test('NBA Home treats a resolved absence of an active Group as an error state, not an endless slate load', async () => {
  context.sport = 'nba'; context.group = null; context.loading = false; context.switching = false;
  const calls = [];
  global.fetch = async url => { calls.push(url); return reply({}); };
  const h = host(Home().props.children.type);
  h.render({}, true); await tick();
  let tree = h.render({}, true); await tick(); tree = h.render({});
  assert.equal(calls.some(url => url.startsWith('/api/home-summary')), false);
  assert.equal(nodes(tree).some(n => n.props?.children === 'Loading current slate...'), false);
  assert.ok(nodes(tree).some(n => n.props?.children === 'No active Group is available.'));
  h.unmount(); context.group = 'group-a';
});

test('NBA Home initiates its scoped summary request when a Group ID is present before GroupProvider clears its loading flag', async () => {
  context.sport = 'nba'; context.group = 'resolved-group'; context.loading = true; context.switching = false;
  const pending = [];
  global.fetch = url => new Promise(resolve => pending.push({url, resolve}));
  const h = host(Home().props.children.type);
  h.render({}, true);
  assert.ok(pending.some(request => request.url === '/api/home-summary?sport=nba'));

  // The Group loading flag may settle after the scoped request has started.
  // That transition must not invalidate this request or strand Home loading.
  context.loading = false;
  h.render({}, true);
  for (const request of pending) request.resolve(reply(request.url.startsWith('/api/home-summary') ? summary : {}));
  await tick();
  const tree = h.render({}, true);
  assert.equal(nodes(tree).some(n => n.props?.children === 'Loading current slate...'), false);
  h.unmount(); context.group = 'group-a'; context.loading = false;
});

test('NBA Home accepts the current response after development Strict Mode replays effects', async () => {
  context.sport = 'nba'; context.group = 'strict-group'; context.loading = false; context.switching = false;
  const pending = [];
  global.fetch = url => new Promise(resolve => pending.push({url, resolve}));
  const h = host(Home().props.children.type);
  h.render({}, true);
  h.strictReplayEffects();
  assert.equal(pending.filter(request => request.url === '/api/home-summary?sport=nba').length, 2);

  // The first request belongs to the pre-replay scope. The second must capture
  // the post-cleanup scope and therefore remain eligible to apply its response.
  pending[0].resolve(reply(summary));
  pending[1].resolve(reply(summary));
  await tick(); await tick();
  const tree = h.render({}, true);
  assert.equal(nodes(tree).some(n => n.props?.children === 'Loading current slate...'), false);
  h.unmount(); context.group = 'group-a';
});
for (const sport of ['nba','nfl']) test(`${sport} pull and compact fallback share existing provider and summary refresh; concurrent actions skip`, async () => {
  const {h, tree, calls} = await setup(sport);
  assert.equal(context.pullOptions.enabled, true);
  const button = nodes(tree).find(n => n.type === Refresh);
  assert.equal(button.props.label, 'Refresh');
  assert.equal(Refresh(button.props).props['aria-label'], 'Refresh');
  const pending = context.pullOptions.onRefresh();
  assert.equal((await context.pullOptions.onRefresh()).status, 'skipped');
  assert.equal((await pending).status, 'success');
  assert.ok(calls.includes(sport === 'nba' ? '/api/refresh-stats' : '/api/refresh-stats-nfl'));
  assert.ok(calls.includes(`/api/home-summary?sport=${sport}`));
  const after = h.render({});
  assert.equal(nodes(after).find(n => n.type === Indicator).props.feedback, 'Updated just now');
  calls.length = 0; button.props.onRefresh(); await tick();
  assert.ok(calls.includes(`/api/home-summary?sport=${sport}`));
  assert.ok(!nodes(tree).some(n => n.props?.children === '↻ Refresh'));
  h.unmount();
});
test('error does not report success; stale Group A-B-A and unmount reject completion', async () => {
  for (const change of ['error','group','unmount']) {
    const {h} = await setup('nfl'); let resolve;
    global.fetch = async () => new Promise(r => {resolve = r;});
    const pending = context.pullOptions.onRefresh();
    if (change === 'group') {context.group = 'b'; h.render({}); context.group = 'a'; h.render({});}
    if (change === 'unmount') h.unmount();
    resolve(reply({error:'Unavailable'}, false));
    assert.equal((await pending).status, change === 'error' ? 'error' : 'skipped');
    if (change === 'error') assert.equal(nodes(h.render({})).find(n => n.type === Indicator).props.feedback, 'Unable to refresh');
    h.unmount();
  }
});
test('upcoming/locked Home preserves summary-only refresh, including Golf', async () => {
  summary.latestSlate.is_locked = true;
  const {h,calls} = await setup('nfl');
  assert.equal((await context.pullOptions.onRefresh()).status,'success');
  assert.ok(!calls.some(url => url.startsWith('/api/refresh-stats')));
  h.unmount();
  const golf = await setup('golf');
  assert.equal(context.pullOptions.enabled, true);
  assert.ok(nodes(golf.tree).some(n => n.type === Refresh));
  assert.equal((await context.pullOptions.onRefresh()).status, 'success');
  assert.ok(golf.calls.includes('/api/home-summary?sport=golf'));
  assert.ok(!golf.calls.some(url => url.startsWith('/api/refresh-stats')));
  golf.h.unmount(); summary.latestSlate.is_locked = false;
});

test('Golf Home keeps an upcoming slate visible before fantasy scoring rows exist', () => {
  const source = require('node:fs').readFileSync('components/home/SportHomePage.tsx', 'utf8');
  assert.match(source, /latestSlateRows\.length === 0 && isGolf && latestSlate/);
  assert.match(source, /Fantasy scoring will appear when tournament results are available/);
  assert.match(source, /View Lineup/);
});

test('Golf Home does not wait for optional player stats before resolving its slate', () => {
  const source = require('node:fs').readFileSync('components/home/SportHomePage.tsx', 'utf8');
  assert.match(source, /void \(async \(\) => \{/);
  assert.match(source, /Failed to load Golf player stats/);
});

test('Golf Home renders an upcoming slate when optional scoring reads are unavailable', async () => {
  const prior = { ...summary.latestSlate };
  const priorDocument = global.document;
  try {
    global.document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };
    global.window = { ...global.window, setInterval, clearInterval };
    summary.latestSlate = { id: 1, display_name: 'Biltmore Championship Asheville', date: '2026-09-17', start_date: '2026-09-17', end_date: '2026-09-20', first_game_start_time: null, is_locked: false };
    const { h } = await setup('golf');
    await tick();
    const tree = h.render({});
    assert.equal(nodes(tree).some(n => n.props?.children === 'Loading current slate...'), false);
    assert.ok(nodes(tree).some(n => n.props?.children === 'Upcoming'));
    h.unmount();
  } finally {
    summary.latestSlate = prior;
    global.document = priorDocument;
  }
});

test('Golf Home navigation render never starts a Golf stats refresh', async () => {
  const prior = { ...summary.latestSlate };
  const priorDocument = global.document;
  const priorWindow = global.window;
  try {
    summary.latestSlate = { id: 1, display_name: 'Biltmore', date: '2026-09-17', first_game_start_time: '2020-01-01', is_locked: false };
    global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
    global.window = { ...priorWindow, setInterval, clearInterval };
    const { h, calls } = await setup('golf');
    await tick();
    h.render({}, true);
    await tick();
    assert.ok(!calls.some(url => String(url).includes('/api/golf/refresh-config')));
    assert.ok(!calls.some(url => String(url).includes('/api/refresh-stats-golf')));
    h.unmount();
  } finally {
    summary.latestSlate = prior;
    global.document = priorDocument;
    global.window = priorWindow;
  }
});

test('a valid route sport prevents stale selectedSport from remounting Home through fallback navigation', () => {
  const { shouldFallbackSportSelection } = require('../lib/groups/navigation.ts');
  assert.equal(shouldFallbackSportSelection({ selectedSport: 'nba', routeSport: 'golf', enabledSports: ['golf'] }), false);
  assert.equal(shouldFallbackSportSelection({ selectedSport: 'nba', routeSport: null, enabledSports: ['golf'] }), true);
  assert.equal(shouldFallbackSportSelection({ selectedSport: 'golf', routeSport: 'golf', enabledSports: ['golf'] }), false);
});

test('Home options use shared top-only gesture: short, mid-page and disabled cancel; valid pull refreshes', async () => {
  const {attachPullToRefresh} = require('../lib/client/pullToRefresh.ts');
  const {h, calls} = await setup('nfl');
  const options = context.pullOptions;
  const listeners = new Map();
  const target = {contains: () => true, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name)};
  const document = {querySelector: () => null, scrollingElement: {scrollTop: 0}, documentElement: {style: {
    getPropertyValue: () => '', getPropertyPriority: () => '', setProperty() {}, removeProperty() {},
  }}};
  const cleanup = attachPullToRefresh({target, document, getContext: () => options, onChange() {}, onRefresh: options.onRefresh});
  const emit = (name, y) => listeners.get(name)?.({target: {closest: () => null}, touches: name === 'touchend' ? [] : [{identifier: 0, clientX: 0, clientY: y}], cancelable: true, preventDefault() {}});
  const pull = async distance => {emit('touchstart', 0); emit('touchmove', distance); emit('touchend', distance); await tick();};
  await pull(40); assert.equal(calls.length, 0);
  document.scrollingElement.scrollTop = 100; await pull(90); assert.equal(calls.length, 0);
  document.scrollingElement.scrollTop = 0; options.enabled = false; await pull(90); assert.equal(calls.length, 0);
  options.enabled = true; await pull(90); assert.ok(calls.includes('/api/refresh-stats-nfl'));
  cleanup(); h.unmount();
});

test('NFL Home resumes loading when Group readiness changes without changing Group id', async () => {
  for (const flag of ['loading', 'switching']) {
    context.sport = 'nfl'; context.group = 'a'; context.loading = false; context.switching = false;
    context[flag] = true;
    const pending = [];
    global.fetch = url => new Promise(resolve => pending.push({url, resolve}));
    const h = host(Home().props.children.type);
    h.render({}, true);
    context[flag] = false;
    h.render({}, true);
    for (const request of pending) request.resolve(reply(summary));
    await tick();
    const tree = h.render({}, true);
    assert.equal(nodes(tree).some(n => n.props?.children === 'Loading current slate...'), false);
    assert.equal(context.pullOptions.enabled, true);
    h.unmount();
  }
});

test('NFL Home refreshes Week 1 with a missing first-game timestamp', async () => {
  const original = summary.latestSlate.first_game_start_time;
  summary.latestSlate.first_game_start_time = null;
  summary.latestSlate.start_date = '2020-09-09';
  summary.latestSlate.end_date = '2020-09-14';
  try {
    const {h, calls} = await setup('nfl');
    assert.equal((await context.pullOptions.onRefresh()).status, 'success');
    assert.ok(calls.includes('/api/refresh-stats-nfl'));
    h.unmount();
  } finally { summary.latestSlate.first_game_start_time = original; }
});

test('missing kickoff fallback leaves NBA and future NFL slates on summary-only refresh', async () => {
  const original = {...summary.latestSlate};
  try {
    for (const sport of ['nba', 'nfl']) {
      summary.latestSlate.first_game_start_time = null;
      summary.latestSlate.start_date = sport === 'nfl' ? '2999-09-09' : '2020-09-09';
      const {h, calls} = await setup(sport);
      assert.equal((await context.pullOptions.onRefresh()).status, 'success');
      assert.ok(!calls.some(url => url.startsWith('/api/refresh-stats')));
      h.unmount();
    }
  } finally { summary.latestSlate = original; }
});
