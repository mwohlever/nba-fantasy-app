/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const route = fs.readFileSync('app/api/admin/nba/projection-shadow/route.ts', 'utf8');

test('retired NBA shadow endpoint performs no authorization-dependent database reads',()=>{assert.match(route,/status: 410/);assert.doesNotMatch(route,/supabaseAdmin|authorizeSlateResource|getPlayerProjections/);});
