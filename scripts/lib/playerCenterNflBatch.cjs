/* eslint-disable @typescript-eslint/no-require-imports */
// Cache-only NFL preparation. No database client, SQL executor, or projection ingestion.
const {hash,quote,json,assert,guard}=require('./playerCenterRollout.cjs');
async function acquireNflHistory(reader,player,season){
 let history;
 for(let pass=0;pass<3;pass++){history=await reader.history(player,season,'regular');assert(history.coverage.freshness!=='unavailable','Provider acquisition failed: no review bundle published');if(!history.coverage.issues.includes('summary_coverage_budget_limited'))break;}
 return history;
}
function buildNflBatch(targets,histories,{season,asOf,checkedAt,beforeCache=[]}){
 const {actualFantasyPoints}=require('../../lib/player-center/comparison.ts');
 const {decodeSeasonCache}=require('../../lib/player-center/durableCache.ts');
 assert(targets.length>0&&targets.length<=5&&histories.length===targets.length,'Expected 1–5 exact NFL targets');
 assert(new Set(targets.map(p=>p.playerId)).size===targets.length&&new Set(targets.map(p=>p.providerPlayerId)).size===targets.length,'Duplicate target identity');
 assert(Number.isInteger(season)&&season>=2000&&season<=new Date(checkedAt).getUTCFullYear(),'Explicit NFL starting season required');
 assert(Number.isFinite(Date.parse(asOf))&&Number.isFinite(Date.parse(checkedAt))&&Date.parse(asOf)<=Date.parse(checkedAt),'Invalid acquisition cutoff/check time');
 const cache=targets.map(target=>{
  const h=histories.find(h=>h.player.playerId===target.playerId);
  assert(h&&h.player.sport==='nfl'&&h.player.identity==='resolved'&&h.player.providerPlayerId===target.providerPlayerId&&h.player.nativePlayerId===target.providerPlayerId&&h.player.position===target.position&&h.player.active===true&&h.season===season&&h.phase==='regular','Exact NFL identity/season mismatch');
  const past=h.games.filter(g=>Date.parse(g.gameAt)<=Date.parse(asOf)),played=past.filter(g=>g.status==='final'&&g.participation==='played');
  const issues=[...h.coverage.issues];
  if(h.games.some(g=>Date.parse(g.gameAt)>Date.parse(asOf)&&Date.parse(g.gameAt)<=Date.parse(checkedAt)))issues.push('event_since_common_cutoff');
  if(h.coverage.freshness!=='fresh')issues.push('provider_acquisition_incomplete');
  if(h.coverage.expectedGames===null||h.coverage.expectedGames!==played.length)issues.push('independent_gp_unknown_or_mismatch');
  if(past.some(g=>g.status!=='final'||g.participation==='unknown'||g.issues.length))issues.push('unverified_past_event');
  const kicking=['field_goals_made','field_goals_attempted','extra_points_made','extra_points_attempted','kicking_points'];
  if(played.some(g=>target.position==='K'?kicking.some(k=>g.stats[k]===null||g.stats[k]===undefined):actualFantasyPoints(g,target.position,{sport:'nfl',settings:null,basis:'legacy_defaults'})===null))issues.push('incomplete_position_statistics');
  const stats=h.seasonStats?structuredClone(h.seasonStats):{season,phase:'regular',expectedGames:null,categories:[],issues:['season_statistics_unavailable']};
  if(h.byeWeeks!==null&&target.position==='D/ST')stats.byeWeeks=[...h.byeWeeks];
  const row={sport:'nfl',provider:'espn',provider_player_id:target.providerPlayerId,season,phase:'regular',nba_local_player_id:null,nfl_local_player_id:target.playerId,
   as_of:asOf,checked_at:checkedAt,expected_games:h.coverage.expectedGames,observed_games:played.length,complete:issues.length===0,games:structuredClone(h.games),season_stats:stats,issues:[...new Set(issues)],content_hash:hash({target,asOf,games:h.games,stats}),rollout_batch_id:'pending'};
  decodeSeasonCache(row,h.player,season,Date.parse(checkedAt));return row;
 });
 assert(beforeCache.every(row=>row.sport==='nfl'&&row.season===season&&row.phase==='regular'&&cache.some(c=>c.provider_player_id===row.provider_player_id)&&Date.parse(row.checked_at)<=Date.parse(checkedAt)&&Date.parse(row.as_of)<=Date.parse(asOf)),'Unexpected/newer before-cache row');
 const batchId=`pc-nfl${season}-${hash({targets,cache,beforeCache}).slice(0,16)}`;cache.forEach(row=>row.rollout_batch_id=batchId);
 const body={batchId,season,asOf,checkedAt,targets,cache,beforeCache,backupReceiptSha256:hash({targets,beforeCache}),providerRequests:histories.reduce((n,h)=>n+h.providerRequests,0)};
 return{...body,batchSha256:hash(body)};
}
function nflBatchFiles(batch){
 const keys=(a,b)=>`${a}.sport=${b}.sport and ${a}.provider=${b}.provider and ${a}.provider_player_id=${b}.provider_player_id and ${a}.season=${b}.season and ${a}.phase=${b}.phase`;
 const stage=`create temp table _pc_cache on commit drop as select * from jsonb_populate_recordset(null::public.player_center_season_cache,${json(batch.cache)});
create temp table _pc_before on commit drop as select * from jsonb_populate_recordset(null::public.player_center_season_cache,${json(batch.beforeCache)});
create temp table _pc_targets on commit drop as select * from jsonb_to_recordset(${json(batch.targets)}) as p("playerId" bigint,"providerPlayerId" text,position text);
`;
 const checks=`if (select count(*) from _pc_cache) not between 1 and 5 or (select count(*) from _pc_targets)<>(select count(*) from _pc_cache) then raise exception 'Invalid NFL batch count'; end if;
if exists(select 1 from pg_trigger where tgrelid='public.player_center_season_cache'::regclass and not tgisinternal) then raise exception 'Unexpected cache trigger'; end if;
if exists(select 1 from _pc_cache where sport<>'nfl' or season<>${batch.season} or phase<>'regular' or as_of<>${quote(batch.asOf)}::timestamptz) then raise exception 'Invalid season/cutoff'; end if;
if exists(select 1 from _pc_targets t left join public.players_nfl p on p.id=t."playerId" where p.nfl_player_id::text is distinct from t."providerPlayerId" or p.position is distinct from t.position or p.is_active is distinct from true) then raise exception 'NFL catalog identity drift'; end if;
if exists(select 1 from _pc_cache c left join _pc_targets t on c.nfl_local_player_id=t."playerId" and c.provider_player_id=t."providerPlayerId" where t."playerId" is null) then raise exception 'Unexpected cache target'; end if;`;
 const pre=`\\set ON_ERROR_STOP on
begin isolation level repeatable read read only;
-- NEW EMPTY receipt directory. Save these before approving the matching batch.
\\copy (select * from public.players_nfl order by id) to 'nfl-catalog-before.csv' with(format csv,header true)
\\copy (select * from public.player_center_season_cache where sport='nfl' and season=${batch.season} order by provider_player_id) to 'nfl-cache-before.csv' with(format csv,header true)
commit;
`;
 const apply=`${guard('ingest-cache',batch.batchSha256,batch.backupReceiptSha256)}lock table public.player_center_season_cache in share row exclusive mode;
lock table public.players_nfl in share mode;
\\ir 00-cache-inputs.sql
do $check$ begin ${checks}
if exists(select 1 from public.player_center_season_cache a join _pc_cache s on ${keys('a','s')} left join _pc_before b on ${keys('a','b')} where to_jsonb(a) is distinct from to_jsonb(s) and (b.provider_player_id is null or to_jsonb(a) is distinct from to_jsonb(b))) or exists(select 1 from _pc_before b where not exists(select 1 from public.player_center_season_cache a where ${keys('a','b')})) then raise exception 'Before-cache drift'; end if;
end $check$;
insert into public.player_center_season_cache select * from _pc_cache
on conflict(sport,provider,provider_player_id,season,phase) do update set nfl_local_player_id=excluded.nfl_local_player_id,as_of=excluded.as_of,checked_at=excluded.checked_at,expected_games=excluded.expected_games,observed_games=excluded.observed_games,complete=excluded.complete,games=excluded.games,season_stats=excluded.season_stats,issues=excluded.issues,content_hash=excluded.content_hash,rollout_batch_id=excluded.rollout_batch_id;
do $verify$ begin if exists(select 1 from _pc_cache s left join public.player_center_season_cache a on ${keys('a','s')} where to_jsonb(a) is distinct from to_jsonb(s)) then raise exception 'Cache publication assertion'; end if; end $verify$;
commit;
`;
 const post=`\\set ON_ERROR_STOP on
begin;
\\ir 00-cache-inputs.sql
do $verify$ begin ${checks}
if exists(select 1 from _pc_cache s left join public.player_center_season_cache a on ${keys('a','s')} where to_jsonb(a) is distinct from to_jsonb(s)) then raise exception 'Postflight cache drift'; end if; end $verify$;
\\copy (select a.* from public.player_center_season_cache a join _pc_cache s on a.sport=s.sport and a.provider_player_id=s.provider_player_id and a.season=s.season order by a.provider_player_id) to 'nfl-cache-after.csv' with(format csv,header true)
select provider_player_id,observed_games,expected_games,complete,as_of,checked_at,issues from _pc_cache;
commit;
`;
 const rollback=`${guard('rollback-cache',batch.batchSha256,batch.backupReceiptSha256)}lock table public.player_center_season_cache in share row exclusive mode;
\\ir 00-cache-inputs.sql
do $check$ begin if exists(select 1 from public.player_center_season_cache a join _pc_cache s on ${keys('a','s')} where to_jsonb(a) is distinct from to_jsonb(s)) then raise exception 'Newer cache publication exists'; end if; end $check$;
delete from public.player_center_season_cache a using _pc_cache s where ${keys('a','s')} and to_jsonb(a)=to_jsonb(s);
do $verify$ begin if exists(select 1 from public.player_center_season_cache a join _pc_cache s on ${keys('a','s')}) then raise exception 'Cache withdrawal assertion'; end if; end $verify$;
-- Cache withdrawal only. No research history, fantasy results, or old complete cache restoration.
commit;
`;
 return{'00-cache-inputs.sql':stage,'01-preflight-backup.sql':pre,'02-apply-cache.sql':apply,'03-postflight.sql':post,'04-rollback-cache.sql':rollback};
}
module.exports={buildNflBatch,nflBatchFiles,acquireNflHistory};
