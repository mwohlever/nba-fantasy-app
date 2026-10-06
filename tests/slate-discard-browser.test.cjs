/* eslint-disable @typescript-eslint/no-require-imports */
/* Actual React pages + actual API handlers. Discard RPC uses isolated PostgreSQL.
   Every browser request is intercepted; production/external access is impossible. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createSlateAdminFixture } = require('./helpers/slate-admin-fixture.cjs');
const { createDiscardPostgres, ids, json } = require('./helpers/slate-discard-postgres.cjs');
const bin = process.env.SLATE_DISCARD_TEST_PG_BIN;
const browserModule = process.env.FOOTBALL_BROWSER_MODULE;

test('NFL mobile/desktop: actual discard confirmation/RPC, recreation, opt-out/save, reseed, and stale/scored rejection', {
  skip: (!bin || !browserModule) && 'Set SLATE_DISCARD_TEST_PG_BIN and FOOTBALL_BROWSER_MODULE for isolated DB + Chromium QA',
}, async () => {
  const { chromium } = require(browserModule);
  const db = createDiscardPostgres(bin, 55440);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const bundle = require('./helpers/slate-admin-browser-bundle.cjs')({ includeCreation: true });
  const browser = await chromium.launch(process.env.SLATE_ADMIN_CHROMIUM_PATH ? { executablePath: process.env.SLATE_ADMIN_CHROMIUM_PATH } : {});
  try {
    db.start();
    for (const width of [360, 390, 1024]) {
      db.reset();
      const f = createSlateAdminFixture({ frozen: true, nflWeek: 5 });
      f.tables.slates[0].display_name = '2099 Week 5';
      f.tables.slate_teams.filter(t => t.slate_id === 191).forEach(t => { t.is_participating = true; });
      f.tables.fantasy_drafts[0].participant_ids = [2,3,4,1];
      f.tables.lineups.push({ id: 1075, slate_id: 191, team_id: 2 });
      f.tables.lineup_players.push({ id: 3997, lineup_id: 1075, player_id: 283 });
      const syncDiscardedGraph = () => {
        f.tables.slates = f.tables.slates.filter(s => s.id !== 191);
        for (const table of ['fantasy_drafts','draft_picks','draft_corrections','lineups','slate_teams']) f.tables[table] = f.tables[table].filter(r => r.slate_id !== 191);
        f.tables.lineup_players = [];
      };
      f.db.rpc = async (name, args) => {
        assert.ok(['inspect_nfl_slate_discard','discard_abandoned_nfl_slate'].includes(name));
        assert.equal(args.p_group_id, '111'); assert.equal(args.p_actor_id, 'commissioner');
        const data = JSON.parse(await db.asyncSql(`set role service_role; ${db.call(name, args.p_slate_id)}`));
        if (name === 'discard_abandoned_nfl_slate' && data.success && args.p_slate_id === 191) syncDiscardedGraph();
        return { data, error: null };
      };
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [], discarded = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) {
          const html = `<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style><div id="app"></div><script>${bundle.replaceAll('</script','<\\/script')}
            window.fixtureSport='nfl';window.root=ReactDOMClient.createRoot(document.getElementById('app'));
            root.render(React.createElement(location.pathname==='/slates/new'?CreateSlate:SlateAdmin));</script></html>`;
          return route.fulfill({ contentType: 'text/html', body: html });
        }
        let response;
        if (url.pathname === '/api/admin/slates') response = await f.list.GET({ url: url.href });
        else if (url.pathname === '/api/slates/nfl-week') response = await f.week.GET({ nextUrl: url });
        else if (url.pathname === '/api/slates') {
          if (request.method() === 'POST') {
            response = await f.creation.POST(f.request(request.postDataJSON()));
            if (response.status === 200) {
              const s = response.body.slate;
              db.sql(`insert into slates(id,league_id,sport,date,start_date,end_date,display_name,rules_snapshot,rules_version)
                values(${s.id},'${ids.league}','nfl','${s.date}','${s.start_date}','${s.end_date}','2099 Week 5',${json(s.rules_snapshot)},${s.rules_version});
                insert into slate_teams(slate_id,team_id,draft_order,is_participating) values ${response.body.slateTeams.map(t => `(${s.id},${t.team_id},${t.draft_order},${t.is_participating})`).join(',')};`);
            }
          } else response = await f.creation.GET({ url: url.href });
        } else if (/\/reseed$/.test(url.pathname)) response = await f.reseed.POST({}, f.context(Number(url.pathname.split('/').at(-2))));
        else if (/^\/api\/admin\/slates\/\d+$/.test(url.pathname)) {
          const id = Number(url.pathname.split('/').at(-1));
          if (request.method() === 'DELETE') {
            discarded.push(id); response = await f.route.DELETE(f.request(request.postDataJSON()), f.context(id));
          } else if (request.method() === 'PATCH') response = await f.route.PATCH(f.request(request.postDataJSON()), f.context(id));
          else response = await f.route.GET({}, f.context(id));
        } else throw new Error(`Unexpected intercepted request: ${url.pathname}`);
        return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
      });
      const shot = async state => {
        if (!process.env.SLATE_DISCARD_SCREENSHOT_DIR) return;
        fs.mkdirSync(process.env.SLATE_DISCARD_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SLATE_DISCARD_SCREENSHOT_DIR, `${width}-${state}.png`), fullPage: true });
      };
      await page.goto('http://discard-fixture.test/admin/slates');
      const button = page.getByRole('button', { name: 'Discard Slate', exact: true });
      await button.waitFor(); assert.equal(await button.isEnabled(), true);
      await page.getByText('Participants are locked after drafting begins.').waitFor();
      await shot('started-eligible');
      page.once('dialog', async dialog => { assert.match(dialog.message(), /Discard 2099 Week 5\?\n\nThis permanently removes/); await dialog.dismiss(); });
      await button.click(); assert.deepEqual(discarded, []); assert.equal(db.graph().picks, 1);
      // Stale UI still fails at the database when a zero result appears.
      db.sql('insert into team_slate_results(slate_id,team_id,fantasy_points) values(191,2,0)');
      page.once('dialog', dialog => dialog.accept());
      await button.click(); await page.getByText('Slates with any result or scoring records cannot be discarded.').waitFor();
      assert.equal(db.graph().picks, 1); assert.equal(await button.count(), 0);
      db.sql('delete from team_slate_results where slate_id=191');
      await page.reload(); await button.waitFor();
      page.once('dialog', dialog => dialog.accept());
      await button.click(); await page.waitForFunction(() => ![...document.querySelectorAll('#slate-select option')].some(o => o.value === '191'));
      assert.equal(db.graph().slates, 0); assert.equal(db.graph().picks, 0); assert.equal(db.graph().players, 0);
      assert.notEqual(await page.locator('#slate-select').inputValue(), '191');
      assert.equal(await button.count(), 0); // Week 4 is locked, not discardable.
      await shot('discarded-week4');
      await page.goto('http://discard-fixture.test/slates/new?sport=nfl');
      const create = page.getByRole('button', { name: 'Create Slate', exact: true });
      try {
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Create Slate' && !b.disabled));
      } catch (error) {
        console.error('Creation fixture DOM', await page.locator('body').innerText(), errors);
        throw error;
      }
      for (const name of ['Josh','Jon','Mark','Andy']) assert.equal(await page.getByRole('checkbox', { name, exact: true }).count(), 1);
      assert.equal(await page.getByRole('checkbox', { name: 'Mark YMCA', exact: true }).count(), 0);
      await page.getByRole('checkbox', { name: 'Jon', exact: true }).uncheck();
      await shot('fresh-create-jon-out');
      const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/slates');
      await create.click(); assert.equal((await created).status(), 200);
      const fresh = f.tables.slates.find(s => s.id === 400); assert.ok(fresh);
      assert.equal(db.sql('select count(*) from fantasy_drafts where slate_id=400'), '0');
      assert.equal(db.sql('select count(*) from lineups where slate_id=400'), '0');
      await page.goto('http://discard-fixture.test/admin/slates?slateId=400');
      await page.waitForFunction(() => document.querySelector('#slate-select')?.value === '400');
      await page.getByRole('checkbox', { name: 'Jon participating', exact: true }).waitFor();
      assert.equal(await page.getByRole('checkbox', { name: 'Jon participating', exact: true }).isChecked(), false);
      const saved = page.waitForResponse(r => r.request().method() === 'PATCH');
      await page.getByRole('button', { name: 'Save Slate', exact: true }).click(); assert.equal((await saved).status(), 200);
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save Slate' && !b.disabled));
      const reseeded = page.waitForResponse(r => /\/reseed$/.test(new URL(r.url()).pathname));
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Reseed From Previous Slate', exact: true }).click(); assert.equal((await reseeded).status(), 200);
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Reseed From Previous Slate' && !b.disabled));
      const detail = await f.route.GET({}, f.context(400));
      assert.deepEqual(detail.body.teams.filter(t => t.is_participating).map(t => t.team_name), ['Josh','Mark','Andy']);
      assert.equal(f.tables.group_memberships.find(m => m.group_id === '111' && m.user_id === 'u3').is_active, true);
      await shot('fresh-reseeded');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { db.stop(); await browser.close(); }
});
