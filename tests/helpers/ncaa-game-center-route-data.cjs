/* Execute the real scores/detail GET handlers; mock only auth/access and provider HTTP. */
const assert = require('node:assert/strict');
const Module = require('node:module');
require('./scores-harness.cjs');
const fixture = require('../fixtures/ncaa-week5-401858473.json');

module.exports = async function ncaaGameCenterRouteData({ includeSecondGame = false } = {}) {
  const second = includeSecondGame ? require('../fixtures/ncaa-week5-401858250.json') : null;
  const originalLoad = Module._load, originalFetch = global.fetch;
  const calls = [];
  try {
    Module._load = function(request, parent, ...args) {
      if (request === '@/lib/auth') return { getCurrentUser: async () => ({ id: 'fixture-viewer' }) };
      if (request === '@/lib/ncaaPickEm/access') return { getNcaaPickEmAccess: async () => ({}) };
      return originalLoad.call(this, request, parent, ...args);
    };
    const scoresGet = require('../../app/api/ncaa-pickem/scores/route.ts').GET;
    const detailGet = require('../../app/api/ncaa-pickem/game-detail/route.ts').GET;
    Module._load = originalLoad;
    global.fetch = async input => {
      const url = new URL(String(input)); calls.push(url.href);
      assert.equal(url.hostname, 'site.api.espn.com', 'Only captured public provider reads');
      const payload = url.pathname.endsWith('/scoreboard') ? { ...fixture.scoreboard, events: [...fixture.scoreboard.events, ...(second ? [second.scoreboardEvent] : [])] }
        : url.pathname.endsWith('/rankings') ? fixture.rankings
        : url.pathname.endsWith('/summary') && url.searchParams.get('event') === '401858473' ? fixture.summary
        : url.pathname.endsWith('/summary') && second && url.searchParams.get('event') === second.scoreboardEvent.id ? second.summary : null;
      assert.ok(payload, url.href);
      return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
    };
    const { NextRequest } = require('next/server');
    const scores = await scoresGet(new NextRequest('http://localhost/api/ncaa-pickem/scores?season=2026&week=5'));
    const detail = await detailGet(new NextRequest('http://localhost/api/ncaa-pickem/game-detail?eventId=401858473'));
    assert.equal(scores.status, 200); assert.equal(detail.status, 200);
    const secondDetail = second ? await detailGet(new NextRequest(`http://localhost/api/ncaa-pickem/game-detail?eventId=${second.scoreboardEvent.id}`)) : null;
    if (secondDetail) assert.equal(secondDetail.status, 200);
    return { secondDetail: secondDetail ? await secondDetail.json() : null, scores: await scores.json(), detail: await detail.json(), calls };
  } finally { Module._load = originalLoad; global.fetch = originalFetch; }
};
