/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
require('./helpers/scores-harness.cjs');
const routeData = require('./helpers/ncaa-game-center-route-data.cjs');
const fixture = require('./fixtures/ncaa-week5-401858473.json');
const { host, nodes } = require('./helpers/scores-harness.cjs');
const { normalizeNcaaEspnEvent } = require('../lib/providers/ncaa.ts');
const Modal = require('../components/ncaa/NcaaGameCenterModal.tsx').default;
const Center = require('../components/live-scores/FootballGameCenter.tsx').default;
const Pbp = require('../components/live-scores/FootballPlayByPlay.tsx').default;
const Logo = require('../components/live-scores/PlayTeamLogo.tsx').default;
const { footballDisplayTeamId } = require('../lib/live-scores/playTeamLogo.ts');

test('real NCAA Week 5 scores GET → modal → Game Center → PBP retains scoreboard logo URLs', async () => {
  const { scores, detail, calls } = await routeData();
  assert.equal(scores.season, 2026); assert.equal(scores.week, 5);
  const game = scores.games.find(game => game.espnEventId === '401858473');
  const rawTeams = fixture.scoreboard.events[0].competitions[0].competitors;
  // Preserve the actual scoreboard shape. Summary-header normalization would
  // hide this regression because the two provider endpoints use different fields.
  assert.ok(rawTeams.every(c => typeof c.team.logo === 'string' && c.team.logos === undefined));
  for (const team of [game.awayTeam, game.homeTeam]) {
    assert.equal(team.logo, rawTeams.find(c => c.team.id === team.id).team.logo);
  }
  assert.deepEqual(detail.drives, fixture.summary.drives);
  assert.deepEqual(calls.map(url => new URL(url).pathname.split('/').at(-1)).sort(), ['rankings', 'scoreboard', 'summary']);
  const modal = Modal({ game, onClose() {} });
  const content = modal.type(modal.props);
  const centerElement = nodes(content).find(node => node.type === Center);
  const centerHost = host(Center);
  const centerTree = centerHost.render({ ...centerElement.props, request: { data: detail, loading: false, refreshing: false, error: '', refresh() {} }, tab: 'pbp' });
  const pbp = nodes(centerTree).find(node => node.type === Pbp);
  assert.deepEqual(pbp.props.teams, [game.awayTeam, game.homeTeam]);
  const pbpHost = host(Pbp);
  const tree = pbpHost.render({ ...pbp.props, period: 4 });
  const rows = nodes(tree).filter(node => node.type === Logo && node.props.team);
  assert.ok(rows.some(row => row.props.team.id === '194' && row.props.team.logo === game.awayTeam.logo));
  assert.ok(rows.some(row => row.props.team.id === '2294' && row.props.team.logo === game.homeTeam.logo));
  assert.ok(rows.every(row => nodes(Logo(row.props)).some(node => node.type === 'img' && node.props.src)));
  const plays = detail.drives.previous.flatMap(drive => drive.plays);
  for (const play of plays.filter(play => ['Timeout', 'Kickoff', 'Penalty', 'End Period', 'End of Game'].includes(play.type.text))) {
    assert.equal(footballDisplayTeamId(play, pbp.props.teams), null);
  }
  pbpHost.unmount(); centerHost.unmount();
});

test('NCAA logo normalization retains existing logos[] precedence and handles absent/malformed logos', () => {
  const input = fixture.scoreboard.events[0];
  const withTeam = team => ({ ...input, competitions: [{ ...input.competitions[0], competitors: input.competitions[0].competitors.map((c, index) => index === 0 ? { ...c, team: { ...c.team, ...team } } : c) }] });
  const logo = event => normalizeNcaaEspnEvent(event).homeTeam.logo;
  assert.equal(logo(withTeam({ logo: 'https://example.test/direct.png', logos: [{ href: 'https://example.test/array.png' }] })), 'https://example.test/array.png');
  assert.equal(logo(withTeam({ logo: null, logos: [] })), null);
  assert.equal(logo(withTeam({ logo: 123, logos: [] })), null);
});
