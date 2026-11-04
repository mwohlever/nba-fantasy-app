/* eslint-disable @typescript-eslint/no-require-imports */
// Offline fixture replay only. No network, credentials, database client, ingestion or scoring writes.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args);};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const {normalizeCenterLog,normalizeCenterNflSummary,enrichNflGame}=require('../lib/player-center/espn.ts');
const {actualFantasyPoints}=require('../lib/player-center/comparison.ts');
const captureFile=path.join(root,'data/player-center-preview/captured.json'),capture=JSON.parse(fs.readFileSync(captureFile));
const fixture=name=>JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/player-center',name)));
assert.equal(capture.capturedAt,'2026-10-23T17:03:48.642Z','this replay is scoped to the reviewed October 23 snapshot');
const corrections=[];
for(const [local,provider,event]of [[1,'4373626','401872991'],[435,'3139477','401872945'],[4,'3045523','401872991']]){
 const h=capture.histories.find(h=>h.player.sport==='nfl'&&h.player.playerId===local&&h.player.providerPlayerId===provider&&h.season===2026);assert.ok(h,'exact reviewed fixture identity');assert.equal(h.player.nativePlayerId,provider);
 const index=h.games.findIndex(g=>g.eventId===event);assert.ok(index>=0);
 const before=h.games[index],log=local===4?null:fixture(`nfl-log-${provider}-${event}.json`),summary=fixture(`nfl-summary-${event}.json`);
 const game=log?normalizeCenterLog(log,{sport:'nfl',providerPlayerId:provider,season:2026,phase:'regular',fetchedAt:log._fixture.fetchedAt}).games.find(g=>g.eventId===event):structuredClone(before);
 for(const key of ['eventId','providerPlayerId','gameAt','season','phase','teamId','opponentId'])assert.equal(game[key],before[key]);
 const normalized=normalizeCenterNflSummary(summary,event);if(!log)assert.ok(normalized.teams[game.teamId].receiving.values[provider],'exact athlete participation in the same team/game');
 const after=enrichNflGame(game,normalized,summary._fixture.source);
 for(const key of Object.keys(before.stats).filter(key=>key!=='fumbles_lost'))assert.equal(after.stats[key],before.stats[key],`unexpected change: ${event}:${key}`);
 assert.equal(after.stats.fumbles_lost,0);assert.ok(before.stats.fumbles_lost===null||before.stats.fumbles_lost===0);
 h.games[index]=after;
 if(h.games.filter(g=>Date.parse(g.gameAt)<=Date.parse(capture.capturedAt)&&g.participation!=='dnp').every(g=>g.sources.some(source=>source.endsWith(`summary?event=${g.eventId}`))))h.coverage.issues=h.coverage.issues.filter(issue=>issue!=='summary_coverage_budget_limited');
 corrections.push({localPlayerId:local,providerPlayerId:provider,eventId:event,season:2026,field:'fumbles_lost',before:null,after:0,verifiedAt:summary._fixture.fetchedAt,
   evidence:local===1?'Explicit athlete-log fumblesLost=0 retained when summary omits athlete fumbles.':'Final exact-team fumblesLost=0; empty athlete fumble table is not the zero evidence.',
   sources:[log?._fixture.source??before.sources.find(source=>source.includes('/gamelog?')),summary._fixture.source],fantasyPoints:actualFantasyPoints(after,h.player.position,{sport:'nfl',settings:null,basis:'legacy_defaults'})});
}
capture.normalizationCorrections=corrections;
capture.correctionsVerifiedAt=corrections.map(row=>row.verifiedAt).sort().at(-1);
fs.writeFileSync(captureFile+'.tmp',JSON.stringify(capture,null,2)+'\n');
fs.renameSync(captureFile+'.tmp',captureFile);
console.log(JSON.stringify({databaseWrites:0,providerRequests:0,originalCaptureCutoff:capture.capturedAt,corrections},null,2));
