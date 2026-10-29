/* eslint-disable @typescript-eslint/no-require-imports */
// Acquisition produces reviewed artifacts only. No mutation-capable client exists here.
const {hash,json,guard,assert,functionGuard}=require('./playerCenterRollout.cjs');
const FACTS=['local_player_id','season','phase','game_at','completed_at','team_provider_id','team_abbreviation','opponent_provider_id','opponent_abbreviation','home_away','minutes','points','rebounds','assists','steals','blocks','turnovers','normalization_version'];
const COLUMNS=['provider','provider_player_id','provider_event_id',...FACTS,'source_url','provider_fetched_at','provider_known_at','observation_hash'];
const tuple=(alias,fields=FACTS)=>`row(${fields.map(field=>`${alias}.${field}`).join(',')})`;
const keys=(a,b)=>`${a}.provider=${b}.provider and ${a}.provider_player_id=${b}.provider_player_id and ${a}.provider_event_id=${b}.provider_event_id`;
const cacheKeys=(a,b)=>`${a}.sport=${b}.sport and ${a}.provider=${b}.provider and ${a}.provider_player_id=${b}.provider_player_id and ${a}.season=${b}.season and ${a}.phase=${b}.phase`;

function buildBatch(plan,acquired,beforeCache=[]){
  const {normalizeCenterLog,normalizeCenterSeasonStats}=require('../../lib/player-center/espn.ts');
  const {normalizeEspnNbaGameLog}=require('../../lib/analytics/providers/espnNbaGameLog.ts');
  const {observationRecordFromNbaObservation}=require('../../lib/analytics/nba/projectionInfrastructure.ts');
  assert(acquired.length>0&&acquired.length<=25,'Expected 1–25 acquired athletes');
  assert(new Set(acquired.map(a=>a.playerId)).size===acquired.length,'Duplicate athlete in batch');
  assert(acquired.length===1||acquired.every(a=>a.asOf&&a.asOf===acquired[0].asOf),'Multi-player batches require a common comparison cutoff');
  const records=[],cache=[],review=[];
  for(const input of acquired){
    const identity=plan.universe.find(p=>p.playerId===input.playerId);
    assert(identity&&identity.providerPlayerId===input.providerPlayerId&&identity.nbaPlayerId===input.nbaPlayerId,'Acquisition identity mismatch');
    assert(Number.isFinite(Date.parse(input.fetchedAt))&&Number.isFinite(Date.parse(input.checkedAt))&&Date.parse(input.checkedAt)>=Date.parse(input.fetchedAt),'Invalid acquisition times');
    const asOf=input.asOf??input.fetchedAt;
    assert(Number.isFinite(Date.parse(asOf))&&Date.parse(asOf)<=Date.parse(input.fetchedAt),'Cutoff must precede acquisition');
    const request={sport:'nba',providerPlayerId:identity.providerPlayerId,season:2027,phase:'regular',fetchedAt:input.fetchedAt};
    const log=normalizeCenterLog(input.log,request),stats=normalizeCenterSeasonStats(input.stats,'nba',2027,'regular');
    assert(log.games.length<=110,'Provider game cap');
    assert(log.games.every(g=>g.providerPlayerId===identity.providerPlayerId&&g.season===2027&&g.phase==='regular'&&Date.parse(g.gameAt)>=Date.parse('2026-09-01T00:00:00Z')&&Date.parse(g.gameAt)<Date.parse('2027-09-01T00:00:00Z')),'Season/event boundary mismatch');
    const raw=Object.keys(input.log).every(key=>key==='filters')?{observations:[]}:normalizeEspnNbaGameLog(input.log,{espnPlayerId:identity.providerPlayerId,season:2027,fetchedAt:input.fetchedAt,knownAt:null});
    const accepted=raw.observations.filter(row=>row.phase==='regular'&&row.gameAt&&Date.parse(row.gameAt)<=Date.parse(asOf)).map(row=>observationRecordFromNbaObservation(row,identity.playerId)).filter(Boolean);
    records.push(...accepted);
    const past=log.games.filter(g=>Date.parse(g.gameAt)<=Date.parse(asOf));
    const observed=past.filter(g=>g.status==='final'&&g.participation==='played');
    const issues=[...log.issues,...stats.issues];
    if(stats.expectedGames===null)issues.push('independent_gp_unknown');
    if(stats.expectedGames!==null&&stats.expectedGames!==observed.length)issues.push(`gp_mismatch:${observed.length}/${stats.expectedGames}`);
    for(const g of past){
      if(g.status==='unknown'||g.status==='final'&&g.participation==='unknown')issues.push(`unverified_event:${g.eventId}`);
      if(g.issues.length)issues.push(`invalid_event:${g.eventId}`);
      if(g.status==='final'&&g.participation==='played'&&!accepted.some(r=>r.provider_event_id===g.eventId))issues.push(`incomplete_scoring_line:${g.eventId}`);
    }
    const row={sport:'nba',provider:'espn',provider_player_id:identity.providerPlayerId,season:2027,phase:'regular',nba_local_player_id:identity.playerId,nfl_local_player_id:null,
      as_of:asOf,checked_at:input.checkedAt,expected_games:stats.expectedGames,observed_games:observed.length,complete:issues.length===0,
      games:log.games,season_stats:stats,issues:[...new Set(issues)],content_hash:hash({identity,expectedGames:stats.expectedGames,games:log.games.map(g=>Object.fromEntries(Object.entries(g).filter(([key])=>key!=='fetchedAt'))),stats}),rollout_batch_id:''};
    cache.push(row);
    review.push({playerId:identity.playerId,nbaPlayerId:identity.nbaPlayerId,providerPlayerId:identity.providerPlayerId,expectedGames:stats.expectedGames,observedGames:observed.length,acceptedObservations:accepted.length,complete:row.complete,issues:row.issues});
  }
  assert(records.length<=1000,'Batch exceeds 1,000 observations; reduce athlete batch size');
  assert(new Set(records.map(r=>`${r.provider_player_id}:${r.provider_event_id}`)).size===records.length,'Duplicate/conflicting event in batch');
  assert(beforeCache.every(row=>cache.some(c=>c.provider_player_id===row.provider_player_id)&&row.sport==='nba'&&row.season===2027&&row.phase==='regular'),'Unexpected before-cache row');
  assert(beforeCache.every(row=>Date.parse(row.checked_at)<=Date.parse(cache.find(c=>c.provider_player_id===row.provider_player_id).checked_at)),'Before-cache snapshot is newer than acquisition');
  const batchId=`pc-nba2027-${hash({rollout:plan.rolloutId,records,cache,beforeCache}).slice(0,16)}`;
  cache.forEach(row=>{row.rollout_batch_id=batchId;});
  const body={batchId,mappingManifestSha256:plan.manifestSha256,season:2027,records,cache,beforeCache,review};
  return{...body,batchSha256:hash(body)};
}

function batchFiles(plan,batch){
  const stage=`create temp table _pc_obs on commit drop as select * from jsonb_populate_recordset(null::public.nba_player_game_observation_versions,${json(batch.records)});
create temp table _pc_cache on commit drop as select * from jsonb_populate_recordset(null::public.player_center_season_cache,${json(batch.cache)});
create temp table _pc_cache_before on commit drop as select * from jsonb_populate_recordset(null::public.player_center_season_cache,${json(batch.beforeCache)});
create temp table _pc_native on commit drop as select * from jsonb_to_recordset(${json(batch.review.map(r=>({local_id:r.playerId,native_id:r.nbaPlayerId})))}) as p(local_id bigint,native_id bigint);
`;
  const checks=`
  if (select count(*) from pg_trigger where tgrelid='public.nba_player_game_observation_versions'::regclass and not tgisinternal)<>2 or not exists(select 1 from pg_trigger where tgrelid='public.nba_player_game_observation_versions'::regclass and tgname='nba_observation_versions_sync_current' and tgenabled='O' and tgtype=5 and tgfoid='public.sync_nba_current_observation()'::regprocedure) or not exists(select 1 from pg_trigger where tgrelid='public.nba_player_game_observation_versions'::regclass and tgname='nba_observation_versions_immutable' and tgenabled='O' and tgtype=27 and tgfoid='public.reject_nba_projection_observation_version_mutation()'::regprocedure) then raise exception 'Unexpected NBA observation triggers'; end if;
  ${functionGuard('sync_nba_current_observation','20260925000200_nba_current_observations.sql')}
  ${functionGuard('reject_nba_projection_observation_version_mutation','20260925000100_nba_projection_observation_foundation.sql')}
  if exists(select 1 from pg_trigger where tgrelid='public.player_center_season_cache'::regclass and not tgisinternal) then raise exception 'Unexpected cache trigger'; end if;
  if (select count(*) from _pc_cache) not between 1 and 25 or (select count(*) from _pc_obs)>1000 or (select count(distinct as_of) from _pc_cache)<>1 then raise exception 'Invalid batch size/cutoff'; end if;
  if exists(select 1 from _pc_cache where sport<>'nba' or season<>2027 or phase<>'regular') or exists(select 1 from _pc_obs where season<>2027 or phase<>'regular' or local_player_id is null or game_at<'2026-09-01T00:00:00Z'::timestamptz or game_at>='2027-09-01T00:00:00Z'::timestamptz or game_at>provider_fetched_at) then raise exception 'Invalid season/identity boundary'; end if;
  if exists(select 1 from _pc_native n left join public.players p on p.id=n.local_id where p.nba_player_id is distinct from n.native_id or p.is_active is distinct from true) then raise exception 'Native catalog changed'; end if;
  if exists(select 1 from _pc_cache s left join public.nba_player_provider_identities i on i.provider=s.provider and i.provider_player_id=s.provider_player_id where i.resolution_status is distinct from 'resolved' or i.player_id is distinct from s.nba_local_player_id) then raise exception 'Reviewed mappings must be applied first'; end if;
  if exists(select 1 from _pc_obs s left join _pc_cache c on c.provider_player_id=s.provider_player_id and c.nba_local_player_id=s.local_player_id where c.provider_player_id is null) then raise exception 'Observation outside reviewed batch'; end if;
  if exists(select 1 from public.nba_player_game_current_observations c join _pc_obs s on ${keys('c','s')} where c.local_player_id is distinct from s.local_player_id or c.season<>2027 or (c.provider_fetched_at>s.provider_fetched_at and ${tuple('c')} is distinct from ${tuple('s')})) then raise exception 'Newer/conflicting current evidence exists'; end if;
`;
  const apply=`${guard('ingest',batch.batchSha256,plan.snapshotSha256)}lock table public.nba_player_game_observation_versions in share row exclusive mode;
lock table public.nba_player_game_current_observations in share row exclusive mode;
lock table public.player_center_season_cache in share row exclusive mode;
lock table public.nba_player_provider_identities in share mode;
lock table public.players in share mode;
\\ir 00-batch-inputs.sql
do $check$ begin ${checks}
  if exists(select 1 from public.player_center_season_cache a join _pc_cache s on ${cacheKeys('a','s')} left join _pc_cache_before b on ${cacheKeys('a','b')} where to_jsonb(a) is distinct from to_jsonb(s) and (b.provider_player_id is null or to_jsonb(a) is distinct from to_jsonb(b))) then raise exception 'Cache changed since reviewed before image'; end if;
  if exists(select 1 from _pc_cache_before b where not exists(select 1 from public.player_center_season_cache a where ${cacheKeys('a','b')})) then raise exception 'Before-cache row disappeared'; end if;
end $check$;
-- Back up the exact touched current state before any permanent insertion.
\\copy (select c.* from public.nba_player_game_current_observations c join _pc_obs s on c.provider=s.provider and c.provider_player_id=s.provider_player_id and c.provider_event_id=s.provider_event_id order by c.provider_player_id,c.provider_event_id) to 'nba-observations-before.csv' with(format csv,header true)
\\copy (select c.* from public.player_center_season_cache c join _pc_cache s on c.sport=s.sport and c.provider=s.provider and c.provider_player_id=s.provider_player_id and c.season=s.season and c.phase=s.phase order by c.provider_player_id) to 'season-cache-before.csv' with(format csv,header true)
create temp table _pc_expected_new(n bigint) on commit drop;
insert into _pc_expected_new select count(*) from _pc_obs s where not exists(select 1 from public.nba_player_game_current_observations c where ${keys('c','s')} and ${tuple('c')} is not distinct from ${tuple('s')});
create temp table _pc_inserted(id bigint) on commit drop;
with inserted as(
  insert into public.nba_player_game_observation_versions(${COLUMNS.join(',')})
  select ${COLUMNS.map(c=>`s.${c}`).join(',')} from _pc_obs s
  where not exists(select 1 from public.nba_player_game_current_observations c where ${keys('c','s')} and ${tuple('c')} is not distinct from ${tuple('s')})
  on conflict(provider,provider_player_id,provider_event_id,observation_hash) do nothing returning id
) insert into _pc_inserted select id from inserted;
-- Exact batch replay is a no-op. A new checked_at can refresh the cache without appending identical facts.
insert into public.player_center_season_cache select * from _pc_cache
on conflict(sport,provider,provider_player_id,season,phase) do update set
  nba_local_player_id=excluded.nba_local_player_id,nfl_local_player_id=excluded.nfl_local_player_id,as_of=excluded.as_of,checked_at=excluded.checked_at,expected_games=excluded.expected_games,observed_games=excluded.observed_games,complete=excluded.complete,games=excluded.games,season_stats=excluded.season_stats,issues=excluded.issues,content_hash=excluded.content_hash,rollout_batch_id=excluded.rollout_batch_id;
do $verify$ begin
  if (select count(*) from _pc_inserted)<>(select n from _pc_expected_new) then raise exception 'Observation insert assertion failed'; end if;
  if exists(select 1 from _pc_obs s left join public.nba_player_game_current_observations c on ${keys('c','s')} where c.version_id is null or ${tuple('c')} is distinct from ${tuple('s')}) then raise exception 'Current table/trigger verification failed'; end if;
  if exists(select 1 from _pc_cache s left join public.player_center_season_cache a on ${cacheKeys('a','s')} where to_jsonb(a) is distinct from to_jsonb(s)) then raise exception 'Cache verification failed'; end if;
end $verify$;
select (select count(*) from _pc_inserted) as appended_versions,(select count(*) from _pc_cache) as published_cache_rows;
commit;
`;
  const post=`\\set ON_ERROR_STOP on
begin;
\\ir 00-batch-inputs.sql
do $verify$ begin ${checks}
  if exists(select 1 from _pc_cache s left join public.player_center_season_cache a on ${cacheKeys('a','s')} where to_jsonb(a) is distinct from to_jsonb(s)) then raise exception 'Published cache changed or absent'; end if;
end $verify$;
\\copy (select c.* from public.player_center_season_cache c join _pc_cache s on c.sport=s.sport and c.provider=s.provider and c.provider_player_id=s.provider_player_id and c.season=s.season and c.phase=s.phase order by c.provider_player_id) to 'season-cache-after.csv' with(format csv,header true)
select provider_player_id,expected_games,observed_games,complete,checked_at,issues from _pc_cache order by provider_player_id;
commit;
`;
  const rollback=`${guard('rollback-cache',batch.batchSha256,plan.snapshotSha256)}lock table public.player_center_season_cache in share row exclusive mode;
\\ir 00-batch-inputs.sql
do $check$ begin
  if exists(select 1 from public.player_center_season_cache a join _pc_cache s on ${cacheKeys('a','s')} where to_jsonb(a) is distinct from to_jsonb(s)) then raise exception 'Cache changed after this batch; review the newer publication first'; end if;
end $check$;
delete from public.player_center_season_cache a using _pc_cache s where ${cacheKeys('a','s')} and to_jsonb(a)=to_jsonb(s);
do $verify$ begin
  if exists(select 1 from public.player_center_season_cache a join _pc_cache s on ${cacheKeys('a','s')}) then raise exception 'Cache withdrawal failed'; end if;
end $verify$;
-- Withdraw derived publication. Do not republish an older complete cache over newer facts.
-- Before images remain in the manifest/receipt for separately reviewed revalidation/restoration.
-- Immutable observation versions are retained. No trigger is disabled.
commit;
`;
  const files={'00-batch-inputs.sql':stage,'01-apply-batch.sql':apply,'02-postflight.sql':post,'03-rollback-cache-only.sql':rollback};
  return Object.fromEntries(Object.entries(files).map(([name,body])=>[name,body.split('\n').map(line=>line.trimEnd()).join('\n')]));
}
module.exports={buildBatch,batchFiles,FACTS};
