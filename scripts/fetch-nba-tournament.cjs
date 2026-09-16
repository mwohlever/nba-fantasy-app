/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit provider GETs only. Local cache, no app routes, no database and no scheduled execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plan = require('../data/analytics/nba-tournament-plan.json');

async function main() {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/fetch-nba-tournament.cjs /tmp/cache-directory');
  const dir = path.resolve(process.argv[2]);
  fs.mkdirSync(dir, { recursive: true });
  const get = async (url, filename) => {
    const file = path.join(dir, filename);
    if (fs.existsSync(file)) {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cached.url !== url) throw new Error(`Cache source mismatch: ${filename}`);
      return cached;
    }
    let response, raw, payload;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
      raw = await response.text();
      try { payload = JSON.parse(raw); } catch { payload = null; }
      const validGameLog = !filename.startsWith('log-') || (Array.isArray(payload?.names) && Array.isArray(payload?.seasonTypes) && payload?.events);
      if (response.ok && validGameLog) break;
      if (attempt === 2 || (response.status < 500 && validGameLog)) break;
      await new Promise(resolve => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
    if (!response.ok || payload === null || (filename.startsWith('log-') && (!Array.isArray(payload.names) || !Array.isArray(payload.seasonTypes) || !payload.events))) throw new Error(`${response.status} invalid response ${url}`);
    const entry = { url, fetchedAt: new Date().toISOString(), sha256: crypto.createHash('sha256').update(raw).digest('hex'), payload };
    fs.writeFileSync(file, JSON.stringify(entry));
    await new Promise(resolve => setTimeout(resolve, 1000));
    return entry;
  };
  const fetchPlayer = async player => {
    const profile = await get(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/${player.espnPlayerId}`, `profile-${player.espnPlayerId}.json`);
    if (String(profile.payload.id) !== player.espnPlayerId) throw new Error('ESPN profile ID mismatch');
    // Validate the explicitly selected ID; never join two player catalogs by name.
    const normalized = s => String(s).normalize('NFD').replace(/[\u0300-\u036f.]/g, '').toLowerCase();
    if (normalized(profile.payload.displayName) !== normalized(player.expectedName)) {
      throw new Error(`Explicit ID requires review: ${player.expectedName} / ${profile.payload.displayName} / ${player.espnPlayerId}`);
    }
    for (const season of player.seasons) {
      await get(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${player.espnPlayerId}/gamelog?season=${season}`, `log-${player.espnPlayerId}-${season}.json`);
      console.log(`${player.espnPlayerId} ${player.expectedName} ${season} cached`);
    }
  };
  // Four independent ESPN requests at a time: bounded, repeatable, and fast
  // enough for a modest representative cohort without turning a refresh into a
  // serial multi-minute job.
  for (let index = 0; index < plan.players.length; index += 4) {
    await Promise.all(plan.players.slice(index, index + 4).map(fetchPlayer));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
