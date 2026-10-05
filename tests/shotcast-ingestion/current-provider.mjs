// Run the unchanged current provider against preserved PGA transport responses.
// No PGA request, scoring API or database write occurs in this test boundary.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

const require = createRequire(import.meta.url);

export async function preservedReplay(descriptor, holeNumber = descriptor.selection.hole) {
  const native = JSON.parse(fs.readFileSync(descriptor.shotSource.source.localPath, 'utf8'));
  const requests = [];
  const transport = async (url, init) => {
    requests.push(String(url));
    let body;
    if (String(url).includes('/schedule/')) body = { tournaments: [{ tournamentId: descriptor.event.id, name: descriptor.event.name }] };
    else if (String(url).includes('/player/list/')) body = { players: [{ id: descriptor.selection.playerId, displayName: descriptor.shotSource.identity.playerName }] };
    else {
      const query = JSON.parse(init.body);
      if (query.operationName !== 'ShotDetailsCompressedV3' || query.variables.tournamentId !== descriptor.event.id || query.variables.playerId !== descriptor.selection.playerId || query.variables.round !== descriptor.selection.round) throw new Error('Unexpected provider request');
      body = { data: { shotDetailsCompressedV3: { payload: gzipSync(JSON.stringify(native)).toString('base64') } } };
    }
    return Response.json(body);
  };
  const loaded = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('lib/providers/pgaTourShots.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = name => name === 'server-only' ? {} : name === 'next/cache' ? { unstable_cache: fn => fn } : require(name);
  new Function('exports', 'require', 'module', 'fetch', 'process', 'Buffer', 'setTimeout', 'clearTimeout', source)(
    loaded.exports, localRequire, loaded, transport, process, Buffer, setTimeout, clearTimeout,
  );
  const replay = await loaded.exports.fetchGolfHoleReplay({ year: Number(descriptor.event.id.slice(1, 5)), tournamentName: descriptor.event.name,
    playerName: descriptor.shotSource.identity.playerName, roundNumber: descriptor.selection.round, holeNumber });
  return { replay, requests };
}
