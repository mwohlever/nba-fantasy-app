/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const route = fs.readFileSync('app/api/admin/nba/projection-shadow/route.ts', 'utf8');

test('shadow comparison authorizes a supplied slate with the established active-Group resource guard', () => {
  assert.match(route, /import \{ authorizeSlateResource \} from '@\/lib\/security\/resourceAuthorization';/);
  assert.match(route, /authorizeSlateResource\(request, slateId, \{ requireCommissioner: true \}\)/);
  assert.match(route, /if \(!authorization\.ok\) return authorization\.response;/);
});
