/* Isolated interactive preview of the real admin UI and real handlers; no .env or production connections. */
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('./nba-skins-admin-fixture.cjs');
const root = path.resolve(__dirname, '../..');
let documentPromise;

function previewDocument() {
  return documentPromise ??= (async () => {
    const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
      .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
    const lotteryCss = fs.readFileSync(path.join(root, 'components/nba-skins/LotteryReveal.module.css'), 'utf8');
    const bundle = require('./nba-skins-admin-browser-bundle.cjs')();
    return `<!doctype html><html lang="en" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>NBA Skins · local fixture preview</title><style>${css.css}\n${lotteryCss}</style>
      <div id="app"></div><script>${bundle.replaceAll('</script', '<\\/script')}</script></html>`;
  })();
}

async function startPreview({ port = 0 } = {}) {
  const document = await previewDocument();
  const fixture = createFixture(), requests = [];
  // Mirror the intended season-7 setup, without the accidental future season.
  fixture.tables.nba_skins_seasons = fixture.tables.nba_skins_seasons.filter(s => s.id !== 8);
  fixture.tables.nba_skins_draft_order = fixture.tables.nba_skins_draft_order.filter(row => row.season_id !== 8);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-111-Preview', 'in-memory-fixtures');
      if (req.method === 'GET' && url.pathname === '/admin/nba-skins') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(document); return;
      }
      if (url.pathname !== '/api/admin/nba-skins') { res.writeHead(404); res.end(); return; }
      let response;
      if (req.method === 'GET') {
        requests.push({ method: 'GET' }); response = await fixture.admin.GET();
      } else if (req.method === 'PATCH') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        requests.push({ method: 'PATCH', body: JSON.parse(body) });
        response = await fixture.admin.PATCH(new Request('http://localhost/api/admin/nba-skins', { method: 'PATCH', body }));
      } else { res.writeHead(405); res.end(); return; }
      res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(await response.text());
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { fixture, requests, url: `http://127.0.0.1:${server.address().port}/admin/nba-skins`,
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}

module.exports = { startPreview };
if (require.main === module) {
  startPreview({ port: Number(process.env.NBA_SKINS_PREVIEW_PORT ?? 3112) }).then(preview => {
    console.log(`NBA Skins local preview: ${preview.url}\nReal UI + in-memory database. Saves stay local; restarting resets the fixture.`);
    process.once('SIGINT', () => { void preview.close(); });
    process.once('SIGTERM', () => { void preview.close(); });
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
