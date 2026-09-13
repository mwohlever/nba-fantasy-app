// Read-only GitHub Actions transport proof. No app API, database, or artifact writes.
const season = Number(process.argv[2] ?? 2026);
if (!Number.isInteger(season) || season < 2000 || season > 2100) {
  console.error('Golf analytics provider probe failed: valid season year required');
  process.exitCode = 1;
} else {
  const startedAt = performance.now();
  const url = new URL('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
  url.searchParams.set('dates', String(season));
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': '111-sports-golf-provider/1.0',
      },
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`ESPN returned HTTP ${response.status}`);

    const body = Buffer.from(await response.arrayBuffer());
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      throw new Error('ESPN returned invalid JSON');
    }
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
      throw new Error('ESPN response has no events array');
    }
    if (payload.season?.year !== undefined && payload.season.year !== season) {
      throw new Error(`ESPN season mismatch: expected ${season}, received ${payload.season.year}`);
    }
    console.log(JSON.stringify({
      status: 'ok',
      httpStatus: response.status,
      season,
      sourceBytes: body.byteLength,
      eventCount: payload.events.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Golf analytics provider probe failed: ${reason}`);
    process.exitCode = 1;
  }
}
