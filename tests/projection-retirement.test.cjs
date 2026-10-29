/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const originalLoad=Module._load,calls=[];
Module._load=function(request,parent,...args){
 if(request==='server-only')return{};
 if(parent?.filename.includes('/app/api/internal/')){
  if(request.endsWith('projectionRepository.server'))return{loadActiveResolvedNbaProviderPlayerIds:async()=>{calls.push('eligible');return['1966'];},loadNbaProviderIdentities:async()=>[],upsertNbaProjectionObservations:async()=>{calls.push('facts');}};
  if(request.endsWith('projectionIngestion.server'))return{persistNbaProjectionObservations:async()=>{calls.push('facts');return{inserted:1};}};
  if(request.endsWith('projectionRefresh.server'))return{refreshNbaProjectionBatch:async()=>{calls.push('refresh-facts');return{generated:0};}};
  if(request.endsWith('observationRepository.server'))return{loadActiveNflObservationPlayers:async()=>{calls.push('eligible');return[];},auditNflObservationSeason:async()=>({season:2026}),existingNflObservationHashes:async()=>new Set(),insertNflObservationVersions:async()=>{calls.push('facts');}};
  if(request.endsWith('observationPersistence.server'))return{persistNflObservationBatch:async()=>{calls.push('facts');return{inserted:1};}};
 }
 return originalLoad.call(this,request,parent,...args);
};
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('all projection-only HTTP entry points are retired without database/provider access',async()=>{
 for(const route of ['draft-projections','player-projections','admin/nba/projection-shadow','admin/nfl/projection-shadow']){
  const {GET}=require(`../app/api/${route}/route.ts`),response=await GET();assert.equal(response.status,410);assert.equal((await response.json()).retired,true);assert.doesNotMatch(read(`app/api/${route}/route.ts`),/supabase|fetch\(/);
 }
});
test('NBA legacy ingestion is retired; NFL retains authorized facts while both reject generation',async()=>{
 for(const sport of ['nba','nfl']){
  process.env[`${sport.toUpperCase()}_PROJECTION_INGEST_SECRET`]='isolated-secret';
  const {POST}=require(`../app/api/internal/${sport}/projection-ingest/route.ts`);
  const req=(body,auth=true)=>new Request('http://isolated.test',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer isolated-secret'}:{})},body:JSON.stringify(body)});
  calls.length=0;assert.equal((await POST(req({action:'generate',season:2026}))).status,410);assert.deepEqual(calls,[]);
  assert.equal((await POST(req({action:'eligible'},false))).status,401);assert.deepEqual(calls,[]);
  if(sport==='nba'){assert.equal((await POST(req({action:'eligible'}))).status,410);assert.deepEqual(calls,[]);continue;}
  assert.equal((await POST(req({action:'eligible'}))).status,200);assert.ok(calls.includes('eligible'));
  calls.length=0;const response=await POST(req({action:'observations',season:2026,observations:[{}],generate:false}));assert.equal(response.status,200);assert.ok(calls.includes('facts'));
 }
});
test('retired generation and forecast lookup functions cannot read history, cache or provider data',async()=>{
 const repo={loadHistories:()=>{throw Error('UNEXPECTED READ');},upsertStatCache:()=>{throw Error('UNEXPECTED WRITE');},appendStatCache:()=>{throw Error('UNEXPECTED WRITE');}};
 for(const sport of ['nba','nfl']){const generatedModule=require(`../lib/analytics/${sport}/projectionGeneration.server.ts`),generate=generatedModule[sport==='nba'?'generateNbaProjectionStatCache':'generateNflProjectionStatCache'];await assert.rejects(generate({repository:repo,players:[],playerIds:[],season:2026,asOf:'2026-10-26T00:00:00Z'}),/retired/);}
 const legacy=require('../lib/playerProjections.ts');await assert.rejects(legacy.getPlayerProjectionsForSeason('2026'),/retired/);await assert.rejects(legacy.getPlayerProjectionMapForSeason('2026'),/retired/);
 await assert.rejects(require('../lib/lineups/draftProjections.server.ts').getDraftProjectionsForSlate({sport:'nba'}),/retired/);
});
test('legacy NBA worker is inert and cannot bypass atomic Player Center publication',()=>{
 let requests=0;const processStub={env:{}};
 vm.runInNewContext(read('scripts/run-nba-projection-shadow-refresh.cjs'),{process:processStub,console:{error(){}},fetch:()=>{requests++;}});
 assert.equal(requests,0);assert.equal(processStub.exitCode,1);
 assert.doesNotMatch(read('scripts/run-nba-player-center-refresh.cjs'),/action:\s*['"]generate['"]/);
});
test('forecast-only jobs are inert; NBA factual launch is manual-only and NFL/live scoring remain intact',()=>{
 const generation=read('.github/workflows/nfl-projection-shadow-generate.yml');assert.match(generation,/if: \$\{\{ false \}\}/);assert.doesNotMatch(generation,/run-nfl-projection-generation|schedule:/);
 let requests=0;const processStub={env:{}};vm.runInNewContext(read('scripts/run-nfl-projection-generation.cjs'),{process:processStub,console:{error(){}},fetch:()=>{requests++;}});assert.equal(requests,0);assert.equal(processStub.exitCode,1);
 assert.doesNotMatch(read('.github/workflows/nba-projection-shadow-refresh.yml'),/^  schedule:/m);
 assert.match(read('.github/workflows/nba-projection-shadow-refresh.yml'),/run-nba-player-center-refresh/);
 assert.match(read('.github/workflows/nfl-projection-observation-refresh.yml'),/schedule:/);
 for(const sport of ['nba','nfl']){assert.ok(read(`app/api/cron/refresh-${sport}/route.ts`).length>100);assert.doesNotMatch(read(`app/api/cron/refresh-${sport}/route.ts`),/status: 410/);}
 assert.match(read('scripts/run-nfl-projection-observation-refresh.cjs'),/action:'observations'/);assert.doesNotMatch(read('scripts/run-nfl-projection-observation-refresh.cjs'),/action:'generate'/);
});
test('runtime score/home/draft experiences have no forecast requests, generated totals, or win-probability math',()=>{
 const builder=read('components/lineups/LineupBuilder.tsx'),scores=read('components/lineups/ScoresDashboard.tsx'),home=read('app/api/home-summary/route.ts'),history=read('app/player-history/page.tsx');
 for(const source of [builder,scores,home,history])assert.doesNotMatch(source,/fetch\([^\n]*\/api\/(?:draft|player)-projections|getLiveProjectedTeamTotal|Math\.exp\(|win_probability/);
 assert.doesNotMatch(scores,/Projected final|Pregame projection|win probability/);assert.match(scores,/Team totals/);assert.match(builder,/getTeamStats/);assert.match(home,/const latestSlateRows = latestSlateRowsBase/);
 assert.match(read('lib/lineups/draftHistory.server.ts'),/projection: null/);assert.doesNotMatch(read('app/api/lineups/route.ts'),/getPlayerProjectionsForSeason/);
});
