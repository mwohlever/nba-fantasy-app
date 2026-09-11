import type { GolfValuePlayer, GolfValueHistory } from './valueModel';

// Narrow read-only historical analytics adapter; never used by live scoring/reconciliation.
type EspnRound = { period?: number; value?: number; displayValue?: string; linescores?: { value?: number; period?: number }[] };
type EspnPlayer = { id?: string; type?: string; order?: number; score?: string; athlete?: { displayName?: string }; status?: { type?: { name?: string } }; linescores?: EspnRound[] };
type EspnEvent = { id?: string; name?: string; date?: string; endDate?: string; status?: { type?: { completed?: boolean } }; competitions?: { status?: { period?: number; type?: { completed?: boolean } }; competitors?: EspnPlayer[] }[] };
export type GolfValueScoreboard = { events?: EspnEvent[] };
const toPar = (s?: string) => s==='E' ? 0 : s && /^[+-]?\d+$/.test(s) ? Number(s) : null;
function completedRounds(player: EspnPlayer) {
  return (player.linescores??[]).flatMap(r=>{
    const par=toPar(r.displayValue);
    const holes=r.linescores??[];
    const complete=holes.length===18 && new Set(holes.map(h=>h.period)).size===18 && holes.every(h=>Number.isInteger(h.period) && h.period!>=1 && h.period!<=18 && Number.isFinite(h.value) && h.value!>0);
    return r.period && r.period>=1 && r.period<=4 && complete && par!==null && Number.isFinite(r.value) && r.value!>0
      ? [{round:r.period,toPar:par}] : [];
  });
}
export function golfValueInputsFromEspn(payload: GolfValueScoreboard, targetId: string) {
  const events=payload.events??[];
  const target=events.find(e=>e.id===targetId);
  if(!target?.date || !Number.isFinite(Date.parse(target.date)))throw new Error('Target tournament date unavailable');
  const field=target.competitions?.[0]?.competitors??[];
  if(!field.length || field.some(p=>p.type!=='athlete' || !p.id || !p.athlete?.displayName))throw new Error('Individual tournament field unavailable');
  const players: GolfValuePlayer[]=field.map(p=>({playerId:p.id!,name:p.athlete!.displayName!,history:[]}));
  const histories=new Map(players.map(p=>[p.playerId,[] as GolfValueHistory[]]));
  const usedEvents: string[]=[];
  const skippedEvents: string[]=[];
  const seen=new Set<string>();
  for(const event of events){
    if(!event.id || event.id===targetId || !event.endDate || Date.parse(event.endDate)>=Date.parse(target.date) ||
      new Date(event.endDate).getUTCFullYear()!==new Date(target.date).getUTCFullYear())continue;
    const comp=event.competitions?.[0];
    if(!(event.status?.type?.completed || comp?.status?.type?.completed))continue;
    // Team/matchplay/Stableford formats are not comparable V1 stroke-play inputs.
    if(/zurich|barracuda|match play|ryder|presidents/i.test(event.name??'') || !comp?.competitors?.length || comp.competitors.some(p=>p.type!=='athlete')){skippedEvents.push(event.id);continue;}
    if(seen.has(event.id))throw new Error('Duplicate provider event');seen.add(event.id);
    const entries=comp.competitors.map(p=>({p,rounds:completedRounds(p)}));
    const roundCount=comp.status?.period;
    if(!roundCount || ![1,2,3,4].includes(roundCount)){skippedEvents.push(event.id);continue;}
    const means=new Map<number,number>();
    for(const round of [1,2,3,4]){
      const values=entries.flatMap(e=>e.rounds.filter(r=>r.round===round).map(r=>r.toPar));
      if(values.length>=10)means.set(round,values.reduce((a,b)=>a+b,0)/values.length);
    }
    if(!means.size){skippedEvents.push(event.id);continue;}
    usedEvents.push(event.id);
    for(const {p,rounds} of entries){
      if(!p.id || !histories.has(p.id))continue;
      const label=(p.status?.type?.name??p.score??'').toUpperCase();
      const status: GolfValueHistory['status']=/WITHDRAW|\bWD\b/.test(label)?'withdrawn':/DISQUAL|\bDQ\b/.test(label)?'disqualified':/DID.NOT.START|\bDNS\b/.test(label)?'did_not_start':/MISSED.CUT|\bCUT\b/.test(label)?'cut':rounds.length===roundCount?'finished':'unknown';
      // Use supplied final order; identical total scores share the average order.
      const tied=entries.filter(e=>e.p.score===p.score && e.rounds.length===rounds.length && Number.isFinite(e.p.order));
      const order=tied.length?tied.reduce((s,e)=>s+e.p.order!,0)/tied.length:p.order;
      const finishPercentile=status==='finished' && Number.isFinite(order) && order!>=1 && order!<=entries.length
        ? 100*(entries.length-order!)/Math.max(1,entries.length-1) : null;
      histories.get(p.id)!.push({eventId:event.id,endedAt:event.endDate,status,finishPercentile,
        roundDifferentials:rounds.filter(r=>means.has(r.round)).map(r=>means.get(r.round)!-r.toPar)});
    }
  }
  return {eventId:targetId,eventName:target.name,startsAt:target.date,season:new Date(target.date).getUTCFullYear(),
    players:players.map(p=>({...p,history:histories.get(p.playerId)!})),usedEvents,skippedEvents};
}
