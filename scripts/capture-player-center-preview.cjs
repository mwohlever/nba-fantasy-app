/* eslint-disable @typescript-eslint/no-require-imports */
// Opt-in, bounded SELECT + public ESPN GET capture. No ingestion, RPC, refresh or writes to any database.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
if(process.argv[2]!=='--live'){console.log('node scripts/capture-player-center-preview.cjs --live (read-only; writes local preview JSON only)');process.exit(0);}
require('dotenv').config({path:'.env.local',quiet:true});
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename,load=Module._load;
Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args);};
Module._load=function(request,parent,...args){return request==='server-only'?{}:load.call(this,request,parent,...args);};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const {SupabaseCenterRepository}=require('../lib/player-center/repository.server.ts');
const {CenterEspnReader}=require('../lib/player-center/espn.ts');
const {professionalSeason}=require('../lib/player-center/types.ts');
(async()=>{
 const repository=new SupabaseCenterRepository(),reader=new CenterEspnReader(),capturedAt=new Date().toISOString(),histories=[];
 const nba=await repository.catalog('nba'),nfl=await repository.catalog('nfl');
 const find=(catalog,native)=>{const rows=catalog.players.filter(p=>p.nativePlayerId===native&&p.identity==='resolved');if(rows.length!==1)throw Error('Exact mapped identity not unique: '+native);return rows[0];};
 const lebron=find(nba,'2544');
 const targets=[[lebron,0],[lebron,-1],[find(nba,'201939'),0],[find(nfl,'3139477'),0],[find(nfl,'3055899'),0],[find(nfl,'100000012'),0],...['RB','WR'].map(position=>[nfl.players.find(p=>p.active&&p.position===position&&p.identity==='resolved'),0])];
 let total=0;
 for(const [player,offset]of targets){if(!player)throw Error('Mapped preview identity missing');const season=professionalSeason(player.sport)+offset;
 const history=await reader.history(player,season,'regular');total+=history.providerRequests;if(total>56)throw Error('Capture request limit');
 histories.push(history);console.log(JSON.stringify({sport:player.sport,id:player.playerId,name:player.name,season,games:history.games.length,requests:history.providerRequests,issues:history.coverage.issues}));}
 fs.mkdirSync(path.join(root,'data/player-center-preview'),{recursive:true});
 fs.writeFileSync(path.join(root,'data/player-center-preview/captured.json'),JSON.stringify({capturedAt,databaseWrites:0,providerRequests:total,identitySource:'Existing reviewed catalog rows, exact local/native/provider IDs; no candidate mappings applied',histories},null,2)+'\n');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
