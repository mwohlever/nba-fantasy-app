/* eslint-disable @typescript-eslint/no-require-imports */
/* Read-only execution of the ACTUAL /lineups/draft server page with an isolated database/auth fixture. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'../..'),capture=require('../../data/player-center-preview/captured.json');
module.exports=async function(sport){
 const load=Module._load,resolve=Module._resolveFilename,extensions={...require.extensions},queries=[];
 const snapshot={sport,schemaVersion:1,draft:{type:'snake'},roster:{slots:sport==='nba'?[{position:'G',slotCount:2},{position:'F/C',slotCount:3}]:[{position:'QB',slotCount:1},{position:'RB',slotCount:2},{position:'WR',slotCount:2},{position:'TE',slotCount:1}]},scoring:{}};
 const slates=[{id:193,sport,league_id:sport+'-a',date:'2026-10-22',start_date:'2026-10-22',end_date:'2026-10-28',display_name:sport==='nfl'?'2026 Week 7':null,is_locked:false,archived_at:null,rules_snapshot:snapshot}];
 const pool=capture.histories.filter(h=>h.player.sport===sport&&h.season===(sport==='nba'?2027:2026));
 const tables={slates,players:pool.map(h=>({id:h.player.playerId,name:h.player.name,nba_player_id:Number(h.player.nativePlayerId),position_group:h.player.position,is_active:true})),players_nfl:pool.map(h=>({id:h.player.playerId,name:h.player.name,nfl_player_id:Number(h.player.nativePlayerId),position:h.player.position,is_active:true})),teams:[{id:1,name:'First team',user_id:'fixture-user',group_id:'a'},{id:2,name:'Second team',user_id:'second',group_id:'a'}],group_memberships:[{user_id:'fixture-user',group_id:'a',is_active:true},{user_id:'second',group_id:'a',is_active:true}],slate_teams:[{slate_id:193,team_id:1,draft_order:1,is_participating:true},{slate_id:193,team_id:2,draft_order:2,is_participating:true}]};
 const Builder=()=>null;
 const db={from(table){const filters=[];let page;const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q;},is:(key,value)=>{filters.push([key,value]);return q;},order:()=>q,range:(from,to)=>{page=[from,to];return q;},then(ok,no){queries.push({table,filters});return Promise.resolve({data:(tables[table]??[]).filter(row=>filters.every(([key,value])=>row[key]===value)).slice(page?.[0]??0,page?page[1]+1:undefined),error:null}).then(ok,no);},insert(){throw Error('WRITE FORBIDDEN');},update(){throw Error('WRITE FORBIDDEN');},delete(){throw Error('WRITE FORBIDDEN');}};return q;}};
 try{
 Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args);};
 for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:file}).outputText,file);
 Module._load=function(request,parent,...args){if([path.join(root,'app/lineups/draft/page.tsx'),path.join(root,'lib/nfl/playerCatalog.server.ts')].includes(parent?.filename)){
  if(request==='@/lib/supabaseAdmin')return{supabaseAdmin:db};
  if(request==='@/lib/auth')return{getCurrentUser:async()=>({id:'fixture-user',teamId:1,role:'admin'})};
  if(request==='@/lib/groups/context')return{getActiveLeagueForSport:async()=>({context:{group:{id:'a'}},league:{id:sport+'-a'}})};
  if(request==='next/navigation')return{redirect:()=>{throw Error('Unexpected redirect');}};
  if(request==='@/components/lineups/LineupBuilder')return{__esModule:true,default:Builder};
  if(request.startsWith('@/components/'))return{__esModule:true,default:()=>null};
 }return load.call(this,request,parent,...args);};
 const file=path.join(root,'app/lineups/draft/page.tsx');delete require.cache[file];delete require.cache[path.join(root,'lib/nfl/playerCatalog.server.ts')];const Page=require(file).default;
 const tree=await Page({searchParams:Promise.resolve({sport,slateId:'193'})});
 function find(node){if(!node||typeof node!=='object')return null;if(Array.isArray(node))return node.map(find).find(Boolean);if(node.type===Builder)return node.props;return find(node.props?.children);}
 const props=find(tree);if(!props)throw Error('Actual draft page did not provide LineupBuilder');return{props,queries,snapshot,pool};
 }finally{Module._load=load;Module._resolveFilename=resolve;for(const ext of ['.ts','.tsx'])if(extensions[ext])require.extensions[ext]=extensions[ext];else delete require.extensions[ext];}
};
