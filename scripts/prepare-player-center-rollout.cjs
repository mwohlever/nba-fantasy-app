/* eslint-disable @typescript-eslint/no-require-imports */
// SELECTs and public GETs only. There is deliberately no apply/execute mode.
const fs=require('node:fs'),path=require('node:path');
const {mappingPlan,mappingFiles,hash,assert}=require('./lib/playerCenterRollout.cjs');
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
async function snapshot({season=require('./lib/nbaObservationSeason.cjs').resolveNbaObservationSeason()}={}) {
  assert(Number.isInteger(season)&&season>=2000&&season<=2100,'Explicit NBA ending year required');
  require('dotenv').config({path:'.env.local',quiet:true});
  const {createClient}=require('@supabase/supabase-js');
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const nativeSource=`https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=${season-1}-${String(season).slice(-2)}`;
  let requests=0;
  const get=async url=>{
    assert(++requests<=32,'Provider request cap exceeded');
    const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0',Origin:'https://www.nba.com',Referer:'https://www.nba.com/'},signal:AbortSignal.timeout(15000)});
    assert(r.ok,`Provider HTTP ${r.status}`);return r.json();
  };
  const [p,i,count,n,t]=await Promise.all([
    db.from('players').select('id,name,nba_player_id,team_abbreviation,is_active').order('id').range(0,999),
    db.from('nba_player_provider_identities').select('*').order('provider_player_id').range(0,999),
    db.from('nba_player_game_current_observations').select('provider_event_id',{count:'exact',head:true}).eq('season',season),
    get(nativeSource),get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=50'),
  ]);
  for(const result of[p,i,count])if(result.error)throw Error(result.error.message);
  assert(p.data.length<1000&&i.data.length<1000,'Catalog cap reached; do not truncate');
  const set=n.resultSets?.find(row=>row.name==='CommonAllPlayers');
  assert(set?.headers.includes('PERSON_ID')&&Array.isArray(set.rowSet),'Invalid native roster');
  const native=set.rowSet.map(row=>{const field=key=>row[set.headers.indexOf(key)];return{nbaPlayerId:Number(field('PERSON_ID')),name:String(field('DISPLAY_FIRST_LAST')),team:String(field('TEAM_ABBREVIATION')??''),rostered:Number(field('ROSTERSTATUS'))===1};});
  const teams=t.sports?.[0]?.leagues?.[0]?.teams;assert(teams?.length===30,'Expected 30 ESPN teams');const espn=[];
  for(let offset=0;offset<30;offset+=3){
    const group=await Promise.all(teams.slice(offset,offset+3).map(async({team})=>{
      assert(/^\d+$/.test(String(team.id)),'Invalid team identity');
      const source=`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}/roster`,r=await get(source);
      assert(String(r.team?.id)===String(team.id)&&Array.isArray(r.athletes),'Roster identity mismatch');
      return r.athletes.map(a=>({espnPlayerId:String(a.id),name:a.displayName??a.fullName,team:team.abbreviation,source}));
    }));espn.push(...group.flat());
  }
  return{readAt:new Date().toISOString(),databaseWrites:0,providerRequests:requests,season,players:p.data,identities:i.data,currentSeasonObservations:count.count,nativeSource,native,espn};
}
async function main(){
  if(!args.includes('--out')||(!args.includes('--read-only-refresh')&&!args.includes('--offline'))){console.log('Usage: node scripts/prepare-player-center-rollout.cjs (--read-only-refresh | --offline SNAPSHOT.json) --out NEW_DIRECTORY');return;}
  const out=option('--out');assert(out&&!out.startsWith('--'),'Output directory required');assert(!fs.existsSync(out),'Refusing to overwrite a review bundle');
  const before=args.includes('--read-only-refresh')?await snapshot(args.includes('--season')?{season:Number(option('--season'))}:{}):JSON.parse(fs.readFileSync(option('--offline'),'utf8'));
  if(args.includes('--snapshot-only')) {
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'review-snapshot.json'),JSON.stringify(before,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({out,databaseWrites:0,mode:'fresh-evidence-only',next:'Run review-nba-refresh-identities.cjs; no mappings are applied'}));return;
  }
  const audit=JSON.parse(fs.readFileSync('data/player-center/nba-identity-audit.json','utf8')),plan=mappingPlan(audit,before);
  const files={'review-snapshot.json':JSON.stringify(before,null,2)+'\n','mapping-manifest.json':JSON.stringify(plan,null,2)+'\n','unresolved-players.json':JSON.stringify(plan.unresolved,null,2)+'\n',...mappingFiles(plan,before)};
  fs.mkdirSync(out,{recursive:true});for(const[name,body]of Object.entries(files))fs.writeFileSync(path.join(out,name),body,{flag:'wx'});
  fs.writeFileSync(path.join(out,'SHA256SUMS'),Object.keys(files).sort().map(name=>`${hash(files[name])}  ${name}`).join('\n')+'\n',{flag:'wx'});
  console.log(JSON.stringify({out,rolloutId:plan.rolloutId,reviewed:plan.targets.length,before:plan.expectedBefore,after:plan.expectedAfter,unresolved:plan.unresolved.length,manifestSha256:plan.manifestSha256,databaseWrites:0},null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={snapshot};
