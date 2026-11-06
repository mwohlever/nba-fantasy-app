/* eslint-disable @typescript-eslint/no-require-imports */
// Offline builders only. This module has no database connection or SQL executor.
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const normalizeName = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeTeam = value => ({ GS:'GSW',NO:'NOP',NY:'NYK',SA:'SAS',UTAH:'UTA',WSH:'WAS' })[value] ?? value;
const fail = message => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const business = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['created_at','updated_at'].includes(key)));
const playerBefore = row => ({ id:row.id,name:row.name,nba_player_id:row.nba_player_id,team_abbreviation:row.team_abbreviation,is_active:row.is_active });
function functionGuard(name,file){
  const fs=require('node:fs'),path=require('node:path'),source=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations',file),'utf8');
  const pattern=new RegExp(`create(?: or replace)? function public\\.${name}\\(\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,'i'),match=source.match(pattern);
  assert(match,`Missing reviewed function source: ${name}`);
  return `if (select btrim(regexp_replace(prosrc,'[[:space:]]+',' ','g')) from pg_proc where oid='public.${name}()'::regprocedure) is distinct from ${quote(match[1].replace(/\s+/g,' ').trim())} then raise exception 'Unexpected function body: ${name}'; end if;`;
}
function registerTypescript(){
  const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
  const root=path.resolve(__dirname,'../..'),resolve=Module._resolveFilename;
  Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args);};
  require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
}

function mappingPlan(audit, snapshot) {
  assert(snapshot.identities.length === 367 && snapshot.players.filter(p => p.is_active).length === 530, 'Baseline changed: re-review instead of widening the rollout');
  assert(snapshot.identities.every(i => i.provider === 'espn' && i.resolution_status === 'resolved'), 'Unreviewed baseline identity state');
  const candidates = audit.gaps.filter(row => row.candidate).sort((a,b) => a.playerId-b.playerId);
  assert(candidates.length === 98 && audit.gaps.length === 163, 'Expected the reviewed 98/65 split');
  for (const key of ['playerId','nbaPlayerId']) assert(new Set(candidates.map(c=>c[key])).size === 98, `Duplicate ${key}`);
  assert(new Set(candidates.map(c=>c.candidate.providerPlayerId)).size === 98, 'Duplicate ESPN ID');
  const seed = hash({ audit, snapshot });
  const rolloutId = `pc-nba-20261023-${seed.slice(0,12)}`;
  const targets = candidates.map(candidate => {
    const local = snapshot.players.filter(p=>p.id===candidate.playerId), native = snapshot.native.filter(p=>p.nbaPlayerId===candidate.nbaPlayerId);
    const espn = snapshot.espn.filter(p=>p.espnPlayerId===candidate.candidate.providerPlayerId);
    assert(local.length===1 && native.length===1 && espn.length===1, `Missing/ambiguous provider evidence for ${candidate.playerId}`);
    const [p]=local,[n]=native,[e]=espn;
    assert(p.is_active && p.name===candidate.name && p.nba_player_id===candidate.nbaPlayerId && n.rostered, `Local/native drift for ${p.id}`);
    assert(snapshot.players.filter(other=>other.nba_player_id===p.nba_player_id).length===1, `Native ID collision for ${p.id}`);
    assert(normalizeName(p.name)===normalizeName(n.name) && normalizeName(n.name)===normalizeName(e.name), `Name discrepancy requires independent review: ${p.id}`);
    assert(snapshot.native.filter(other=>normalizeName(other.name)===normalizeName(n.name)).length===1 && snapshot.espn.filter(other=>normalizeName(other.name)===normalizeName(e.name)).length===1, `Ambiguous normalized identity: ${p.id}`);
    assert(normalizeTeam(n.team) && normalizeTeam(n.team)===normalizeTeam(e.team), `Current provider teams disagree for ${p.id}`);
    assert(!snapshot.identities.some(i=>i.player_id===p.id || i.provider_player_id===e.espnPlayerId), `Existing identity conflict for ${p.id}`);
    assert(e.source.startsWith('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/') && snapshot.nativeSource===candidate.candidate.sources[0] && e.source===candidate.candidate.sources[1], `Source drift for ${p.id}`);
    return { localBefore:playerBefore(p), localAfter:playerBefore(p), identityBefore:null,
      evidence:{ native:n,espn:e,verifiedAt:snapshot.readAt,nativeSource:snapshot.nativeSource },
      identityAfter:{ provider:'espn',provider_player_id:e.espnPlayerId,player_id:p.id,provider_name:e.name,
        resolution_status:'resolved',resolution_method:'reviewed_provider_evidence',
        evidence:`${rolloutId}; native NBA ID ${p.nba_player_id}; unique native/ESPN names and current team ${normalizeTeam(n.team)} agree; reviewed ${snapshot.readAt}; ${snapshot.nativeSource}; ${e.source}`,
        is_locked:true } };
  });
  const unresolved = audit.gaps.filter(row=>!row.candidate).map(row=>({ playerId:row.playerId,name:row.name,nbaPlayerId:row.nbaPlayerId,reason:row.category }));
  assert(unresolved.length===65 && unresolved.every(row=>!snapshot.identities.some(i=>i.player_id===row.playerId)), 'Unresolved cohort changed');
  const universe = [...snapshot.identities.map(identity=>{
    const p=snapshot.players.find(player=>player.id===identity.player_id);
    assert(p?.is_active, 'Mapped active cohort changed');
    return { playerId:p.id,nbaPlayerId:p.nba_player_id,providerPlayerId:identity.provider_player_id,name:p.name };
  }),...targets.map(t=>({playerId:t.localBefore.id,nbaPlayerId:t.localBefore.nba_player_id,providerPlayerId:t.identityAfter.provider_player_id,name:t.localBefore.name}))].sort((a,b)=>a.playerId-b.playerId);
  const plan={ rolloutId,season:2027,generatedFrom:snapshot.readAt,snapshotSha256:hash(JSON.stringify(snapshot,null,2)+'\n'),
    expectedBefore:367,expectedAfter:465,targets,unresolved,universe };
  return {...plan,manifestSha256:hash(plan)};
}

function guard(action, token, backup) {
  return `\\set ON_ERROR_STOP on
-- REVIEW ONLY. Requires separate production approval. No script in this bundle executes SQL.
begin;
set local search_path=pg_catalog,pg_temp,public;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$ begin
  if current_setting('sports111.rollout_approval',true) is distinct from ${quote(`${action}:${token}`)} then
    raise exception 'Missing exact reviewed operation approval';
  end if;
  if current_setting('sports111.backup_receipt',true) is distinct from ${quote(backup)} then
    raise exception 'Missing reviewed backup receipt';
  end if;
end $guard$;
`;
}
function mappingStage(plan,snapshot) {
  return `-- Shared temporary inputs. Include only inside an explicit transaction.
create temp table _pc_base on commit drop as select * from jsonb_populate_recordset(null::public.nba_player_provider_identities,${json(snapshot.identities)});
create temp table _pc_targets on commit drop as select * from jsonb_populate_recordset(null::public.nba_player_provider_identities,${json(plan.targets.map(t=>t.identityAfter))});
create temp table _pc_players on commit drop as select * from jsonb_to_recordset(${json(snapshot.players.map(playerBefore))}) as p(id bigint,name text,nba_player_id bigint,team_abbreviation text,is_active boolean);
create temp table _pc_unresolved(player_id bigint primary key) on commit drop;
insert into _pc_unresolved values ${plan.unresolved.map(row=>`(${row.playerId})`).join(',')};
`;
}
const mappingChecks = `
  if (select count(*) from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and not tgisinternal)<>1 or not exists(select 1 from pg_trigger where tgrelid='public.nba_player_provider_identities'::regclass and tgname='nba_provider_identity_updated_at' and tgenabled='O' and tgtype=19 and tgfoid='public.set_nba_projection_updated_at()'::regprocedure) then raise exception 'Unexpected identity triggers'; end if;
  ${functionGuard('set_nba_projection_updated_at','20260925000100_nba_projection_observation_foundation.sql')}
  if (select count(*) from _pc_targets)<>98 or (select count(distinct provider_player_id) from _pc_targets)<>98 or (select count(distinct player_id) from _pc_targets)<>98 then raise exception 'Invalid target set'; end if;
  if exists ((select * from _pc_players except select id,name,nba_player_id,team_abbreviation,is_active from public.players) union all (select id,name,nba_player_id,team_abbreviation,is_active from public.players except select * from _pc_players)) then raise exception 'Player catalog drift: re-review'; end if;
  if exists ((select * from _pc_base except select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id)) union all (select a.* from public.nba_player_provider_identities a where not exists(select 1 from _pc_targets t where t.provider=a.provider and t.provider_player_id=a.provider_player_id) except select * from _pc_base)) then raise exception 'Baseline identity drift: re-review'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id) where (to_jsonb(a)-'created_at'-'updated_at') is distinct from (to_jsonb(t)-'created_at'-'updated_at')) then raise exception 'Target ID claimed or changed'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_targets t on a.player_id=t.player_id where a.provider_player_id<>t.provider_player_id or a.provider<>'espn') then raise exception 'Local player already mapped elsewhere'; end if;
  if exists (select 1 from public.nba_player_provider_identities a join _pc_unresolved u on u.player_id=a.player_id) then raise exception 'Unresolved cohort changed'; end if;
`;
function mappingFiles(plan,snapshot) {
  const input=plan.targets.map(t=>({player_id:t.localBefore.id,nba_player_id:t.localBefore.nba_player_id,provider_player_id:t.identityAfter.provider_player_id}));
  const header=guard('apply',plan.manifestSha256,plan.snapshotSha256);
  const apply=`${header}lock table public.nba_player_provider_identities in share row exclusive mode;
lock table public.players in share mode;
\\ir 00-mapping-inputs.sql
do $check$ declare n integer; begin
${mappingChecks}
  select count(*) into n from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id);
  if n not in(0,98) then raise exception 'Partial target set: do not complete an unreviewed partial application'; end if;
end $check$;
insert into public.nba_player_provider_identities(provider,provider_player_id,player_id,provider_name,resolution_status,resolution_method,evidence,is_locked)
select provider,provider_player_id,player_id,provider_name,resolution_status,resolution_method,evidence,is_locked from _pc_targets
on conflict(provider,provider_player_id) do nothing;
do $verify$ begin
${mappingChecks}
  if (select count(*) from public.nba_player_provider_identities)<>465 or (select count(*) from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id))<>98 then raise exception 'Post-insert count mismatch'; end if;
end $verify$;
commit;
`;
  const rollback=`${guard('rollback-mappings',plan.manifestSha256,plan.snapshotSha256)}lock table public.nba_player_provider_identities in share row exclusive mode;
lock table public.players in share mode;
-- Block any concurrent dependency insertion while testing whether deletion is safe.
lock table public.nba_player_game_observation_versions in share mode;
lock table public.nba_projection_stat_cache in share mode;
\\ir 00-mapping-inputs.sql
create temp table _pc_after(like public.nba_player_provider_identities) on commit drop;
-- This receipt is generated AFTER apply, in a new empty operator receipt directory.
\\copy _pc_after from 'nba-identities-after.csv' with(format csv,header true)
do $rollback$ declare n integer; begin
${mappingChecks}
  if (select count(*) from _pc_after)<>98 or exists(select 1 from _pc_after a left join _pc_targets t using(provider,provider_player_id) where t.provider_player_id is null or (to_jsonb(a)-'created_at'-'updated_at') is distinct from (to_jsonb(t)-'created_at'-'updated_at')) then raise exception 'Invalid after receipt'; end if;
  select count(*) into n from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id);
  if n not in(0,98) then raise exception 'Partial mapping rollback state'; end if;
  if n=98 then
    if exists((select a.* from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id) except select * from _pc_after) union all(select * from _pc_after except select a.* from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id))) then raise exception 'Mappings changed after receipt'; end if;
    if exists(select 1 from public.nba_player_game_observation_versions v join _pc_targets t on v.provider_player_id=t.provider_player_id or v.local_player_id=t.player_id) or exists(select 1 from public.nba_projection_stat_cache c join _pc_targets t on c.player_id=t.player_id) then raise exception 'Dependent evidence/cache exists: keep mappings; approve a corrective plan'; end if;
    if to_regclass('public.player_center_season_cache') is not null then
      if exists(select 1 from public.player_center_season_cache c join _pc_targets t on c.sport='nba' and (c.provider_player_id=t.provider_player_id or c.nba_local_player_id=t.player_id)) then raise exception 'Player Center cache depends on mappings'; end if;
    end if;
  end if;
end $rollback$;
delete from public.nba_player_provider_identities a using _pc_after r where a.provider=r.provider and a.provider_player_id=r.provider_player_id and to_jsonb(a)=to_jsonb(r);
do $verify$ begin if exists((select * from _pc_base except select * from public.nba_player_provider_identities) union all(select * from public.nba_player_provider_identities except select * from _pc_base)) then raise exception 'Rollback baseline mismatch'; end if; end $verify$;
commit;
`;
  const preflight=`\\set ON_ERROR_STOP on
begin isolation level repeatable read read only;
set local statement_timeout='30s';
-- These exports must succeed in a NEW EMPTY operator receipt directory.
\\copy (select * from public.nba_player_provider_identities order by provider,provider_player_id) to 'nba-identities-before.csv' with(format csv,header true)
\\copy (select * from public.players order by id) to 'nba-players-before.csv' with(format csv,header true)
with targets as(select * from jsonb_to_recordset(${json(input)}) as t(player_id bigint,nba_player_id bigint,provider_player_id text))
select t.*,p.name,p.nba_player_id as current_native_id,p.is_active,a.player_id as current_mapping_player,a.resolution_status
from targets t left join public.players p on p.id=t.player_id left join public.nba_player_provider_identities a on a.provider='espn' and (a.provider_player_id=t.provider_player_id or a.player_id=t.player_id) order by t.player_id;
select count(*) as baseline_mappings from public.nba_player_provider_identities;
select version() as database_engine;
select season,count(*) as current_observations,count(distinct local_player_id) as players from public.nba_player_game_current_observations where season in(2026,2027) group by season order by season;
select tgname,tgenabled,pg_get_triggerdef(oid),pg_get_functiondef(tgfoid) from pg_trigger where tgrelid in('public.nba_player_game_observation_versions'::regclass,'public.nba_player_provider_identities'::regclass) and not tgisinternal;
select current_user,has_table_privilege(current_user,'public.nba_player_game_observation_versions','INSERT') as can_append,has_table_privilege(current_user,'public.nba_player_game_current_observations','INSERT,UPDATE') as can_run_invoker_trigger;
commit;
`;
  const post=`\\set ON_ERROR_STOP on
begin;
\\ir 00-mapping-inputs.sql
do $verify$ begin ${mappingChecks} if (select count(*) from public.nba_player_provider_identities)<>465 then raise exception 'Expected 465 mappings'; end if; end $verify$;
\\copy (select a.* from public.nba_player_provider_identities a join _pc_targets t using(provider,provider_player_id) order by a.provider_player_id) to 'nba-identities-after.csv' with(format csv,header true)
select 'VERIFIED' as result,count(*) as mapped_active_players from public.nba_player_provider_identities i join public.players p on p.id=i.player_id where i.resolution_status='resolved' and p.is_active;
commit;
`;
  const csv = rows => rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\n')+'\n';
  const files={'00-mapping-inputs.sql':mappingStage(plan,snapshot),'01-preflight-and-backup.sql':preflight,'02-apply-mappings.sql':apply,
    '03-postflight-and-receipt.sql':post,'04-rollback-mappings.sql':rollback,
    'mapping-review.csv':csv([['local_id','native_nba_id','local_name','before_team','native_current_team','espn_current_team','espn_id','identity_before','provider_name_after','status_after','method_after','locked_after','native_source','espn_source'],...plan.targets.map(t=>[t.localBefore.id,t.localBefore.nba_player_id,t.localBefore.name,t.localBefore.team_abbreviation,t.evidence.native.team,t.evidence.espn.team,t.identityAfter.provider_player_id,'ABSENT',t.identityAfter.provider_name,t.identityAfter.resolution_status,t.identityAfter.resolution_method,t.identityAfter.is_locked,t.evidence.nativeSource,t.evidence.espn.source])])};
  return Object.fromEntries(Object.entries(files).map(([name,body])=>[name,body.split('\n').map(line=>line.trimEnd()).join('\n')]));
}

module.exports={hash,quote,json,assert,business,mappingPlan,mappingFiles,guard,registerTypescript,functionGuard};
