/* eslint-disable @typescript-eslint/no-require-imports */
// No dotenv, application API, projection caller, DML client or generic RPC executor.
require('./playerCenterRollout.cjs').registerTypescript();
const { verifyNbaIntegrity, NBA_INTEGRITY_TABLES, NBA_INTEGRITY_ORDER, nbaIntegritySelect } = require('../../lib/player-center/nbaIntegrity.ts');
const { readNbaRefreshDisk, assertNbaRefreshStorage } = require('../../lib/player-center/refreshStorage.ts');
const { NBA_APPEND_SOURCE_MD5 } = require('../../lib/player-center/nbaRefresh.ts');
const { boundedJson } = require('../run-nba-player-center-refresh.cjs');
const PROJECT = 'oororafwujfliscjasur';
const ORIGIN = `https://${PROJECT}.supabase.co`;
const allowedTables = new Set(['players','players_nfl','nba_player_provider_identities','player_center_season_cache','player_center_nba_refresh_status',...Object.values(NBA_INTEGRITY_TABLES)]);

function createCanaryTransport({ origin, key, request = fetch, now = Date.now, allowPublication = false }) {
  if (origin !== ORIGIN || !key?.trim()) throw Error('Exact reviewed Supabase target and service credential required');
  async function rest(path, { method = 'GET', body } = {}) {
    const publication = path === 'rpc/publish_player_center_nba_refresh' && method === 'POST';
    if (method !== 'GET' && method !== 'HEAD' && !(allowPublication && publication)) throw Error('Write-free transport rejects mutation');
    const result = await request(`${origin}/rest/v1/${path}`, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...(method === 'HEAD' ? { Prefer: 'count=exact' } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!result.ok) throw Error(`Read/publication transport HTTP ${result.status}; inspect receipt before any exact replay`);
    return method === 'HEAD' ? result : boundedJson(result, 5_000_000);
  }
  async function rows(table, query) {
    if (!allowedTables.has(table)) throw Error('Unreviewed table');
    const result = await rest(`${table}?${new URLSearchParams(query)}`);
    if (!Array.isArray(result)) throw Error('Invalid read response');
    return result;
  }
  async function all(table, select, filters = {}) {
    const out=[];
    for (let offset=0;offset<3000;) {
      const page=await rows(table,{select,...filters,order:table==='nba_player_provider_identities'?'provider_player_id':'id',offset:String(offset),limit:'1000'});
      if (!page.length) return out;
      out.push(...page); offset+=page.length;
    }
    throw Error('Catalog read cap; no partial cohort accepted');
  }
  async function health(full = false) {
    const first=await rest('rpc/player_center_nba_refresh_health?full_check=false');
    const check=value=>{if(value?.schema_ok!==true || value.append_source_hash!==NBA_APPEND_SOURCE_MD5)throw Error('Schema/append fingerprint gate failed');};check(first);
    const count=async table=>{
      const response=await rest(`${table}?select=*`,{method:'HEAD'}), value=response.headers.get('content-range')?.split('/').at(-1);
      if(!/^\d+$/.test(value??''))throw Error('Exact integrity count unavailable');return Number(value);
    };
    const integrity=full?await verifyNbaIntegrity({
      async anchor(){const [historyCount,currentCount,last]=await Promise.all([count(NBA_INTEGRITY_TABLES.history),count(NBA_INTEGRITY_TABLES.current),rows(NBA_INTEGRITY_TABLES.history,{select:'id',order:'id.desc',limit:'1'})]);return{historyCount,currentCount,watermark:last[0]?.id??null};},
      page:(table,offset,limit)=>rows(NBA_INTEGRITY_TABLES[table],{select:nbaIntegritySelect(table),order:NBA_INTEGRITY_ORDER[table],offset:String(offset),limit:String(limit)}),
    },{now}):{};
    const last=await rest('rpc/player_center_nba_refresh_health?full_check=false');check(last);
    const disk=await readNbaRefreshDisk(now(),request,{origin,key});
    if(Math.abs(last.database_bytes-disk.metrics_database_bytes)>16*1048576 || Math.abs(last.wal_bytes-disk.metrics_wal_bytes)>32*1048576)throw Error('Storage metrics disagree');
    const value={...last,...integrity,...disk,project_ref:PROJECT};assertNbaRefreshStorage(value,0,now());return value;
  }
  async function resolveTargets(sport, targets) {
    if(!['nba','nfl'].includes(sport)||!Array.isArray(targets)||targets.length<1||targets.length>3||new Set(targets.map(p=>p.playerId)).size!==targets.length)throw Error('Select 1–3 exact distinct targets');
    const table=sport==='nba'?'players':'players_nfl', native=sport==='nba'?'nba_player_id':'nfl_player_id';
    const catalog=await all(table,`id,name,${native},${sport==='nba'?'position_group':'position'},is_active`);
    const identities=sport==='nba'?await all('nba_player_provider_identities','provider,provider_player_id,player_id,resolution_status,evidence,is_locked'):[];
    return targets.map(target=>{
      if(!Number.isSafeInteger(target.playerId)||!/^\d+$/.test(target.nativePlayerId)||!/^\d+$/.test(target.providerPlayerId))throw Error('Exact numeric identities required');
      const row=catalog.find(p=>p.id===target.playerId), position=row?.[sport==='nba'?'position_group':'position'];
      if(!row?.is_active||row.name!==target.name||position!==target.position||String(row[native])!==target.nativePlayerId||catalog.filter(p=>String(p[native])===target.nativePlayerId).length!==1)throw Error('Target catalog drift/identity conflict');
      if(sport==='nba'){
        const matches=identities.filter(p=>p.provider==='espn'&&p.player_id===row.id&&p.resolution_status==='resolved');
        if(matches.length!==1||matches[0].provider_player_id!==target.providerPlayerId||!matches[0].is_locked||!matches[0].evidence?.trim())throw Error('Reviewed NBA mapping unavailable');
      }else if(target.providerPlayerId!==target.nativePlayerId)throw Error('NFL direct/synthetic identity changed');
      return{sport,playerId:row.id,name:row.name,position,active:true,nativePlayerId:target.nativePlayerId,providerPlayerId:target.providerPlayerId,identity:'resolved'};
    });
  }
  async function snapshot(sport, season, players) {
    const ids=players.map(p=>p.playerId).join(','),cache=await rows('player_center_season_cache',{select:'*',sport:`eq.${sport}`,season:`eq.${season}`,phase:'eq.regular',[sport==='nba'?'nba_local_player_id':'nfl_local_player_id']:`in.(${ids})`,order:'provider_player_id',limit:'4'});
    const status=sport==='nba'?await rows('player_center_nba_refresh_status',{select:'*',season:`eq.${season}`,player_id:`in.(${ids})`,order:'player_id',limit:'4'}):[];
    if(cache.length>players.length||status.length>players.length)throw Error('Conflicting before/after rows');
    return{cache,status};
  }
  async function publishNba(bundle) {
    if(!allowPublication)throw Error('Write-free transport rejects publication');
    if(bundle.sport!=='nba'||bundle.publications.length<1||bundle.publications.length>3)throw Error('Bounded NBA publication required');
    const payload={run_id:bundle.runId,season:bundle.season,as_of:bundle.asOf,publications:bundle.publications};
    const bytes=Buffer.byteLength(JSON.stringify(payload));if(bytes>2500000)throw Error('Canary payload cap exceeded');
    const current=await health(false);assertNbaRefreshStorage(current,bytes,now());
    return rest('rpc/publish_player_center_nba_refresh',{method:'POST',body:payload});
  }
  return{health,resolveTargets,snapshot,publishNba};
}
module.exports={createCanaryTransport,PROJECT,ORIGIN};
