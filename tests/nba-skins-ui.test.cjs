/* Synthetic page/hook tests. Browser validation is reported separately. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { renderToStaticMarkup } = require('react-dom/server');
const { host, nodes, context, React } = require('./helpers/scores-harness.cjs');
const { installViewingBrowser } = require('./helpers/viewing-browser.cjs');

const previousLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request.includes('components/AppNav')) return () => null;
  if (request === 'next/link') return (props) => React.createElement('a', props);
  return previousLoad.call(this, request, parent, ...rest);
};
const Home = require('../app/nba-skins/page.tsx').default;
const Standings = require('../app/nba-skins/standings/page.tsx').default;
const Draft = require('../app/nba-skins/draft/page.tsx').default;
const { buildNbaSkinsSnakeSlots } = require('../lib/nbaSkins/policy.ts');

const codes = ['BOS', 'ATL', 'NYK', 'CLE', 'LAL', 'DEN'];
const response = (data, ok = true) => ({ ok, json: async () => structuredClone(data) });
const settle = () => new Promise((resolve) => setImmediate(resolve));
const html = (tree) => renderToStaticMarkup(tree);
const toggles = (tree) => nodes(tree).filter((node) => node.type === 'button' && 'aria-expanded' in node.props);
const selects = (tree) => nodes(tree).filter((node) => node.type === 'select');
const metric = (tree, label) => {
  const row = nodes(tree).find((node) => node.type === 'div' && Array.isArray(node.props.children) && node.props.children.some((child) => child?.type === 'dt' && child.props.children === label));
  assert.ok(row, `Metric ${label} exists`);
  return nodes(row).find((node) => node.type === 'dd').props.children;
};

function standing(teamId, overrides = {}) {
  return {
    ownerName: `Participant ${teamId}`, leagueTeamId: teamId, avatarUrl: null,
    pickCount: 6, finalTotal: 60, hasCompleteFinalPoints: true, rank: 1,
    picks: codes.map((code, index) => ({
      id: teamId * 10 + index, nbaTeamAbbreviation: code, nbaTeamName: `${code} Full NBA Team Name`,
      pickType: index % 2 ? 'losses' : 'wins', draftRound: index + 1, finalPoints: 10,
      record: { wins: 10, losses: 10, gamesPlayed: 20, projectedWins: 41, projectedLosses: 41, projectionSource: 'ESPN BPI' },
    })), ...overrides,
  };
}
function standingsData(overrides = {}) {
  return {
    rules: { participantCount: 2, nbaTeamsPerParticipant: 6, totalPicks: 12 },
    availableSeasons: [{ season: 2026, status: 'locked' }, { season: 2025, status: 'final' }],
    selectedSeason: { id: 501, season: 2026, status: 'locked', participantCount: 2, nbaTeamsPerParticipant: 6, totalPicks: 12 },
    standings: [standing(101), standing(102)], ...overrides,
  };
}
async function mount(Component, data, fetcher) {
  context.group = 'skins-group-a';
  installViewingBrowser(Component === Home ? '/nba-skins' : Component === Draft ? '/nba-skins/draft' : '/nba-skins/standings');
  global.fetch = fetcher ?? (async () => response(data));
  const h = host(Component);
  for (let i = 0; i < 5; i++) { h.render({}, true); await settle(); }
  return { h, tree: h.render({}, true) };
}

test('Standings uses one collapsed row per returned participant and preserves tied ranks, zero and missing totals', async () => {
  const data = standingsData({ standings: [standing(101), standing(102), standing(103, { rank: null, finalTotal: null }), standing(104, { rank: 3, finalTotal: 0 })] });
  const { tree } = await mount(Standings, data);
  const rows = toggles(tree);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.props['aria-expanded']), [false, false, false, false]);
  assert.deepEqual(rows.map((row) => nodes(row).find((node) => node.props?.className === 'scores-standing-rank').props.children), [1, 1, '—', 3]);
  assert.deepEqual(rows.map((row) => nodes(row).find((node) => node.props?.['aria-label']?.endsWith('points')).props.children), [60, 60, '—', 0]);
  assert.equal(nodes(tree).filter((node) => node.type === 'article').length, 4);
  assert.doesNotMatch(html(tree), /Full NBA Team Name|\d+\/\d+ picks|\d+ (?:of \d+ )?teams|rounded-3xl/);
});

test('Standings expands independently by Group team ID even when participant names match', async () => {
  const data = standingsData({ standings: [standing(101, { ownerName: 'Same name' }), standing(102, { ownerName: 'Same name' })] });
  const { h } = await mount(Standings, data);
  let tree = h.render({});
  toggles(tree)[0].props.onClick(); tree = h.render({});
  assert.deepEqual(toggles(tree).map((row) => row.props['aria-expanded']), [true, false]);
  toggles(tree)[1].props.onClick(); tree = h.render({});
  assert.deepEqual(toggles(tree).map((row) => row.props['aria-expanded']), [true, true]);
  toggles(tree)[0].props.onClick(); tree = h.render({});
  assert.deepEqual(toggles(tree).map((row) => row.props['aria-expanded']), [false, true]);
  assert.equal(toggles(tree)[1].props['aria-controls'], 'skins-picks-102');
  assert.ok(nodes(tree).find((node) => node.props?.id === 'skins-picks-102' && node.props.hidden === false));
});

test('Standings expansion resets on season and Group changes, including returning to an earlier context', async () => {
  const data = standingsData();
  const { h } = await mount(Standings, data, async (url) => response(url.includes('season=2025')
    ? { ...data, selectedSeason: { ...data.selectedSeason, season: 2025, id: 502 } } : data));
  let tree = h.render({});
  toggles(tree)[0].props.onClick(); tree = h.render({});
  selects(tree)[0].props.onChange({ target: { value: '2025' } });
  h.render({}, true); await settle(); tree = h.render({}, true);
  assert.deepEqual(toggles(tree).map((row) => row.props['aria-expanded']), [false, false]);
  selects(tree)[0].props.onChange({ target: { value: '2026' } });
  h.render({}, true); await settle(); tree = h.render({}, true);
  assert.deepEqual(toggles(tree).map((row) => row.props['aria-expanded']), [false, false]);
  toggles(tree)[0].props.onClick(); h.render({});
  context.group = 'skins-group-b'; tree = h.render({});
  assert.deepEqual(toggles(tree).map((row) => row.props['aria-expanded']), [false, false]);
  context.group = 'skins-group-a'; tree = h.render({});
  assert.deepEqual(toggles(tree).map((row) => row.props['aria-expanded']), [false, false]);
});

test('expanded Standings preserves names, rounds, selection, record and points without Home-only metrics', async () => {
  const { h } = await mount(Standings, standingsData());
  toggles(h.render({}))[0].props.onClick();
  const expanded = html(h.render({}));
  for (const value of ['NBA Team', 'BOS Full NBA Team Name', 'R1', 'Wins', 'Losses', '10-10', '10 points']) assert.ok(expanded.includes(value), value);
  for (const value of ['Accuracy', 'Pace', 'Projected', 'Possible', 'Games Left', 'Result']) assert.ok(!expanded.includes(value), value);
  const old = standingsData(); old.selectedSeason.season = 2024; old.availableSeasons.push({ season: 2024, status: "final" });
  const mounted = await mount(Standings, old);
  toggles(mounted.h.render({}))[0].props.onClick();
  assert.doesNotMatch(html(mounted.h.render({})), />R[1-6]</);
});

test('Standings keeps incomplete, empty and missing-record states', async () => {
  const data = standingsData({ standings: [standing(101, { pickCount: 0, picks: [], finalTotal: null, rank: null, hasCompleteFinalPoints: false })] });
  data.selectedSeason.status = 'open';
  const { h, tree } = await mount(Standings, data);
  assert.match(html(tree), /This season is open/);
  toggles(tree)[0].props.onClick();
  assert.match(html(h.render({})), /No teams have been drafted/);
  const missing = standingsData(); missing.standings[0].picks[0].record = null; missing.standings[0].picks[0].finalPoints = null;
  const loaded = await mount(Standings, missing);
  toggles(loaded.tree)[0].props.onClick();
  assert.match(html(loaded.h.render({})), /Unavailable points/);
  assert.match(html((await mount(Standings, standingsData({ standings: [] }))).tree), /No participants found/);
});

test('Home defaults to compact identity/points with separate profile links and metric toggles', async () => {
  const { h, tree } = await mount(Home, standingsData());
  assert.deepEqual(toggles(tree).map((row) => row.props['aria-expanded']), [false, false]);
  const profiles = nodes(tree).filter((node) => node.props?.href?.startsWith('/nba-skins/profile'));
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].props.href, '/nba-skins/profile?teamId=101');
  assert.equal(profiles[0].props.onClick, undefined);
  assert.equal(toggles(tree)[0].props.href, undefined);
  assert.equal(nodes(tree).filter((node) => node.type === 'dl').length, 0);
  assert.doesNotMatch(html(tree), /\d+\/\d+ picks|\d+ (?:of \d+ )?teams|min-w-\[900px\]/);
  toggles(tree)[0].props.onClick();
  const expanded = h.render({});
  for (const label of ['Accuracy', 'Pace', 'Projected', 'Possible', 'Games Left']) assert.notEqual(metric(expanded, label), undefined);
  assert.match(html(expanded), /ESPN BPI/);
  assert.deepEqual(toggles(expanded).map((row) => row.props['aria-expanded']), [true, false]);
  toggles(expanded)[0].props.onClick();
  assert.equal(nodes(h.render({})).filter((node) => node.type === 'dl').length, 0);
});

test('Home six-pick metrics use the frozen season format rather than current league settings', async () => {
  const data = standingsData(); data.rules.nbaTeamsPerParticipant = 5;
  const { h, tree } = await mount(Home, data);
  toggles(tree)[0].props.onClick();
  const expanded = h.render({});
  assert.equal(metric(expanded, 'Accuracy'), '50.0%');
  assert.equal(metric(expanded, 'Pace'), '246.0');
  assert.equal(metric(expanded, 'Projected'), '246.0');
  assert.equal(metric(expanded, 'Games Left'), 372);
  assert.equal(metric(expanded, 'Possible'), 432);
  assert.match(html(expanded), /492 team-games/);
});

test('Home completed six-pick records and historical saved-point fallback retain metric definitions', async () => {
  for (const historical of [false, true]) {
    const data = standingsData({ standings: [standing(101)] });
    for (const pick of data.standings[0].picks) {
      pick.finalPoints = 41;
      pick.record = historical ? null : { ...pick.record, wins: 41, losses: 41, gamesPlayed: 82 };
    }
    data.standings[0].finalTotal = 246;
    const { h, tree } = await mount(Home, data);
    toggles(tree)[0].props.onClick(); const expanded = h.render({});
    assert.equal(metric(expanded, 'Games Left'), 0);
    assert.equal(metric(expanded, 'Projected'), '246.0');
    assert.equal(metric(expanded, 'Possible'), 246);
    assert.equal(metric(expanded, 'Pace'), '246.0');
  }
});

test('Home keeps BPI projections distinct from pace and selects Wins/Losses correctly', async () => {
  const data = standingsData({ standings: [standing(101)] });
  data.standings[0].picks.forEach((pick, index) => {
    pick.record = index % 2
      ? { ...pick.record, wins: 5, losses: 15, projectedWins: 52, projectedLosses: 30 }
      : { ...pick.record, wins: 12, losses: 8, projectedWins: 48, projectedLosses: 34 };
  });
  const { h, tree } = await mount(Home, data);
  toggles(tree)[0].props.onClick(); const expanded = h.render({});
  assert.equal(metric(expanded, 'Accuracy'), '67.5%');
  assert.equal(metric(expanded, 'Pace'), '332.1');
  assert.equal(metric(expanded, 'Projected'), '234.0');
  assert.equal(metric(expanded, 'Possible'), 453);
});

test('Home retains the default seven-pick metric behavior', async () => {
  const data = standingsData({ standings: [standing(101)] });
  data.selectedSeason.nbaTeamsPerParticipant = 7;
  data.standings[0].pickCount = 7;
  data.standings[0].picks.push({ ...data.standings[0].picks[0], id: 1099, nbaTeamAbbreviation: 'MEM', draftRound: 7 });
  const { h, tree } = await mount(Home, data);
  toggles(tree)[0].props.onClick(); const expanded = h.render({});
  assert.equal(metric(expanded, 'Pace'), '287.0');
  assert.equal(metric(expanded, 'Projected'), '287.0');
  assert.equal(metric(expanded, 'Games Left'), 434);
  assert.equal(metric(expanded, 'Possible'), 504);
});

test('Home preserves missing projections and partial-draft handling', async () => {
  const data = standingsData({ standings: [standing(101)] });
  data.standings[0].picks[0].record.projectedWins = null;
  const { h, tree } = await mount(Home, data);
  toggles(tree)[0].props.onClick(); assert.equal(metric(h.render({}), 'Projected'), '—');
  const partial = standingsData({ standings: [standing(101, { pickCount: 5, hasCompleteFinalPoints: false })] });
  partial.standings[0].picks.pop();
  const loaded = await mount(Home, partial); toggles(loaded.tree)[0].props.onClick();
  assert.equal(metric(loaded.h.render({}), 'Projected'), '—');
  assert.equal(metric(loaded.h.render({}), 'Games Left'), 0);
});

test('Home preserves points/accuracy sorting, leader treatment and previous-season explanation', async () => {
  const data = standingsData({ standings: [standing(101), standing(102)] });
  data.standings[0].picks.forEach((pick) => { pick.record.gamesPlayed = 40; });
  data.selectedSeason.season = 2025;
  const { h, tree } = await mount(Home, data);
  const articles = nodes(tree).filter((node) => node.type === 'article');
  assert.equal(articles[0].key, '102');
  assert.match(articles[0].props.className, /scores-standing--leader/);
  assert.match(html(tree), /Showing 2025-26 until the 2026-27 draft is saved/);
  toggles(tree)[0].props.onClick(); h.render({});
  context.group = 'skins-group-b'; h.render({});
  context.group = 'skins-group-a';
  assert.deepEqual(toggles(h.render({})).map((row) => row.props['aria-expanded']), [false, false]);
});

test('Home and Standings preserve loading, errors and no-season states', async () => {
  for (const Component of [Home, Standings]) {
    const fresh = host(Component);
    assert.match(html(fresh.render({})), /Loading NBA Skins/);
    const empty = await mount(Component, standingsData({ selectedSeason: null, availableSeasons: [], standings: [] }));
    assert.match(html(empty.tree), /No NBA Skins season/);
    const failed = await mount(Component, {}, async () => response({ error: 'Group unavailable' }, false));
    assert.match(html(failed.tree), /Group unavailable/);
    assert.ok(nodes(failed.tree).some((node) => node.props?.role === 'alert'));
  }
  assert.match(html((await mount(Home, standingsData({ standings: [] }))).tree), /No draft saved yet/);
});

function draftData(filled = false) {
  return {
    availableSeasons: [{ season: 2026, label: '2026-27', status: 'open' }],
    season: { id: 601, season: 2026, label: '2026-27', status: 'open', editable: true, participantCount: 2, nbaTeamsPerParticipant: 3, totalPicks: 6 },
    draftOrder: [{ teamId: 101, teamName: 'Alpha', draftPosition: 1 }, { teamId: 102, teamName: 'Beta', draftPosition: 2 }],
    hasValidDraftOrder: true, nbaTeams: codes.map((code) => ({ abbreviation: code, displayName: `${code} Full Name` })),
    picks: buildNbaSkinsSnakeSlots([101, 102], 3).map((slot, index) => ({ ...slot, teamName: slot.teamId === 101 ? 'Alpha' : 'Beta', nbaTeamAbbreviation: filled ? codes[index] : '', pickType: 'wins' })),
  };
}
const saveButton = (tree) => nodes(tree).find((node) => node.type === 'button' && typeof node.props.children === 'string' && /Save Draft|Saving…/.test(node.props.children));
const nbaSelects = (tree) => selects(tree).filter((node) => node.props['aria-label'].startsWith('NBA team'));
const typeSelects = (tree) => selects(tree).filter((node) => node.props['aria-label'].startsWith('Wins or Losses'));

test('Draft preserves configured slots, rounds, duplicate prevention and completion gating', async () => {
  const { h, tree } = await mount(Draft, draftData());
  assert.match(html(tree), /0\/6 filled/);
  assert.equal(saveButton(tree).props.disabled, true);
  assert.equal(nbaSelects(tree).length, 6);
  assert.deepEqual(nodes(tree).filter((node) => node.type === 'h2' && Array.isArray(node.props.children)).map((node) => node.props.children[1]), [1, 2, 3]);
  nbaSelects(tree)[0].props.onChange({ target: { value: 'BOS' } });
  let updated = h.render({});
  const option = (select) => nodes(select).find((node) => node.type === 'option' && node.props.value === 'BOS');
  assert.equal(option(nbaSelects(updated)[0]).props.disabled, false);
  assert.equal(option(nbaSelects(updated)[1]).props.disabled, true);
  assert.match(html(updated), /1\/6 filled/);
  for (let index = 1; index < codes.length; index++) {
    nbaSelects(updated)[index].props.onChange({ target: { value: codes[index] } }); updated = h.render({});
  }
  assert.equal(saveButton(updated).props.disabled, false);
  assert.match(html(updated), /6\/6 filled/);
  typeSelects(updated)[0].props.onChange({ target: { value: 'losses' } }); updated = h.render({});
  assert.equal(typeSelects(updated)[0].props.value, 'losses');
  assert.equal(nbaSelects(updated)[0].props.value, 'BOS');
});

test('Draft saves the unchanged payload shape and preserves assigned snake order', async () => {
  const data = draftData(true), requests = [];
  const { h, tree } = await mount(Draft, data, async (url, options) => {
    requests.push({ url, options });
    return options?.method === 'PUT' ? response({ message: 'Draft saved successfully.' }) : response(data);
  });
  await saveButton(tree).props.onClick();
  const request = requests.find((entry) => entry.options?.method === 'PUT');
  assert.equal(request.url, '/api/nba-skins/draft');
  assert.deepEqual(request.options.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(request.options.body), { season: 2026, picks: data.picks.map((pick) => ({ pickNumber: pick.pickNumber, round: pick.round, teamId: pick.teamId, nbaTeamAbbreviation: pick.nbaTeamAbbreviation, pickType: pick.pickType })) });
  assert.deepEqual(JSON.parse(request.options.body).picks.map((pick) => pick.teamId), [101, 102, 102, 101, 101, 102]);
  assert.match(html(h.render({})), /Draft saved successfully/);
  assert.equal(requests.at(-1).options.method, undefined, 'Reloads after save');
});

test('Draft retains read-only permissions, locked/final messaging and unconfigured-order state', async () => {
  for (const status of ['open', 'locked', 'final']) {
    const data = draftData(true); data.season.editable = false; data.season.status = status;
    const { tree } = await mount(Draft, data);
    assert.ok([...nbaSelects(tree), ...typeSelects(tree)].every((select) => select.props.disabled));
    assert.equal(selects(tree).find(select => select.props['aria-label'] === 'Season').props.disabled, false);
    assert.equal(saveButton(tree), undefined);
    assert.match(html(tree), status === 'open' ? /Only an admin can edit/ : /season is reopened from Admin/);
    assert.match(html(tree), /6\/6 filled/);
  }
  const data = draftData(); data.hasValidDraftOrder = false;
  const { tree } = await mount(Draft, data);
  assert.match(html(tree), /Draft order not configured/);
  assert.equal(nbaSelects(tree).length, 0);
  assert.ok(selects(tree).some(select => select.props['aria-label'] === 'Season'));
});

test('historical Draft displays saved selections without an invented participant order or pick chronology', async () => {
  for (const importedOrder of [false, true]) {
    const data = draftData(true);
    data.availableSeasons = [{ season: 2025, label: '2025-26', status: 'final' }];
    data.season = { ...data.season, season: 2025, label: '2025-26', status: 'final', editable: false };
    data.hasValidDraftOrder = importedOrder;
    if (!importedOrder) data.draftOrder = [];
    data.picks = data.picks.map((pick, index) => ({ ...pick, pickId: index + 500, pickNumber: null, round: null, roundPick: null }));
    const { tree } = await mount(Draft, data);
    const markup = html(tree);
    assert.doesNotMatch(markup, /<h2[^>]*>Draft Order|<ol|Round |#[0-9]|Draft order not configured|season is reopened/);
    assert.match(markup, /Draft order was not recorded/);
    assert.match(markup, /6\/6 filled/);
    assert.deepEqual(nbaSelects(tree).map(select => select.props.value), codes);
    assert.ok([...nbaSelects(tree), ...typeSelects(tree)].every(select => select.props.disabled));
    assert.equal(saveButton(tree), undefined);
  }
});

test('Draft preserves selection state and shows errors when saving fails', async () => {
  const data = draftData(true);
  const { h, tree } = await mount(Draft, data, async (url, options) => options?.method === 'PUT'
    ? response({ error: 'Season locked while saving' }, false) : response(data));
  await saveButton(tree).props.onClick();
  const updated = h.render({});
  assert.match(html(updated), /Season locked while saving/);
  assert.equal(saveButton(updated).props.disabled, false);
  assert.deepEqual(nbaSelects(updated).map((select) => select.props.value), codes);
});

test.after(() => { Module._load = previousLoad; });
