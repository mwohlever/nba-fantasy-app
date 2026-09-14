/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('archive state is explicit, indexable, and has no destructive slate action', () => {
  const sql = source('supabase/migrations/20260922000100_slate_archive_and_golf_salary_regeneration.sql');
  assert.match(sql, /add column if not exists archived_at timestamptz/i);
  assert.match(sql, /where archived_at is null/i);
  assert.doesNotMatch(sql, /delete from public\.slates/i);
});

test('normal slate selection excludes archives while commissioner lookup can include them', () => {
  const list = source('app/api/admin/slates/route.ts');
  const detail = source('app/api/admin/slates/[slateId]/route.ts');
  const draft = source('app/lineups/draft/page.tsx');
  const home = source('app/api/home-summary/route.ts');
  const golfHome = source('lib/home/golfHomeSummary.ts');
  assert.match(list, /includeArchived.*searchParams\.get\("includeArchived"\) === "1"/s);
  assert.match(list, /if \(!includeArchived\)[\s\S]*?\.is\("archived_at", null\)/);
  assert.match(detail, /authorizeSlateResource\([\s\S]*?requireCommissioner: true/s);
  assert.match(detail, /archiveOnly === true/);
  assert.match(draft, /\.is\("archived_at", null\)/);
  assert.match(home, /\.is\("archived_at", null\)/);
  assert.match(golfHome, /\.is\("archived_at", null\)/);
});

test('Slate Manager labels, archives, and restores slates through the commissioner route', () => {
  const page = source('app/admin/slates/page.tsx');
  assert.match(page, /Show archived/);
  assert.match(page, /Archive Slate/);
  assert.match(page, /Restore Slate/);
  assert.match(page, /archiveOnly: true, archived/);
  assert.match(page, /archived_at \? " \(Archived\)"/);
  assert.match(page, /nextSlates\.find\(\(slate\) => !slate\.archived_at\)/);
});

test('regeneration is an atomic generated-only, lifecycle-guarded replacement', () => {
  const sql = source('supabase/migrations/20260922000100_slate_archive_and_golf_salary_regeneration.sql');
  const route = source('app/api/admin/golf/salary-cap/route.ts');
  assert.match(sql, /for update/i);
  assert.match(sql, /ps\.status<>'generated'/);
  assert.match(sql, /perform public\.lock_golf_lifecycle/);
  assert.match(sql, /Salary setup is locked/);
  assert.match(sql, /golf_salary_cap_lineups/);
  assert.match(sql, /delete from public\.golf_salary_board_inputs[\s\S]*?delete from public\.golf_salary_prices[\s\S]*?delete from public\.golf_salary_price_sets[\s\S]*?create_golf_salary_price_set_with_manifest/s);
  assert.match(sql, /current_setting\('app\.golf_salary_regeneration',true\)='on'/);
  assert.match(sql, /grant execute on function public\.regenerate_golf_salary_price_set_with_manifest[\s\S]*?to service_role/i);
  assert.match(route, /"regenerate"/);
  assert.match(route, /regenerate_golf_salary_price_set_with_manifest/);
  assert.match(route, /Frozen Golf salaries are immutable/);
});
