import { evaluatePredictions } from "./backtest";
import { weightedMedian } from "../statistics";
import { NBA_STATS, type NbaStatLine } from "./types";

export type TournamentRow = {
  targetId: string; playerId: string; predicted: number; actual: number;
  expectedMinutes: number | null; actualMinutes: number;
  projectedStats?: NbaStatLine; actualStats: NbaStatLine;
  confidence: string; cohorts: string[];
};
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length || !x.every(Number.isFinite) || !y.every(Number.isFinite)) throw new Error("Invalid paired correlation inputs");
  if (x.length < 2) return null;
  const mx = x.reduce((a,b)=>a+b,0)/x.length, my = y.reduce((a,b)=>a+b,0)/y.length;
  const covariance = x.reduce((sum,value,i)=>sum+(value-mx)*(y[i]-my),0);
  const vx = x.reduce((sum,value)=>sum+(value-mx)**2,0), vy = y.reduce((sum,value)=>sum+(value-my)**2,0);
  return vx && vy ? covariance/Math.sqrt(vx*vy) : null;
}
function ranks(values: readonly number[]) {
  const sorted=values.map((value,i)=>({value,i})).sort((a,b)=>a.value-b.value), result=values.map(()=>0);
  for(let i=0;i<sorted.length;) {
    let end=i+1;
    while(end<sorted.length && sorted[end].value===sorted[i].value) end++;
    for(let j=i;j<end;j++) result[sorted[j].i]=(i+end-1)/2+1;
    i=end;
  }
  return result;
}
export function tournamentMetrics(rows: readonly TournamentRow[]) {
  const byPlayer = new Map<string,TournamentRow[]>();
  rows.forEach(row=>byPlayer.set(row.playerId,[...(byPlayer.get(row.playerId)??[]),row]));
  const macroMae = [...byPlayer.values()].map(player=>evaluatePredictions(player).mae!);
  const minuteRows=rows.filter(row=>row.expectedMinutes!==null).map(row=>({predicted:row.expectedMinutes!,actual:row.actualMinutes}));
  const centered: { predicted: number; actual: number }[]=[];
  for(const player of byPlayer.values()) {
    const p=player.reduce((s,r)=>s+r.predicted,0)/player.length, a=player.reduce((s,r)=>s+r.actual,0)/player.length;
    centered.push(...player.map(row=>({predicted:row.predicted-p,actual:row.actual-a})));
  }
  return { ...evaluatePredictions(rows), players:byPlayer.size,
    macroPlayerMae:macroMae.length?macroMae.reduce((a,b)=>a+b,0)/macroMae.length:null,
    medianAbsoluteError:weightedMedian(rows.map(row=>({value:Math.abs(row.predicted-row.actual),weight:1}))),
    correlation:pearson(rows.map(r=>r.predicted),rows.map(r=>r.actual)),
    rankCorrelation:pearson(ranks(rows.map(r=>r.predicted)),ranks(rows.map(r=>r.actual))),
    withinPlayerCorrelation:pearson(centered.map(r=>r.predicted),centered.map(r=>r.actual)),
    minutes:evaluatePredictions(minuteRows),
    statMae:Object.fromEntries(NBA_STATS.map(key=>[key,evaluatePredictions(rows.filter(r=>r.projectedStats)
      .map(row=>({predicted:row.projectedStats![key],actual:row.actualStats[key]}))).mae])) };
}

/** Paired common games, resampled by player (not independent-game pseudo-replication). */
export function pairedPlayerComparison(candidate: readonly TournamentRow[], baseline: readonly TournamentRow[]) {
  const lookup=new Map(baseline.map(row=>[row.targetId,row]));
  const differences=new Map<string,number[]>();
  for(const row of candidate) {
    const other=lookup.get(row.targetId);
    if(!other) continue;
    if(other.playerId!==row.playerId || other.actual!==row.actual) throw new Error("Paired evaluation truth mismatch");
    const diff=Math.abs(row.predicted-row.actual)-Math.abs(other.predicted-other.actual);
    differences.set(row.playerId,[...(differences.get(row.playerId)??[]),diff]);
  }
  const playerDeltas=[...differences.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([playerId,values])=>({playerId,
    games:values.length,maeDelta:values.reduce((a,b)=>a+b,0)/values.length}));
  const meanDelta=playerDeltas.length?playerDeltas.reduce((s,p)=>s+p.maeDelta,0)/playerDeltas.length:null;
  let seed=111;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const samples:number[]=[];
  if(playerDeltas.length>=2) for(let i=0;i<2000;i++) {
    let sum=0;
    for(let j=0;j<playerDeltas.length;j++) sum+=playerDeltas[Math.floor(random()*playerDeltas.length)].maeDelta;
    samples.push(sum/playerDeltas.length);
  }
  samples.sort((a,b)=>a-b);
  return { macroMaeDelta:meanDelta, playerDeltas, playerBlockBootstrap95:samples.length?[samples[49],samples[1949]]:null,
    interpretation:"Negative favors candidate; descriptive player-block interval, not proof of generalization" };
}
