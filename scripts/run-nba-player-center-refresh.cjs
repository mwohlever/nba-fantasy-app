/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit execution only; no .env loading. Credentials remain in the GitHub job environment.
const fs = require('node:fs'), { randomUUID } = require('node:crypto');
require('./lib/playerCenterRollout.cjs').registerTypescript();
const { buildNbaRefreshPublication, refreshHash, NBA_APPEND_SOURCE_MD5, NBA_REFRESH_LIMITS } = require('../lib/player-center/nbaRefresh.ts');
const { resolveNbaObservationSeason } = require('./lib/nbaObservationSeason.cjs');
function publicationBatches(items) {
  const batches=[];let batch=[];
  for(const item of items) {
    if(Buffer.byteLength(JSON.stringify([item]))>2500000) throw Error('Single publication exceeds request budget');
    if(batch.length===5 || Buffer.byteLength(JSON.stringify([...batch,item]))>2500000) {batches.push(batch);batch=[];}
    batch.push(item);
  }
  if(batch.length)batches.push(batch);return batches;
}
const GOOD = new Set(['verified_data', 'verified_zero_appearances']);
function selectRefreshSeason({ now = new Date(), mode = 'current', override } = {}) {
  if (!['current', 'prior'].includes(mode)) throw Error('Mode must be current or prior');
  const current = resolveNbaObservationSeason({ now });
  const season = override?.trim() ? resolveNbaObservationSeason({ now, override }) : current - (mode === 'prior' ? 1 : 0);
  if (season > current || season < 2000) throw Error('Invalid future/unsupported NBA refresh season');
  return season;
}

async function boundedJson(response, cap = 3_000_000) {
  if (!response.body?.getReader) { const text = await response.text(); if (Buffer.byteLength(text) > cap) throw Error('Provider response size cap'); return JSON.parse(text); }
  const reader = response.body.getReader(), parts = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > cap) throw Error('Provider response size cap'); parts.push(Buffer.from(value)); } }
  finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

function providerReader({ request = fetch, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), maxRequests, deadline }) {
  let count = 0, next = 0, queue = Promise.resolve();
  async function read(player, season, kind) {
    const suffix = kind === 'log' ? `gamelog?season=${season}` : `stats?season=${season}&seasontype=2`;
    const url = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${player.providerPlayerId}/${suffix}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      let retry = false;
      try {
        const turn = queue.then(async () => { if (now() >= deadline || count >= maxRequests) throw Error('Acquisition request/time budget exhausted'); await sleep(Math.max(0, next - now())); if (now() >= deadline) throw Error('Acquisition deadline reached'); next = now() + 1500; count++; });
        queue = turn.catch(() => {}); await turn;
        const response = await request(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        retry = response.status === 429 || response.status >= 500;
        if (!response.ok) throw Error(`provider_http_${response.status}`);
        return { payload: await boundedJson(response), fetchedAt: new Date(now()).toISOString() };
      } catch (error) {
        retry ||= error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.name === 'TypeError';
        if (/budget exhausted|deadline reached/i.test(String(error.message))) throw error;
        if (attempt === 0 && retry && count < maxRequests && now() + 3000 < deadline) { await sleep(3000); continue; }
        return { fetchedAt: new Date(now()).toISOString(), error: String(error.message || error).slice(0, 240) };
      }
    }
  }
  return { read, requests: () => count };
}

/** Injectable orchestration; tests never need a production client or secret. */
async function runNbaRefresh({ api, read, season, execute = false, checkpoint, save = () => {}, now = Date.now,
  expectedProject = 'oororafwujfliscjasur', deadline = now() + 40 * 60000 }) {
  const health = full => api({ action: 'health', full });
  const gate = (value, full=false) => { if (![value.database_bytes, value.cache_bytes, value.wal_bytes, value.available_bytes].every(n => Number.isFinite(n) && n >= 0) || value.project_ref !== expectedProject || value.append_source_hash !== NBA_APPEND_SOURCE_MD5 || value.schema_ok !== true || value.reference_errors > 0 ||
    value.available_bytes < NBA_REFRESH_LIMITS.reserveBytes + NBA_REFRESH_LIMITS.walAllowanceBytes || value.database_bytes + 4 * 1048576 > NBA_REFRESH_LIMITS.stopDatabaseBytes || value.cache_bytes >= NBA_REFRESH_LIMITS.cacheBytes ||
    !Number.isFinite(Date.parse(value.metrics_at)) || Math.abs(now() - Date.parse(value.metrics_at)) > 90000) throw Error('Production target/storage/integrity gate failed'); if(full && (!Number.isSafeInteger(value.history_count)||!Number.isSafeInteger(value.current_count)||value.reference_errors!==0)) throw Error('Incomplete full integrity checkpoint'); };
  const state = checkpoint || { version: 1, releaseSha:process.env.GITHUB_SHA||'local-test', runId: randomUUID(), season, asOf: new Date(now()).toISOString(), execute,
    players: (await api({ action: 'cohort' })).players, publications: [], committedPlayers: [], events: [], status: 'ACQUIRING' };
  state.status='PREFLIGHT';state.clean=false;save(state);
  try {
  if (state.releaseSha && state.releaseSha!==(process.env.GITHUB_SHA||'local-test')) throw Error('Reviewed runner commit changed; do not resume old checkpoint');
  if (state.version !== 1 || state.season !== season || state.execute !== execute || state.poolHash && state.poolHash !== refreshHash(state.players) ||
    !Array.isArray(state.players) || state.players.length < 1 || state.players.length > 2000 || new Set(state.players.map(p => p.playerId)).size !== state.players.length) throw Error('Checkpoint/cohort mismatch');
  state.poolHash = refreshHash(state.players);
  const currentPool = (await api({ action: 'cohort' })).players;
  if (refreshHash(currentPool) !== state.poolHash) throw Error('Acquisition cohort changed; a new review/run is required');
  const initial = await health(true); gate(initial,true); state.before ||= initial; save(state);
  if (execute && checkpoint) {
    const receipts = (await api({ action: 'receipts', runId: state.runId, season })).receipts;
    const known = new Set(state.publications.map(p => p.player_id));
    if (receipts.some(r => !known.has(Number(r.player_id)))) throw Error('Unexpected committed receipt');
    // Reconcile ambiguous responses by exact replay. SQL checks the original JSONB receipt hash
    // and skips acknowledged players without touching facts, cache or status timestamps.
    state.committedPlayers = []; save(state);
  }
    const publishPending = async () => {
      const pending = state.publications.filter(p => !state.committedPlayers.includes(p.player_id));
      for(const batch of execute?publicationBatches(pending):[]) {
        if(now()>=deadline) throw Error('Publication deadline reached');
        const metrics=await health(false);gate(metrics);
        const receipt=await api({action:'publish',runId:state.runId,season,asOf:state.asOf,publications:batch});
        if(receipt.players!==batch.length || !Number.isSafeInteger(receipt.appended) || !Number.isSafeInteger(receipt.accepted) || receipt.appended<0 || receipt.accepted<receipt.appended) throw Error('Unexpected publication counts');
        state.committedPlayers.push(...batch.map(p=>p.player_id));
        state.events.push({playerIds:batch.map(p=>p.player_id),receipt,database_bytes:metrics.database_bytes,wal_bytes:metrics.wal_bytes,available_bytes:metrics.available_bytes});save(state);
      }
    };
    // Exact replays validate ambiguous prior commits before any new acquisition.
    if(execute && checkpoint) await publishPending();
    let consecutiveFailures=0;
    for (const player of state.players) {
      if (state.publications.some(p => p.player_id === player.playerId)) continue;
      if (now() >= deadline) throw Error('Acquisition deadline reached; incomplete cohort');
      if (!Number.isSafeInteger(player.playerId) || player.playerId <= 0 || player.sport !== 'nba' || !player.active ||
        player.identity === 'resolved' && (!/^\d+$/.test(player.providerPlayerId) || !/^\d+$/.test(player.nativePlayerId))) throw Error('Invalid cohort identity');
      const sources = player.identity === 'resolved' ? await Promise.all([read(player, season, 'log'), read(player, season, 'summary')]) : [];
      const publication = buildNbaRefreshPublication({ player, season, asOf: state.asOf, runId: state.runId,
        attemptedAt: new Date(now()).toISOString(), log: sources[0], summary: sources[1] });
      state.publications.push(publication); save(state);
      if(player.identity==='resolved') consecutiveFailures=publication.outcome==='acquisition_failed'?consecutiveFailures+1:0;
      if(state.publications.length%5===0 || consecutiveFailures>=10) await publishPending();
      if(consecutiveFailures>=10) throw Error('Provider circuit breaker: 10 consecutive unverified acquisitions');
    }
    state.status = execute ? 'PUBLISHING' : 'DRY_RUN'; save(state);
    await publishPending();
    state.after = await health(true); gate(state.after,true);
    if (execute) {
      const receipts = (await api({ action: 'receipts', runId: state.runId, season })).receipts;
      const ids = new Set(receipts.map(r => Number(r.player_id)));
      if (ids.size !== state.players.length || state.players.some(p => !ids.has(p.playerId))) throw Error('Incomplete final receipt coverage');
      state.appended = receipts.reduce((n, r) => n + Number(r.appended_versions), 0);
      state.appendedThisAttempt=state.after.history_count-initial.history_count;
      if (state.after.history_count - state.before.history_count !== state.appended ||
        state.appended === 0 && state.after.current_checksum !== state.before.current_checksum) throw Error('Unexpected observation growth/current change');
    } else {state.appended=0;state.appendedThisAttempt=0;}
    state.warnings=[];
    if(state.after.database_bytes>=NBA_REFRESH_LIMITS.warningDatabaseBytes) state.warnings.push('database_above_400mb_warning');
    if(state.after.wal_bytes-initial.wal_bytes>NBA_REFRESH_LIMITS.walAllowanceBytes) state.warnings.push('cluster_wal_growth_above_allowance');
    state.failed = state.publications.filter(p => p.outcome === 'acquisition_failed').map(p => ({ id: p.provider_player_id, playerId: p.player_id, season, issues: p.issues }));
    state.incomplete = state.publications.filter(p => p.outcome === 'coverage_incomplete').map(p => ({ playerId: p.player_id, issues: p.issues }));
    state.blocked = state.publications.filter(p => p.outcome === 'blocked_identity').map(p => ({ playerId: p.player_id, issues: p.issues }));
    state.verified = state.publications.filter(p => GOOD.has(p.outcome)).length;
    state.accepted = state.publications.reduce((n, p) => n + p.observations.length, 0);
    state.clean = state.failed.length === 0 && state.incomplete.length === 0 && state.blocked.length === 0;
    state.status = state.clean ? execute ? 'COMPLETE' : 'DRY_RUN_COMPLETE' : 'PARTIAL_COVERAGE';
    save(state); return state;
  } catch (error) { state.status = 'STOPPED'; state.error = String(error.message || error).slice(0, 500); state.failed=(state.publications||[]).filter(p=>p.outcome==='acquisition_failed').map(p=>({id:p.provider_player_id,playerId:p.player_id,season,issues:p.issues})); save(state); throw error; }
}

module.exports = { runNbaRefresh, providerReader, boundedJson, selectRefreshSeason, publicationBatches };
if (require.main === module) (async () => {
  const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const execute = args.includes('--execute'), mode = option('--mode') || 'current';
  if (!['current', 'prior'].includes(mode)) throw Error('Mode must be current or prior');
  if (execute && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main' ||
    !['workflow_dispatch', 'schedule'].includes(process.env.GITHUB_EVENT_NAME))) throw Error('Execution requires the approved main-branch GitHub workflow');
  const base = process.env.NBA_PROJECTION_INGEST_BASE_URL, secret = process.env.NBA_PROJECTION_INGEST_SECRET;
  if (base !== 'https://www.111sports.app' || !secret?.trim()) throw Error('Intended production URL and job secret required');
  if (execute && require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== process.env.GITHUB_SHA) throw Error('Checked-out commit differs from workflow commit');
  const season = selectRefreshSeason({ mode, override: option('--season') });
  const resume = option('--resume'), file = option('--report') || 'nba-factual-refresh-report.json';
  if (fs.existsSync(file) && file !== resume) throw Error('Refusing to overwrite an execution report');
  const checkpoint = resume ? JSON.parse(fs.readFileSync(resume, 'utf8')) : undefined;
  let reader;
  const save = state => { state.providerRequestsThisAttempt=reader?.requests()??0;const temp = file + '.partial'; fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, file); };
  const api = async body => {
    const response = await fetch(new URL('/api/internal/nba/player-center-refresh', base), { method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(90000) });
    const payload = await boundedJson(response, 5_000_000);
    if (!response.ok) throw Error(payload.error || `Factual API HTTP ${response.status}`); return payload;
  };
  const deadline = Date.now() + 40 * 60000;
  const pool = checkpoint?.players || (await api({ action: 'cohort' })).players;
  reader = providerReader({ maxRequests: Math.ceil(pool.filter(p => p.identity === 'resolved').length * 2 * 1.25), deadline });
  const result = await runNbaRefresh({ api, read: reader.read, season, execute, checkpoint, save, deadline });
  console.log(JSON.stringify({ status: result.status, execute, season, runId: result.runId, poolPlayers: result.players.length,
    accepted: result.accepted, appendedForRun: result.appended, appendedThisAttempt: result.appendedThisAttempt, warnings:result.warnings, verified: result.verified, failed: result.failed, incomplete: result.incomplete, blocked: result.blocked,
    providerRequests: reader.requests(), before: result.before, after: result.after, report: file }, null, 2));
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### NBA factual refresh: ${result.status}\n\nSeason: ${season}; pool: ${result.players.length}; verified: ${result.verified}.\n\nAccepted: ${result.accepted}; appended this attempt: ${result.appendedThisAttempt}; appended for original run: ${result.appended}.\n\nFailed: ${result.failed.length}; incomplete: ${result.incomplete.length}; blocked identities: ${result.blocked.length}.\n\nDatabase: ${result.after.database_bytes} bytes; free disk: ${result.after.available_bytes} bytes; WAL: ${result.after.wal_bytes} bytes.\n`);
  if(result.warnings.length) console.warn('::warning::'+result.warnings.join(', '));
  if (!result.clean) process.exitCode = 1;
})().catch(error => { console.error(String(error.message || error)); process.exitCode = 1; });
