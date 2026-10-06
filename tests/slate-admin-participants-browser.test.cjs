/* Real Chromium + actual Slate Manager UI + actual handlers backed by in-memory data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createSlateAdminFixture } = require('./helpers/slate-admin-fixture.cjs');

test('Slate Admin mobile/desktop: active members, Jon opt-out/save, ordering, Group switch, frozen/history controls', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to the installed Playwright module',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const bundle = require('./helpers/slate-admin-browser-bundle.cjs')();
  const browser = await chromium.launch(process.env.SLATE_ADMIN_CHROMIUM_PATH ? { executablePath: process.env.SLATE_ADMIN_CHROMIUM_PATH } : {});
  try {
    for (const width of [360, 390, 1024]) for (const sport of ['nfl', 'nba', 'golf']) {
      const f = createSlateAdminFixture({ sport });
      f.tables.slate_teams.find(t => t.team_id === 3).is_participating = true;
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [], saves = []; let group = '111';
      page.on('pageerror', error => errors.push(error.message));
      const html = `<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style><div id="app"></div><script>${bundle.replaceAll('</script', '<\\/script')}
        window.fixtureSport='${sport}';window.root=ReactDOMClient.createRoot(document.getElementById('app'));
        window.renderFixture=key=>root.render(React.createElement(SlateAdmin,{key}));renderFixture('111');</script></html>`;
      // No request is allowed through to an application or external service.
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: html });
        let response;
        if (url.pathname === '/api/admin/slates') {
          const slate = f.tables.slates.find(s => s.id === (group === '111' ? 191 : 300));
          response = { status: 200, body: { slates: [{ ...slate, label: slate.display_name ?? 'Other Group Week' }] } };
        } else if (/^\/api\/admin\/slates\/\d+$/.test(url.pathname)) {
          const id = Number(url.pathname.split('/').at(-1));
          if (request.method() === 'PATCH') {
            const body = request.postDataJSON(); saves.push(body);
            response = await f.route.PATCH(f.request(body), f.context(id));
          } else response = await f.route.GET({}, f.context(id));
        } else response = { status: 200, body: { success: true } };
        return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
      });
      const openTeams = async () => {
        if (sport === 'golf') await page.getByRole('button', { name: 'Teams & Draft', exact: true }).click();
        await page.getByRole('table').waitFor();
      };
      const save = async () => {
        const pending = page.waitForResponse(response => response.request().method() === 'PATCH' && /\/api\/admin\/slates\/\d+$/.test(response.url()));
        await page.getByRole('button', { name: 'Save Slate', exact: true }).click();
        assert.equal((await pending).status(), 200);
        await page.waitForFunction(() => [...document.querySelectorAll('button')]
          .some(button => button.textContent.trim() === 'Save Slate' && !button.disabled));
      };
      await page.goto('http://slate-admin.test/admin/slates');
      await page.getByRole('button', { name: 'Save Slate', exact: true }).waitFor();
      await openTeams();
      assert.equal(await page.getByRole('checkbox', { name: /participating$/ }).count(), 4);
      assert.equal(await page.getByRole('checkbox', { name: 'Mark YMCA participating', exact: true }).count(), 0);
      assert.equal(await page.getByRole('checkbox', { name: 'Other Group YMCA participating', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Move Mark up', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Jon participating', exact: true }).uncheck();
      await save();
      assert.deepEqual(saves.at(-1).teams.map(t => t.team_id), [2, 4, 1, 3]);
      assert.equal(saves.at(-1).teams.at(-1).is_participating, false);
      assert.equal(f.tables.group_memberships.find(m => m.group_id === '111' && m.user_id === 'u3').is_active, true);
      assert.equal(await page.getByRole('checkbox', { name: 'Jon participating', exact: true }).isChecked(), false);
      const screenshot = async state => {
        if (!process.env.SLATE_ADMIN_SCREENSHOT_DIR) return;
        fs.mkdirSync(process.env.SLATE_ADMIN_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SLATE_ADMIN_SCREENSHOT_DIR, `${sport}-${width}-${state}.png`), fullPage: true });
      };
      await screenshot('editable');

      // A started draft freezes participant controls, while unrelated settings remain savable.
      if (sport === 'golf') f.tables.golf_salary_cap_lineups.push({ slate_id: 191, team_id: 2 });
      else f.tables.fantasy_drafts.push({ slate_id: 191, participant_ids: [2, 4, 1] });
      await page.reload(); await page.getByRole('button', { name: 'Save Slate', exact: true }).waitFor(); await openTeams();
      await page.getByText(/Participants are locked/).waitFor();
      for (const checkbox of await page.getByRole('checkbox', { name: /participating$/ }).all()) assert.equal(await checkbox.isDisabled(), true);
      for (const button of await page.getByRole('button', { name: /^Move / }).all()) assert.equal(await button.isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Reseed From Previous Slate' }).isDisabled(), true);
      await screenshot('frozen');
      const before = structuredClone(f.tables.slate_teams);
      await save();
      assert.equal('teams' in saves.at(-1), false);
      assert.deepEqual(f.tables.slate_teams, before);

      // Historic former member is shown as an original record, with disabled controls.
      f.tables.slates[0].is_locked = true;
      f.tables.slate_teams.push({ slate_id: 191, team_id: 5, draft_order: 5, is_participating: true });
      await page.reload(); await page.getByRole('button', { name: 'Save Slate', exact: true }).waitFor(); await openTeams();
      await page.getByRole('checkbox', { name: 'Mark YMCA participating', exact: true }).waitFor();
      assert.equal(await page.getByRole('checkbox', { name: 'Mark YMCA participating', exact: true }).isDisabled(), true);
      await screenshot('historical');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

      // Real GroupProvider remounts its subtree by Group key; reproduce that boundary here.
      group = 'other'; f.switchGroup(group);
      await page.evaluate(() => renderFixture('other'));
      await page.waitForFunction(() => document.querySelector('#slate-select')?.value === '300');
      await page.getByRole('button', { name: 'Save Slate', exact: true }).waitFor(); await openTeams();
      await page.getByRole('checkbox', { name: 'Other Group YMCA participating', exact: true }).waitFor();
      assert.equal(await page.getByRole('checkbox', { name: /participating$/ }).count(), 1);
      assert.equal(await page.getByRole('checkbox', { name: 'Josh participating', exact: true }).count(), 0);
      assert.equal(await page.getByRole('checkbox', { name: 'Mark YMCA participating', exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
