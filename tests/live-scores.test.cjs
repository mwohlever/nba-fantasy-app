/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
};
const { normalizeBroadcast, normalizeGameStory } = require('../lib/live-scores/metadata.ts');
const { possessionTeamId } = require('../lib/live-scores/possession.ts');
const { footballPlaysByQuarter } = require('../lib/live-scores/football-plays.ts');
const { normalizeNflGame, fetchNflLiveScores } = require('../lib/providers/nflLiveScores.ts');
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');
const TeamAvatar = require('../components/ui/TeamAvatar.tsx').default;
const LiveScoreCard = require('../components/live-scores/LiveScoreCard.tsx').default;

const feed = (name, market = 'National', type = 'TV', region = 'us') => ({
  type: { shortName: type }, media: { shortName: name }, market: { type: market }, region, lang: 'en',
});

test('broadcast chooses one relevant national feed and omits radio/foreign/missing feeds', () => {
  assert.deepEqual(normalizeBroadcast({ geoBroadcasts: [feed('Local', 'Local'), feed('FOX'), feed('ESPN Deportes', 'National', 'TV', 'mx')] }), { network: 'FOX' });
  assert.deepEqual(normalizeBroadcast({ broadcasts: [feed('Prime Video', 'National', 'Streaming')] }), { network: 'Prime Video' });
  assert.deepEqual(normalizeBroadcast({ broadcasts: [{ market: 'national', names: ['ABC', 'ESPN2'] }] }), { network: 'ABC' });
  assert.equal(normalizeBroadcast({ broadcasts: [feed('Radio', 'National', 'Radio')] }), null);
  assert.equal(normalizeBroadcast({ geoBroadcasts: [feed('Foreign', 'National', 'TV', 'mx')] }), null);
  assert.equal(normalizeBroadcast({}), null);
});

test('recap requires a final game and matching event; keeps safe public links only', () => {
  const article = { type: 'Recap', gameId: '123', headline: 'Provider headline', description: 'Provider description', links: { web: { href: 'http://www.espn.com/nfl/recap?gameId=123' } } };
  assert.equal(normalizeGameStory(article, '123', 'post').url, 'https://www.espn.com/nfl/recap?gameId=123');
  for (const state of ['in', 'pre']) assert.equal(normalizeGameStory(article, '123', state), null);
  assert.equal(normalizeGameStory(article, '999', 'post'), null);
  assert.equal(normalizeGameStory({ ...article, type: 'Story' }, '123', 'post'), null);
  assert.equal(normalizeGameStory(null, '123', 'post'), null);
  assert.equal(normalizeGameStory({ ...article, links: { web: { href: 'javascript:alert(1)' } } }, '123', 'post').url, null);
  assert.equal(normalizeGameStory({ ...article, links: { web: { href: 'https://espn.com.evil.test/' } } }, '123', 'post').url, null);
});

test('possession requires exactly one explicit true, live and not completed', () => {
  const competition = { status: { type: { state: 'in' } }, competitors: [{ id: '1', possession: true }, { id: '2', possession: false }] };
  assert.equal(possessionTeamId(competition), '1');
  for (const state of ['pre', 'post']) assert.equal(possessionTeamId({ ...competition, status: { type: { state } } }), null);
  assert.equal(possessionTeamId({ ...competition, competitors: [{ id: '1', possession: true }, { id: '2', possession: true }] }), null);
  assert.equal(possessionTeamId({ ...competition, competitors: [{ id: '1', possession: 'true' }] }), null);
  assert.equal(possessionTeamId({ ...competition, status: { type: { state: 'in', completed: true } } }), null);
});

test('overlapping drives dedupe IDs and fallback keys without inventing clocks or sorting equal clocks', () => {
  const a = { id: 'a', period: { number: 1 }, clock: { displayValue: '10:00' }, text: 'First' };
  const b = { id: 'b', period: { number: 1 }, clock: { displayValue: '10:00' }, text: 'Second' };
  const c = { period: { number: 3 }, text: 'No clock', start: { shortDownDistanceText: '2nd & 3' } };
  const quarters = footballPlaysByQuarter([{ plays: [a, b, c] }, { plays: [b, { ...c }] }]);
  assert.deepEqual(quarters.map(q => q.period), [3, 1]);
  assert.deepEqual(quarters[1].plays.map(p => p.id), ['b', 'a']);
  assert.equal(quarters[0].plays.length, 1);
  assert.equal(quarters[0].plays[0].clock, undefined);
});

const event = { id: '123', date: '2025-09-07T20:00Z', competitions: [{
  status: { type: { state: 'in' } }, geoBroadcasts: [feed('FOX')],
  competitors: [{ homeAway: 'away', team: { id: '1', displayName: 'Away', abbreviation: 'AWY' }, score: '7', possession: true, records: [{ type: 'total', summary: '1-0' }] },
    { homeAway: 'home', team: { id: '2', displayName: 'Home', abbreviation: 'HME' }, score: '0' }],
  odds: [{ spread: -3.5, overUnder: 44.5, homeTeamOdds: { favorite: true } }],
}] };

test('NFL adapter preserves league-wide card metadata with no invented rankings', () => {
  const game = normalizeNflGame(event);
  assert.equal(game.broadcast.network, 'FOX');
  assert.equal(game.possessionTeamId, '1');
  assert.equal(game.awayTeam.record, '1-0');
  assert.equal(game.awayTeam.rank, null);
  assert.equal(game.odds.favoriteTeamId, '2');
  assert.equal(game.odds.spread, -3.5);
  const markup = renderToStaticMarkup(createElement(LiveScoreCard, { game, favoriteTeamIds: new Set(['1']), onToggleFavorite() {} }));
  assert.match(markup, /FOX/);
  assert.match(markup, /HME -3.5/);
  assert.match(markup, /O\/U 44.5/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /aria-label="Possession"/);
  assert.equal(normalizeNflGame({}), null);
});

test('NFL selected calendar context includes preseason and postseason labels', async () => {
  const original = global.fetch;
  const urls = [];
  global.fetch = async url => { urls.push(String(url)); return Response.json({ season: { year: 2025, type: 2 }, week: { number: 1 }, events: [event], leagues: [{ calendar: [
    { value: '1', label: 'Preseason', entries: [{ value: '1', label: 'Hall of Fame Weekend' }] },
    { value: '3', label: 'Postseason', entries: [{ value: '5', label: 'Super Bowl' }] },
    { value: '4', label: 'Offseason' },
  ] }] }); };
  try {
    const data = await fetchNflLiveScores({ season: 2025, seasonType: 3, week: 5 });
    assert.equal(data.seasonType, 3);
    assert.equal(data.week, 5);
    assert.equal(data.calendar[1].entries[0].label, 'Super Bowl');
    assert.equal(data.calendar.length, 2);
    assert.match(urls[0], /seasontype=3/);
    assert.match(urls[0], /week=5/);
  } finally { global.fetch = original; }
});

test('Home chip uses the same account-first photo resolution as Standings', () => {
  for (const name of ['Jon', 'Andy']) {
    const render = (size, avatarUrl) => renderToStaticMarkup(createElement(TeamAvatar, { size, teamName: name, avatarUrl }));
    for (const size of ['chip', 'md']) {
      assert.match(render(size, 'https://images.example/account.jpg'), /src="https:\/\/images.example\/account.jpg"/);
      assert.match(render(size, null), new RegExp(`/team-headshots/${name.toLowerCase()}.jpg`));
    }
  }
  const missing = renderToStaticMarkup(createElement(TeamAvatar, { size: 'chip', teamName: 'No Photo', avatarUrl: null }));
  assert.doesNotMatch(missing, /<img/);
  assert.match(missing, />N<\/div>/);
});

// Exercise the API normalizer with mixed provider histories; all fetches are fixtures.
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === '@/lib/auth') return { getCurrentUser: async () => ({ id: 'viewer' }) };
  return originalLoad.call(this, request, ...args);
};
const { createFootballPlayerDetailHandler } = require('../lib/live-scores/player-detail.ts');
const { createFootballGameDetailHandler } = require('../lib/live-scores/game-detail.ts');
Module._load = originalLoad;
const { NextRequest } = require('next/server');

test('both athlete APIs omit prior-team, prior-season, career and unmatched game rows', async () => {
  const originalFetch = global.fetch;
  const stats = { categories: [{ name: 'passing', labels: ['YDS'], statistics: [
    { teamId: '2', season: { year: 2025 }, stats: ['99'] },
    { teamId: '1', season: { year: 2024 }, stats: ['88'] },
    { teamId: '1', stats: ['7777'] },
    { teamId: '1', season: { year: 2025 }, stats: ['123'] },
  ] }] };
  let providerSeason = '2025';
  const events = {
    a: { id: 'a', team: { id: '1' }, homeTeamId: '1', awayTeamId: '2' },
    b: { id: 'b', team: { id: '2' }, homeTeamId: '1', awayTeamId: '2' },
    c: { id: 'c', team: { id: '1' }, homeTeamId: '1', awayTeamId: '2' },
  };
  global.fetch = async url => Response.json(String(url).includes('/gamelog?') ? {
    filters: [{ name: 'season', value: providerSeason }], events,
    seasonTypes: [{ categories: [{ events: [{ eventId: 'a', stats: ['10'] }, { eventId: 'b', stats: ['20'] }] }] }],
  } : stats);
  try {
    for (const league of ['nfl', 'college-football']) {
      const handler = createFootballPlayerDetailHandler(league, async () => ({}));
      const response = await handler(new NextRequest('http://localhost/player?athleteId=123&teamId=1&season=2025'));
      const data = await response.json();
      assert.deepEqual(data.seasonCategories[0].stats, ['123']);
      assert.deepEqual(data.gameLog.events.map(e => e.eventId), ['a']);
      providerSeason = '2024';
      assert.deepEqual((await (await handler(new NextRequest('http://localhost/player?athleteId=123&teamId=1&season=2025'))).json()).gameLog.events, []);
      providerSeason = '2025';
    }
  } finally { global.fetch = originalFetch; }
});

test('game detail refresh returns current explicit possession and only the event recap', async () => {
  const originalFetch = global.fetch;
  let state = 'in';
  let possessing = '1';
  global.fetch = async () => Response.json({
    header: { season: { year: 2025 }, competitions: [{
      status: { type: { state } }, broadcasts: [feed('CBS')],
      competitors: [{ id: '1', homeAway: 'away', possession: possessing === '1' }, { id: '2', homeAway: 'home', possession: possessing === '2' }],
    }] },
    article: { type: 'Recap', gameId: '123', headline: 'Event recap' },
    news: { articles: [{ headline: 'Unrelated league story' }] },
    scoringPlays: [{ id: 'score' }], boxscore: { teams: [] },
  });
  try {
    for (const league of ['nfl', 'college-football']) {
      const handler = createFootballGameDetailHandler(league, async () => ({}));
      const load = async () => (await handler(new NextRequest('http://localhost/game?eventId=123'))).json();
      state = 'in'; possessing = '1';
      let data = await load();
      assert.equal(data.possessionTeamId, '1');
      assert.equal(data.gameStory, null);
      assert.equal(data.broadcast.network, 'CBS');
      possessing = '2';
      assert.equal((await load()).possessionTeamId, '2');
      state = 'post';
      data = await load();
      assert.equal(data.possessionTeamId, null);
      assert.equal(data.gameStory.headline, 'Event recap');
      assert.equal(data.news, undefined);
    }
  } finally { global.fetch = originalFetch; }
});

const { canRefreshNcaaOdds } = require('../lib/ncaaPickEm/odds.ts');
test('NCAA lines freeze at weekly lock, stored kickoff, provider kickoff or started status', () => {
  const now = Date.parse('2026-09-07T12:00:00Z');
  const future = '2026-09-07T13:00:00Z';
  const past = '2026-09-07T11:00:00Z';
  const week = { status: 'open', lock_at: future };
  const game = { status: 'pre', kickoffAt: future };
  const stored = { status: 'pre', kickoff_at: future };
  assert.equal(canRefreshNcaaOdds(week, game, stored, now), true);
  assert.equal(canRefreshNcaaOdds({ ...week, lock_at: past }, game, stored, now), false);
  assert.equal(canRefreshNcaaOdds({ ...week, status: 'locked' }, game, stored, now), false);
  assert.equal(canRefreshNcaaOdds(week, game, { ...stored, kickoff_at: past }, now), false);
  assert.equal(canRefreshNcaaOdds(week, { ...game, kickoffAt: past }, stored, now), false);
  for (const status of ['in', 'post']) {
    assert.equal(canRefreshNcaaOdds(week, { ...game, status }, stored, now), false);
    assert.equal(canRefreshNcaaOdds(week, game, { ...stored, status }, now), false);
  }
});
