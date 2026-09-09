const assert = require('node:assert/strict');
const test = require('node:test');
const { host, nodes } = require('./helpers/scores-harness.cjs');
const { scoresStatLine } = require('../lib/lineups/scoresStatLine.ts');
const PlayerHeadshot = require('../components/ui/PlayerHeadshot.tsx').default;
const ScoresDashboard = require('../components/lineups/ScoresDashboard.tsx').default;
const LeagueLineupCards = require('../components/lineups/LeagueLineupCards.tsx').default;
const stats = { passing_yards: 366, passing_tds: 3, passing_ints: 1, rushing_yards: 84, rushing_tds: 1,
  receptions: 6, receiving_yards: 71, receiving_tds: 2, points: 9, rebounds: 4, assists: 8, fantasy_points: 22.8 };
for (const [position, expected] of [
  ['QB', '366 PASS · 3 TD · 1 INT · 84 RUSH'],
  ['RB', '84 RUSH · 1 RUSH TD · 6 REC · 71 REC YD · 2 REC TD'],
  ['WR', '6 REC · 71 YD · 2 TD'], ['TE', '6 REC · 71 YD · 2 TD'],
  ['K', 'Kicking breakdown unavailable'], ['D/ST', 'Defense breakdown unavailable'],
]) test(`${position} compact line uses only supported position statistics`, () => {
  assert.equal(scoresStatLine('nfl', position, stats), expected);
  if (position !== 'QB') assert.ok(!scoresStatLine('nfl', position, stats).includes('PASS'));
});
test('NBA prioritizes PTS/REB/AST and missing slate statistics are explicit', () => {
  assert.equal(scoresStatLine('nba', 'G', stats), '9 PTS · 4 REB · 8 AST');
  assert.equal(scoresStatLine('nfl', 'QB', null), 'No stats yet');
});
function scoreboardProps(sport, player) {
  return { teams: [{ id: 1, name: 'One' }], selectedSlate: { id: 1, sport }, currentTeamId: 1,
    rosterSlots: [{ sport, position: player.position_group, slot_count: 2 }],
    getPlayersForTeam: () => [player], getTeamStats: () => ({ total: 22.8, games_completed: 0, games_in_progress: 1, games_remaining: 0 }),
    getPlayerStat: () => stats, getRawPlayerStat: () => stats,
    getLiveProjectedTeamTotal: () => 23, getPregameProjectedTeamTotal: () => 20,
    liveWinPctMap: new Map([[1, 50]]), setProfilePlayer() {} };
}
test('Scores passes loaded NBA/NFL identities; empty slots never render headshots', () => {
  for (const sport of ['nba', 'nfl']) {
    const player = { id: 1, name: 'Example Player', position_group: sport === 'nba' ? 'G' : 'QB',
      nba_player_id: sport === 'nba' ? 123 : null, nfl_player_id: sport === 'nfl' ? 456 : null };
    const props = scoreboardProps(sport, player);
    const h = host(ScoresDashboard(props).type);
    nodes(h.render(props)).find(n => n.props?.className === 'scores-standing-toggle').props.onClick();
    const tree = h.render(props);
    const headshots = nodes(tree).filter(node => node.type === PlayerHeadshot);
    assert.equal(headshots.length, 1);
    assert.equal(headshots[0].props.nbaPlayerId, player.nba_player_id);
    assert.equal(headshots[0].props.nflPlayerId, player.nfl_player_id);
  }
});
test('other-team Draft League Lineups pass the same NFL identity without altering slots', () => {
  const player = { id: 1, name: 'NFL Player', position_group: 'QB', nfl_player_id: 456 };
  const tree = LeagueLineupCards({ teams: [{ id: 1, name: 'Other' }], currentTeamId: 2,
    getPlayersForTeam: () => [player], getPlayerProjectionScore: () => 20, getDraftNeeds: () => '',
    rosterSlots: [{ sport: 'nfl', position: 'QB', slot_count: 2 }], setResearchPlayer() {}, setTargetDraftSlot() {}, isLocked: false });
  const miniSlots = nodes(tree).filter(node => node.type?.name === 'MiniSlot');
  assert.equal(miniSlots.length, 2);
  const headshots = miniSlots.flatMap(slot => nodes(slot.type(slot.props))).filter(node => node.type === PlayerHeadshot);
  assert.equal(headshots.length, 1); assert.equal(headshots[0].props.nflPlayerId, 456);
});
test('NFL images use existing ESPN URL, D/ST uses team logo and errors fall back to initials', () => {
  const h = host(PlayerHeadshot), props = { nflPlayerId: 456, playerName: 'Josh Allen' };
  let tree = h.render(props, true); let image = nodes(tree).find(node => node.type === 'img');
  assert.equal(image.props.src, 'https://a.espncdn.com/i/headshots/nfl/players/full/456.png');
  image.props.onError(); tree = h.render(props);
  assert.equal(nodes(tree).filter(node => node.type === 'img').length, 0);
  assert.ok(nodes(tree).some(node => node.props?.children === 'JA'));
  const dst = host(PlayerHeadshot).render({ nflPlayerId: 100000002, playerName: 'Buffalo' });
  assert.equal(nodes(dst).find(node => node.type === 'img').props.src, 'https://a.espncdn.com/i/teamlogos/nfl/500/2.png');
  assert.equal(nodes(host(PlayerHeadshot).render({ playerName: 'No Image' })).filter(node => node.type === 'img').length, 0);
});
