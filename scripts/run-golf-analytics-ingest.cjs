/* GitHub worker: fetch ESPN directly, use the shared normalizer, and send bounded requests to 111 Sports. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);

const { buildGolfAnalyticsProviderPlan, golfAnalyticsBeginPayload } = require(path.join(__dirname, '../lib/golf/valueAnalytics.ts'));
const DEFAULT_BASE_URL = 'https://www.111sports.app';
const MAX_REQUEST_BYTES = 2_000_000;
const timeoutMs = 90_000;

function seasonForRun() {
  const configured = process.env.GOLF_ANALYTICS_SEASON?.trim();
  const season = configured ? Number(configured) : new Date().getUTCFullYear();
  if (!Number.isInteger(season) || season < 2000 || season > 2100) throw new Error('Valid Golf analytics season required');
  return season;
}

function compact(value) { return JSON.stringify(value); }
function ensureBounded(value, label) {
  const bytes = Buffer.byteLength(compact(value));
  if (bytes > MAX_REQUEST_BYTES) throw new Error(`${label} exceeds the ${MAX_REQUEST_BYTES}-byte ingestion limit`);
  return bytes;
}

async function post(baseUrl, secret, body) {
  ensureBounded(body, `Golf analytics ${body.action} request`);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(new URL('/api/internal/golf/analytics-ingest', baseUrl), {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: compact(body),
      });
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error(`Ingestion ${body.action} returned invalid JSON (HTTP ${response.status})`); }
      if (response.ok) return parsed;
      if (response.status < 500 || attempt === 3) throw new Error(`Ingestion ${body.action} failed (HTTP ${response.status}): ${String(parsed.error ?? 'unknown error').slice(0, 300)}`);
      lastError = new Error(`Ingestion ${body.action} transient HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === 3 || /Ingestion .* failed/.test(String(error))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  throw lastError;
}

async function run() {
  const season = seasonForRun();
  const startedAt = performance.now();
  const url = new URL('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
  url.searchParams.set('dates', String(season));
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json', 'User-Agent': '111-sports-golf-provider/1.0' } });
  if (!response.ok) throw new Error(`ESPN returned HTTP ${response.status}`);
  const source = Buffer.from(await response.arrayBuffer());
  let payload;
  try { payload = JSON.parse(source.toString('utf8')); } catch { throw new Error('ESPN returned invalid JSON'); }
  const plan = buildGolfAnalyticsProviderPlan(payload, season);
  const beginPayload = golfAnalyticsBeginPayload(plan);
  const beginBytes = ensureBounded({ action: 'begin', plan: beginPayload }, 'Golf analytics begin request');
  const baseSummary = { provider: plan.provider, season, sourceBytes: source.byteLength, eventCount: plan.eventIds.length,
    completedEventCount: plan.events.length, beginBytes, elapsedMs: Math.round(performance.now() - startedAt) };
  if (process.env.GOLF_ANALYTICS_DRY_RUN === '1') {
    console.log(JSON.stringify({ status: 'dry_run_ok', ...baseSummary }));
    return;
  }
  const secret = process.env.GOLF_ANALYTICS_INGEST_SECRET?.trim();
  if (!secret) throw new Error('GOLF_ANALYTICS_INGEST_SECRET is required');
  const baseUrl = process.env.GOLF_ANALYTICS_INGEST_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const begun = await post(baseUrl, secret, { action: 'begin', plan: beginPayload });
  if (begun.alreadyReady) {
    console.log(JSON.stringify({ status: 'already_ready', ...baseSummary, refreshId: begun.refreshId }));
    return;
  }
  if (!Number.isSafeInteger(begun.refreshId) || !Array.isArray(begun.eventManifest) || begun.eventManifest.length !== plan.events.length)
    throw new Error('Ingestion begin returned an invalid event manifest');
  const expected = new Map(begun.eventManifest.map(event => [event.eventId, event]));
  const ingested = [];
  for (const event of plan.events) {
    const expectedEvent = expected.get(event.eventId);
    if (!expectedEvent || expectedEvent.sourceHash !== event.sourceHash || !/^[a-f0-9]{64}$/.test(expectedEvent.normalizedHash))
      throw new Error(`Ingestion begin manifest mismatch for event ${event.eventId}`);
    const result = await post(baseUrl, secret, { action: 'event', refreshId: begun.refreshId, eventId: event.eventId,
      expectedNormalizedHash: expectedEvent.normalizedHash, rawEvent: event.rawEvent });
    if (result.eventId !== event.eventId || result.sourceHash !== event.sourceHash || result.normalizedHash !== expectedEvent.normalizedHash)
      throw new Error(`Ingestion event acknowledgement mismatch for ${event.eventId}`);
    ingested.push({ eventId: result.eventId, sourceHash: result.sourceHash, normalizedHash: result.normalizedHash });
  }
  const finalized = await post(baseUrl, secret, { action: 'finalize', refreshId: begun.refreshId, eventManifest: ingested });
  if (finalized.status !== 'ready') throw new Error('Golf analytics finalize did not reach ready status');
  console.log(JSON.stringify({ status: 'ready', ...baseSummary, refreshId: begun.refreshId,
    ingestedEventCount: ingested.length, eventVersionCount: finalized.eventVersionCount,
    elapsedMs: Math.round(performance.now() - startedAt) }));
}

run().catch(error => {
  console.error(`Golf analytics ingestion failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
