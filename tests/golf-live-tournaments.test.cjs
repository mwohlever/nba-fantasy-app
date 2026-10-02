/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
require('./helpers/scores-harness.cjs');
const { parseGolfScheduleFromPayload } = require('../lib/providers/golf.ts');
const { golfLiveHref, golfLiveOptions, golfLiveOptionLabel, currentGolfLiveEvent, matchGolfLiveSlate, golfLiveOptionGroups, golfLiveDefaultLabel, golfLiveTournamentPhase } = require('../lib/golf/liveTournament.ts');
const { getGroupSwitchDestination } = require('../lib/groups/navigation.ts');
const calendar = [{ id: '401850915', label: 'Bank of Utah Championship', startDate: '2026-10-01T04:00Z', endDate: '2026-10-04T04:00Z' },
  { id: '401850982', label: 'Hero World Challenge', startDate: '2026-12-03T05:00Z', endDate: '2026-12-06T05:00Z' }];
const event = (id, name, date, status = 'STATUS_FINAL', competitors = []) => ({ id, name, date, endDate: date,
  status: { type: { name: status, state: status === 'STATUS_FINAL' ? 'post' : status === 'STATUS_SCHEDULED' ? 'pre' : 'in', completed: status === 'STATUS_FINAL' } },
  competitions: [{ status: { period: status === 'STATUS_FINAL' ? 4 : 1, type: { name: status, state: status === 'STATUS_FINAL' ? 'post' : status === 'STATUS_SCHEDULED' ? 'pre' : 'in', completed: status === 'STATUS_FINAL' } }, competitors }] });
const golfer = (id, score) => ({ id, order: 1, score, athlete: { displayName: `Fixture Golfer ${id}` }, linescores: [{ period: 4, value: 70, displayValue: '-2', linescores: [{ period: 1, value: 4 }] }] });

function freshClient() { const file = require.resolve('../lib/client/golfLiveTournaments.ts'); delete require.cache[file]; return require(file); }

test('schedule options reuse ESPN calendar, remove malformed/duplicate entries and distinguish seasons', () => {
  const schedule = parseGolfScheduleFromPayload({ leagues: [{ calendar: [...calendar, calendar[0], { id: 'bad', label: 'Bad' }, { id: '3' }] }] });
  assert.equal(schedule.length, 2);
  assert.match(golfLiveOptionLabel(schedule[0]), /Bank of Utah Championship · 2026-10-01/);
  const historical = { espnEventId: '401703531', name: 'TOUR Championship', startDate: '2025-08-21', endDate: '2025-08-24' };
  assert.equal(golfLiveOptions(schedule, historical)[0], historical);
  assert.equal(golfLiveOptions(schedule, schedule[0]).length, 2);
});

test('named default labels use resolved status/dates; grouped seasons sort and exclude the default event', () => {
  const tournament = (espnEventId, name, startDate, endDate = startDate) => ({ espnEventId, name, startDate, endDate });
  const current = tournament('10', 'Bank of Utah Championship', '2026-10-01', '2026-10-04');
  const oldest = tournament('1', 'The Sentry', '2026-01-08', '2026-01-11');
  const recent = tournament('2', 'TOUR Championship', '2026-08-27', '2026-08-30');
  const next = tournament('3', 'Baycurrent Classic', '2026-10-08', '2026-10-11');
  const later = tournament('4', 'Hero World Challenge', '2026-12-03', '2026-12-06');
  const automatic = { tournament: current, tournamentStatus: 'in_progress', latestSlate: null };
  const today = '2026-10-02';
  assert.equal(golfLiveDefaultLabel(automatic, today), 'Current: Bank of Utah Championship');
  assert.equal(golfLiveDefaultLabel({ tournament: recent, latestGolfTournamentIsFinal: true }, today), 'Latest: TOUR Championship');
  assert.equal(golfLiveDefaultLabel({ tournament: recent }, today), 'Latest: TOUR Championship');
  assert.equal(golfLiveDefaultLabel({ tournament: current }, today), 'Current: Bank of Utah Championship');
  assert.equal(golfLiveDefaultLabel({ tournament: next, tournamentStatus: 'scheduled' }, today), 'Current: Baycurrent Classic');
  assert.equal(golfLiveDefaultLabel({ tournament: null }, today), 'No current tournament');
  const schedule = [later, recent, current, next, oldest, current];
  let groups = golfLiveOptionGroups({ schedule, selected: automatic, automatic, year: '2026', today });
  assert.deepEqual(groups.map(group => group.label), ['Recent tournaments', 'Upcoming tournaments']);
  assert.deepEqual(groups[0].events.map(event => event.espnEventId), ['2', '1']);
  assert.deepEqual(groups[1].events.map(event => event.espnEventId), ['3', '4']);
  assert.ok(groups.every(group => group.events.every(event => event.espnEventId !== '10')));
  const delayed = tournament('6', 'Delayed tournament', '2026-08-20', '2026-09-01');
  const completionOrder = golfLiveOptionGroups({ schedule: [recent, delayed], selected: null, automatic, year: '2026', today });
  assert.deepEqual(completionOrder[0].events.map(event => event.espnEventId), ['6', '2'], 'recent order uses completion date when an event is delayed');
  assert.equal(golfLiveTournamentPhase(later, 'final', today), 'past', 'provider final status overrides future calendar date');
  assert.equal(golfLiveTournamentPhase(oldest, 'in_progress', today), 'current', 'provider live status overrides stale dates');
  assert.equal(golfLiveTournamentPhase(current, 'scheduled', today), 'current', 'current-date scheduled event is not already completed');
  assert.equal(golfLiveTournamentPhase({ ...oldest, startDate: null, endDate: null }, undefined, today), 'unknown');
  groups = golfLiveOptionGroups({ schedule, selected: { tournament: later, tournamentStatus: 'final' }, automatic, year: '2026', today });
  assert.equal(groups[0].events[0].espnEventId, '4');
  const parallel = tournament('5', 'Concurrent tournament', '2026-10-01', '2026-10-04');
  groups = golfLiveOptionGroups({ schedule: [parallel, ...schedule], selected: null, automatic, year: '2026', today });
  assert.deepEqual(groups.find(group => group.label === 'In progress').events, [parallel]);
});

test('historical and future calendars have their own organization and retain provider season boundaries', () => {
  const older = { espnEventId: '1', name: 'Early event', startDate: '2025-01-09', endDate: '2025-01-12' };
  const newer = { espnEventId: '2', name: 'Later event', startDate: '2025-08-21', endDate: '2025-08-24' };
  const automatic = { tournament: { ...newer, espnEventId: '10', startDate: '2026-10-01' }, tournamentStatus: 'in_progress' };
  const input = { schedule: [older, newer], selected: automatic, automatic, year: '2025', today: '2026-10-02' };
  assert.deepEqual(golfLiveOptionGroups(input), [{ label: '2025 tournaments', events: [newer, older] }]);
  assert.deepEqual(golfLiveOptionGroups({ ...input, automatic: { tournament: newer } })[0].events, [newer, older], 'historical season does not exclude its resolved Latest event');
  const crossYear = { ...older, espnEventId: '3', startDate: '2026-12-31', endDate: '2027-01-03' };
  const future = { ...newer, startDate: '2027-02-01', endDate: '2027-02-04' };
  assert.deepEqual(golfLiveOptionGroups({ ...input, year: '2027', schedule: [future, crossYear] }), [{ label: 'Upcoming tournaments', events: [crossYear, future] }]);
  assert.deepEqual(golfLiveOptionGroups({ ...input, schedule: [] }), []);
  assert.deepEqual(golfLiveOptionGroups({ ...input, schedule: [], selected: { tournament: newer } }), [{ label: '2025 tournaments', events: [newer] }]);
});

test('default resolution chooses in-progress and current-date events, leaving recent fallback to accepted slate resolver', () => {
  const old = { espnEventId: '1', status: 'final', completed: true, startDate: '2025-08-21', endDate: '2025-08-24' };
  const upcoming = { espnEventId: '2', status: 'scheduled', completed: false, startDate: '2026-12-03', endDate: '2026-12-06' };
  const playing = { espnEventId: '3', status: 'in_progress', completed: false };
  assert.equal(currentGolfLiveEvent([old, upcoming], '2026-10-02'), null);
  assert.equal(currentGolfLiveEvent([old, playing, upcoming], '2026-10-02'), playing);
  assert.equal(currentGolfLiveEvent([upcoming], '2026-12-03'), upcoming);
  assert.equal(matchGolfLiveSlate([{ id: 1, external_event_id: '100' }, { id: 2, external_event_id: '200' }], '200').id, 2);
  assert.equal(matchGolfLiveSlate([{ id: 1, external_event_id: '100' }], '300'), null);
});

test('Golf URLs and Group switching preserve public event identity and discard Group-specific context', () => {
  assert.equal(golfLiveHref('401703531'), '/golf/live?eventId=401703531');
  assert.equal(golfLiveHref(null), '/golf/live');
  const input = { pathname: '/golf/live', search: '?eventId=401703531&slateId=9&playerId=8', targetGroupSlug: 'second', enabledSports: ['golf'], canAdministerGroup: false };
  assert.equal(getGroupSwitchDestination(input), '/golf/live?eventId=401703531');
  assert.equal(getGroupSwitchDestination({ ...input, enabledSports: ['nba'] }), '/groups/second');
  assert.equal(getGroupSwitchDestination({ ...input, search: '?eventId=1&groupId=old' }), '/groups/second');
});

test('client resolves defaults, exact links, upcoming and historical data, invalid IDs, schedule caching and no ownership fallback', async () => {
  const original = global.fetch; const calls = [];
  let providerOffline = false;
  let currentEvents = [], slate = { id: 9, external_event_id: '401850978', label: 'TOUR Championship', start_date: '2026-08-27', end_date: '2026-08-30' };
  const historical = event('401703531', 'TOUR Championship', '2025-08-21T04:00Z', 'STATUS_FINAL', [golfer('10166', '-4'), golfer('100', '-4')]);
  const upcoming = event('401850982', 'Hero World Challenge', '2026-12-03T05:00Z', 'STATUS_SCHEDULED');
  global.fetch = async input => {
    const url = new URL(String(input), 'http://test'); calls.push(url);
    if (url.pathname === '/api/home-summary') {
      const id = url.searchParams.get('eventId');
      return Response.json({ latestSlate: id === null || id === slate.external_event_id ? slate : null, tournamentLeaderboard: [{ playerId: 7, isCurrentUser: true, draftedBy: ['Group A'] }] });
    }
    if (providerOffline) throw new Error('Provider offline');
    if (url.pathname.endsWith('/leaderboard')) return Response.json({ events: url.searchParams.get('event') === '401703531' ? [historical] : url.searchParams.get('event') === '401850982' ? [upcoming] : [] });
    return Response.json({ season: { year: 2026 }, leagues: [{ calendar }], events: url.searchParams.get('dates') === '2025' ? [event('wrong', 'Wrong event', '2025-01-01'), historical] : currentEvents });
  };
  try {
    let client = freshClient();
    const fallback = await client.loadGolfLiveSummary(null);
    assert.equal(fallback.latestSlate.id, 9, 'no live tournament preserves original automatic slate');
    await Promise.all([client.loadGolfLiveSchedule('2026'), client.loadGolfLiveSchedule('2026')]);
    assert.equal(calls.filter(url => url.pathname.endsWith('/scoreboard')).length, 1, 'current event and schedule share cached discovery');
    const linked = await client.loadGolfLiveSummary(slate.external_event_id);
    assert.equal(linked.latestSlate.id, 9);
    assert.equal(linked.tournamentLeaderboard[0].isCurrentUser, true);
    const past = await client.loadGolfLiveSummary('401703531');
    assert.equal(past.tournament.startDate, '2025-08-21');
    assert.equal(past.latestSlate, null);
    assert.equal(past.tournamentLeaderboard.length, 2);
    assert.deepEqual(past.tournamentLeaderboard.map(row => row.positionDisplay), ['T1', 'T1']);
    assert.ok(past.tournamentLeaderboard.every(row => !row.isCurrentUser && !row.isDrafted && row.draftedBy.length === 0));
    assert.equal(past.latestGolfTournamentIsFinal, true);
    const calendarOnly = await client.loadGolfLiveSummary('401850915');
    assert.equal(calendarOnly.tournament.name, 'Bank of Utah Championship');
    assert.deepEqual(calendarOnly.tournamentLeaderboard, []);
    const future = await client.loadGolfLiveSummary('401850982');
    assert.equal(future.tournamentStatus, 'scheduled');
    assert.deepEqual(future.tournamentLeaderboard, []);
    assert.equal(future.latestSlate, null);
    await assert.rejects(client.loadGolfLiveSummary('invalid'), /Invalid Golf event/);
    await assert.rejects(client.loadGolfLiveSummary('999999999'), /could not be found/);
    currentEvents = [event('401850915', 'Bank of Utah Championship', '2026-10-01T04:00Z', 'STATUS_IN_PROGRESS')];
    slate = { ...slate, id: 12, external_event_id: '401850915' };
    client = freshClient();
    const live = await client.loadGolfLiveSummary(null);
    assert.equal(live.latestSlate.id, 12, 'live ESPN event uses exact matching slate');
    providerOffline = true;
    client = freshClient();
    assert.equal((await client.loadGolfLiveSummary(null)).latestSlate.id, 12, 'provider outage preserves existing automatic slate');
    await assert.rejects(client.loadGolfLiveSchedule('2025'), /Provider offline/);
  } finally { global.fetch = original; }
});
