/* eslint-disable @typescript-eslint/no-require-imports */
/* Real overview components/hooks with synthetic auth/API/history boundaries. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const { installViewingBrowser } = require('./helpers/viewing-browser.cjs');
const Live = require('../components/live-scores/NbaLiveScores.tsx').default;
const Nfl = require('../components/live-scores/NflLiveScores.tsx').default;
const Ncaa = require('../app/ncaa-pickem/scores/page.tsx').default;
const Center = require('../components/live-scores/NbaGameCenter.tsx').default;
const tick = () => new Promise(resolve => setImmediate(resolve));
const props = { viewerId: 'viewer', context: 'nba' };
const game = { espnEventId: '123', name: 'Warriors at Lakers', status: 'in', startAt: '2026-05-25T23:00Z', statusDetail: 'Q4 2:00',
  awayTeam: { id: '9', displayName: 'Golden State Warriors', abbreviation: 'GSW', record: '40-20', score: 103 },
  homeTeam: { id: '13', displayName: 'Los Angeles Lakers', abbreviation: 'LAL', record: '35-25', score: 104 } };
function reset(mode = 'nba', search = 'date=2026-05-25') {
  context.group = 'a'; context.enabled = ['nba', 'nba_skins', 'nfl', 'ncaa_pickem']; context.loading = false; context.switching = false; context.sport = 'nba';
  const browser = installViewingBrowser(mode === 'nba-skins' ? '/nba-skins/live' : '/live-scores', `${mode === 'nba' ? 'sport=nba&' : ''}${search}`);
  Object.assign(window, { setInterval, clearInterval });
  global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  return browser;
}
async function settle(h, p = props) { let tree; for (let i = 0; i < 5; i++) { tree = h.render(p, true); await tick(); } return tree; }
function fixture(ids = []) {
  const saved = new Set(ids), requests = []; let fail = false;
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (!url.endsWith('/favorites')) return Response.json({ games: [game] });
    if (!options.method) return Response.json({ teamIds: [...saved] });
    if (fail) return Response.json({ error: 'fixture save failed' }, { status: 500 });
    const { teamId } = JSON.parse(options.body);
    if (options.method === 'POST') saved.add(teamId); else saved.delete(teamId);
    return Response.json({ success: true });
  };
  return { saved, requests, setFail(value) { fail = value; } };
}
const cards = tree => nodes(tree).filter(n => n.type?.name === 'GameCard');
function expand(tree) {
  if (Array.isArray(tree)) return tree.flatMap(expand);
  if (!tree || typeof tree !== 'object') return [];
  if (typeof tree.type === 'function') return expand(tree.type(tree.props));
  return [tree, ...expand(tree.props?.children)];
}
function star(card, name) { return expand(card).find(n => n.type === 'button' && n.props['aria-label']?.includes(name)); }
function click(node) {
  let stopped = false;
  const promise = node.props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); return promise;
}
function sections(tree, favoritesCount, scheduleCount = 1) {
  const favorites = nodes(tree).find(n => n.props?.['aria-label'] === 'Favorite NBA games');
  assert.equal(favorites ? cards(favorites).length : 0, favoritesCount);
  assert.equal(cards(nodes(tree).find(n => n.props?.['aria-label'] === 'NBA schedule')).length, scheduleCount);
}
for (const mode of ['nba', 'nba-skins']) test(`${mode}: two independent ESPN team favorites persist, promote once, retain schedule and toggle off`, async () => {
  const browser = reset(mode), f = fixture(), h = host(Live), p = { ...props, context: mode };
  let tree = await settle(h, p); sections(tree, 0);
  const away = star(cards(tree)[0], 'Golden State');
  assert.equal(away.props.children, '☆'); assert.equal(away.props['aria-pressed'], false);
  assert.equal(away.props['aria-label'], 'Add Golden State Warriors to favorites');
  await click(away); tree = await settle(h, p); sections(tree, 1);
  assert.equal(browser.navigation.length, 0, 'Star leaves URL/selection alone');
  assert.equal(star(cards(tree)[0], 'Golden State').props.children, '★');
  assert.equal(star(cards(tree)[0], 'Golden State').props['aria-label'], 'Remove Golden State Warriors from favorites');
  assert.equal(star(cards(tree)[0], 'Los Angeles').props['aria-pressed'], false);
  await click(star(cards(tree)[0], 'Los Angeles')); tree = await settle(h, p); sections(tree, 1);
  assert.deepEqual([...f.saved], ['9', '13']);
  h.remount(p); tree = await settle(h, p); sections(tree, 1);
  assert.ok(['Golden State', 'Los Angeles'].every(name => star(cards(tree)[0], name).props['aria-pressed']));
  await click(star(cards(tree)[0], 'Golden State')); tree = await settle(h, p); sections(tree, 1);
  await click(star(cards(tree)[0], 'Los Angeles')); tree = await settle(h, p); sections(tree, 0);
  assert.deepEqual([...f.saved], []);
  const writes = f.requests.filter(r => r.options.method);
  assert.deepEqual(writes.map(r => [r.options.method, JSON.parse(r.options.body).teamId]), [['POST', '9'], ['POST', '13'], ['DELETE', '9'], ['DELETE', '13']]);
  assert.ok(writes.every(r => r.url === '/api/live-scores/nba/favorites'));
  cards(tree)[0].props.onClick(); tree = await settle(h, p);
  assert.match(context.search, /gameId=123/); assert.ok(nodes(tree).some(n => n.type === Center)); h.unmount();
});
test('Fantasy favorite state is reloaded in Skins and another Group; neither view adds ownership to overview cards', async () => {
  reset(); fixture(); const h = host(Live);
  let tree = await settle(h); await click(star(cards(tree)[0], 'Golden State')); h.unmount();
  reset('nba-skins'); context.group = 'b'; const skins = host(Live), p = { ...props, context: 'nba-skins' };
  tree = await settle(skins, p); sections(tree, 1);
  assert.equal(star(cards(tree)[0], 'Golden State').props['aria-pressed'], true);
  assert.equal(Object.hasOwn(cards(tree)[0].props, 'ownership'), false);
  assert.ok(!expand(cards(tree)[0]).some(n => /owner/i.test(n.props?.['aria-label'] ?? ''))); skins.unmount();
});
test('optimistic save/delete errors roll back only their team and display a recoverable error', async () => {
  reset(); const f = fixture(['13']), h = host(Live); let tree = await settle(h);
  f.setFail(true);
  const saving = click(star(cards(tree)[0], 'Golden State'));
  tree = h.render(props); assert.equal(star(cards(tree)[0], 'Golden State').props['aria-pressed'], true);
  await saving; tree = await settle(h);
  assert.equal(star(cards(tree)[0], 'Golden State').props['aria-pressed'], false);
  assert.equal(star(cards(tree)[0], 'Los Angeles').props['aria-pressed'], true);
  assert.match(nodes(tree).find(n => n.props?.role === 'status').props.children, /could not be saved/);
  await click(star(cards(tree)[0], 'Los Angeles')); tree = await settle(h);
  assert.equal(star(cards(tree)[0], 'Los Angeles').props['aria-pressed'], true);
  f.setFail(false); await click(star(cards(tree)[0], 'Golden State')); tree = await settle(h);
  assert.ok(!nodes(tree).some(n => n.props?.role === 'status')); h.unmount();
});
test('favorite games reuse NBA status/start-time order and remain once each in the full schedule', async () => {
  reset(); fixture(['9']); const oldFetch = global.fetch;
  global.fetch = (url, options) => url.endsWith('/favorites') ? oldFetch(url, options) : Promise.resolve(Response.json({ games: [
    { ...game, espnEventId: '1', status: 'post', startAt: '2026-05-25T18:00Z' },
    { ...game, espnEventId: '2', status: 'pre', startAt: '2026-05-25T20:00Z' },
    { ...game, espnEventId: '3', status: 'in', startAt: '2026-05-25T23:00Z' },
    { ...game, espnEventId: '4', status: 'in', startAt: '2026-05-25T21:00Z' },
  ] }));
  const h = host(Live), tree = await settle(h); sections(tree, 4, 4);
  for (const name of ['Favorite NBA games', 'NBA schedule']) assert.deepEqual(cards(nodes(tree).find(n => n.props?.['aria-label'] === name)).map(n => n.props.game.espnEventId), ['4', '3', '2', '1']);
  h.unmount();
});
test('load failures leave Scores functional; late favorite loads cannot leak between viewers', async () => {
  reset(); const h = host(Live); let finish;
  global.fetch = url => url.endsWith('/favorites') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(Response.json({ games: [game] }));
  let tree = await settle(h); assert.equal(star(cards(tree)[0], 'Golden State').props.disabled, true);
  const stale = finish;
  tree = await settle(h, { ...props, viewerId: 'other' });
  stale(Response.json({ teamIds: ['9'] })); await tick();
  tree = h.render({ ...props, viewerId: 'other' }); assert.equal(star(cards(tree)[0], 'Golden State').props['aria-pressed'], false);
  finish(Response.json({}, { status: 500 })); tree = await settle(h, { ...props, viewerId: 'other' });
  assert.match(nodes(tree).find(n => n.props?.role === 'status').props.children, /Scores still work/);
  cards(tree)[0].props.onClick(); assert.match(context.search, /gameId=123/); h.unmount();
});
for (const sport of ['nfl', 'ncaa']) test(`${sport}: existing overview favorites toggle independently, retain schedule and persist on remount`, async () => {
  reset();
  const calendar = sport === 'nfl' ? 'sport=nfl&season=2025&seasonType=2&week=2' : 'season=2026&week=5';
  installViewingBrowser(sport === 'nfl' ? '/live-scores' : '/ncaa-pickem/scores', calendar);
  const saved = new Set(), writes = [];
  const footballGame = { ...game, kickoffAt: game.startAt, odds: null, awayTeam: { ...game.awayTeam, rank: 1 }, homeTeam: { ...game.homeTeam, rank: null } };
  global.fetch = async (url, options = {}) => {
    if (!url.endsWith('/favorites')) return Response.json({ season: sport === 'nfl' ? 2025 : 2026, seasonType: 2, week: sport === 'nfl' ? 2 : 5, games: [footballGame] });
    if (!options.method) return Response.json({ teamIds: [...saved] });
    writes.push(url); const id = JSON.parse(options.body).teamId;
    if (options.method === 'POST') saved.add(id); else saved.delete(id);
    return Response.json({ success: true });
  };
  const h = host(sport === 'nfl' ? Nfl : Ncaa().props.children.type);
  let tree = await settle(h); const footballCards = tree => nodes(tree).filter(n => ['LiveScoreCard', 'NcaaScoreCard'].includes(n.type?.name));
  tree = await settle(h); let card = footballCards(tree)[0]; assert.ok(card);
  await card.props.onToggleFavorite('9'); tree = await settle(h);
  assert.equal(footballCards(tree).length, 2); assert.equal(footballCards(tree)[0].props.favoriteTeamIds.has('9'), true);
  h.remount(props); tree = await settle(h);
  tree = await settle(h); assert.equal(footballCards(tree).length, 2);
  await footballCards(tree)[0].props.onToggleFavorite('9'); tree = await settle(h); assert.equal(footballCards(tree).length, 1);
  assert.ok(writes.every(url => url === (sport === 'nfl' ? '/api/live-scores/nfl/favorites' : '/api/ncaa-pickem/favorites'))); h.unmount();
});
test('pending updates block a second toggle of that team while allowing the other team', async () => {
  reset(); fixture(); const get = global.fetch, mutations = [];
  global.fetch = (url, options) => options?.method ? new Promise(resolve => mutations.push({ options, resolve })) : get(url, options);
  const h = host(Live); let tree = await settle(h);
  const card = cards(tree)[0];
  const saving = card.props.onToggleFavorite('9');
  await card.props.onToggleFavorite('9');
  tree = h.render(props);
  assert.equal(star(cards(tree)[0], 'Golden State').props.disabled, true);
  assert.equal(star(cards(tree)[0], 'Los Angeles').props.disabled, false);
  const otherSaving = cards(tree)[0].props.onToggleFavorite('13');
  assert.equal(mutations.length, 2);
  mutations.forEach(m => m.resolve(Response.json({ success: true })));
  await Promise.all([saving, otherSaving]); tree = await settle(h); sections(tree, 1);
  assert.equal(star(cards(tree)[0], 'Golden State').props.disabled, false);
  assert.equal(star(cards(tree)[0], 'Los Angeles').props.disabled, false); h.unmount();
});
test('stale save failures cannot roll back a newly loaded viewer preference', async () => {
  reset(); fixture(); const get = global.fetch; let fail;
  global.fetch = (url, options) => options?.method ? new Promise(resolve => { fail = resolve; }) : get(url, options);
  const h = host(Live); let tree = await settle(h);
  const saving = cards(tree)[0].props.onToggleFavorite('9');
  tree = await settle(h, { ...props, viewerId: 'other' });
  assert.equal(star(cards(tree)[0], 'Golden State').props['aria-pressed'], false);
  fail(Response.json({}, { status: 500 })); await saving;
  tree = await settle(h, { ...props, viewerId: 'other' });
  assert.equal(star(cards(tree)[0], 'Golden State').props['aria-pressed'], false);
  assert.ok(!nodes(tree).some(n => n.props?.role === 'status')); h.unmount();
});
