/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
const {input,build}=require('./helpers/nba-refresh-fixtures.cjs');
const {verifyNbaIntegrity,nbaIntegritySelect}=require('../lib/player-center/nbaIntegrity.ts');
const numeric=['local_player_id','season','minutes','points','rebounds','assists','steals','blocks','turnovers'];
function cast(row){for(const k of [row.id===undefined?'version_id':'id',...numeric])row['audit_'+k]=row[k]===null?null:String(row[k]);return row;}
function fixture(){
  const raw=build(input()).observations[0],created_at=new Date().toISOString();
  const old={...raw,id:1,created_at},latest={...raw,id:2,points:raw.points+1,created_at};
  const{ id,...fields}=latest;
  return{history:[cast(old),cast(latest)],current:[cast({...fields,version_id:id})]};
}
function reader(data,change={}){
  return{anchor:async()=>({historyCount:data.history.length,currentCount:data.current.length,watermark:data.history.at(-1)?.id??null}),
    page:async(table,offset,limit)=>structuredClone(data[table].slice(offset,offset+limit)),...change};
}
test('complete paged verifier checks corrections, exact payload and a stable current checksum',async()=>{
  const data=fixture(),value=await verifyNbaIntegrity(reader(data),{pageSize:1});
  assert.equal(value.reference_errors,0);assert.equal(value.history_count,2);assert.equal(value.current_count,1);assert.match(value.current_checksum,/^paged-v1:sha256:[a-f0-9]{64}$/);
  assert.equal(value.integrity_pages,4);assert.match(nbaIntegritySelect('history'),/audit_points:points::text/);
});
for(const [name,mutate]of Object.entries({
  'old winner':d=>{d.current[0].version_id=1;d.current[0].audit_version_id='1';},
  'changed fact':d=>{d.current[0].points++;d.current[0].audit_points=String(d.current[0].points);},
  'changed metadata':d=>{d.current[0].source_url+='changed';},
  'orphan current':d=>{d.current[0].provider_event_id='999';},
  'orphan history':d=>{d.current=[];},
  'duplicate history order':d=>{d.history[1].id=1;d.history[1].audit_id='1';},
  'extra schema column':d=>{d.current[0].audit_new_column=1;},
  'missing lossless field':d=>{delete d.current[0].audit_points;},
}))test(`integrity refuses ${name}`,async()=>{const data=fixture();mutate(data);await assert.rejects(verifyNbaIntegrity(reader(data)));});
test('fetched timestamp then ID, rather than insertion ID alone, selects the winner',async()=>{
  const d=fixture();d.history[0].provider_fetched_at='2026-10-30T00:00:00Z';d.history[1].provider_fetched_at='2026-10-29T00:00:00Z';
  const{id,...rest}=d.history[0];delete rest.audit_id;d.current=[cast({...rest,version_id:id})];
  assert.equal((await verifyNbaIntegrity(reader(d))).reference_errors,0);
});
test('exact NUMERIC text detects changes hidden by JavaScript floating-point rounding',async()=>{
  const d=fixture();d.history[1].audit_minutes='20.123456789012345678';d.current[0].audit_minutes='20.123456789012345679';
  await assert.rejects(verifyNbaIntegrity(reader(d)),/payload mismatch/);
});
test('numeric scale differences preserve PostgreSQL numeric equality',async()=>{
  const d=fixture();d.history[1].audit_minutes='20.00';d.current[0].audit_minutes='20.0';
  assert.equal((await verifyNbaIntegrity(reader(d))).reference_errors,0);
});
test('short server pages advance by actual row count and never certify truncation',async()=>{
  const d=fixture();const r=reader(d,{page:async(t,o)=>structuredClone(d[t].slice(o,o+1))});assert.equal((await verifyNbaIntegrity(r)).history_count,2);
  await assert.rejects(verifyNbaIntegrity(reader(d,{page:async()=>[]})),/Truncated/);
});
test('history drift between anchors aborts the complete audit',async()=>{
  const d=fixture();let n=0;const r=reader(d);r.anchor=async()=>({historyCount:++n===1?2:3,currentCount:1,watermark:2});await assert.rejects(verifyNbaIntegrity(r),/Concurrent/);
});
test('current changes between the two scans cannot be certified',async()=>{
  const d=fixture();let scans=0;const r=reader(d,{page:async(t,o,l)=>{const rows=structuredClone(d[t].slice(o,o+l));if(t==='current'&&++scans===2)rows[0].audit_points='999';return rows;}});
  await assert.rejects(verifyNbaIntegrity(r),/mismatch/);
});
test('deadline, row cap and inconsistent empty anchor fail closed',async()=>{
  const d=fixture();let now=0;await assert.rejects(verifyNbaIntegrity(reader(d),{now:()=>++now,timeoutMs:1}),/budget/);
  await assert.rejects(verifyNbaIntegrity(reader(d,{anchor:async()=>({historyCount:250001,currentCount:1,watermark:2})})),/cap/);
  await assert.rejects(verifyNbaIntegrity(reader(d,{anchor:async()=>({historyCount:0,currentCount:0,watermark:2})})),/anchor/);
  assert.equal((await verifyNbaIntegrity(reader({history:[],current:[]}))).watermark,null);
});
