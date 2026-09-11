/** Heuristic pre-tournament value, not predicted strokes or fantasy points. */
export const GOLF_VALUE_VERSION = 'golf-value-v1-owgr';
export type GolfValueHistory = {
  eventId: string;
  endedAt: string;
  status: 'finished' | 'cut' | 'withdrawn' | 'disqualified' | 'did_not_start' | 'unknown';
  finishPercentile: number | null;
  /** Same-event, same-round field mean to-par minus golfer to-par. Positive is better. */
  roundDifferentials: readonly number[];
};
export type GolfValuePlayer = { playerId: string; name: string; history: readonly GolfValueHistory[]; owgrRank?: number | null; owgrUpdatedAt?: string | null; isAmateur?: boolean };
export type GolfValueConfidence = 'high' | 'medium' | 'low' | 'no_history';
export function golfValueConfidence(appearances: number, rounds: number): GolfValueConfidence {
  if (![appearances, rounds].every(n => Number.isInteger(n) && n >= 0)) throw new Error('Invalid coverage counts');
  return appearances === 0 ? 'no_history' : appearances >= 8 && rounds >= 20 ? 'high' : appearances >= 5 && rounds >= 12 ? 'medium' : 'low';
}
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const grade = (d: number) => clamp(50 + 10 * d);
const mean = (xs: readonly number[]) => xs.reduce((a,b)=>a+b,0)/xs.length;
const rounded = (n: number) => Math.round(n*100)/100;

/** Ties receive identical midpoint percentiles, including all-tied/one-player fields. */
export function golfValuePercentiles(scores: readonly number[]) {
  if (scores.some(n=>!Number.isFinite(n))) throw new Error('Finite values required');
  return scores.map(score => scores.length <= 1 ? 50 : 100 *
    (scores.filter(n=>n<score).length + (scores.filter(n=>n===score).length-1)/2)/(scores.length-1));
}
/** Suggested price only; never an effective/frozen acquisition price. */
export function golfValueSalary(finalValue: number) {
  if (!Number.isFinite(finalValue) || finalValue < 0 || finalValue > 100) throw new Error('Final value must be 0–100');
  const ordinary = Math.min(39, 15 + 27 * (finalValue / 100) ** 2);
  const dominance = 3 * clamp((finalValue - 98) / 2, 0, 1) ** 2;
  return Math.round(ordinary + dominance);
}
export function blendGolfValue(v1: number | null, owgr: number | null, confidence: GolfValueConfidence) {
  for (const n of [v1, owgr]) if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) throw new Error('Invalid percentile');
  if (confidence === 'no_history') v1 = null;
  if (v1 === null) return { finalValue: owgr, basis: owgr === null ? 'unsupported' as const : 'owgr_only' as const };
  if (owgr === null) return { finalValue: v1, basis: 'v1_only' as const };
  const weight = confidence === 'high' ? 0.7 : confidence === 'medium' ? 0.5 : 0.3;
  return { finalValue: weight * v1 + (1 - weight) * owgr, basis: 'blended' as const };
}

export function buildGolfValues(input: {
  eventId: string; startsAt: string; season: number; players: readonly GolfValuePlayer[];
}) {
  const cutoff=Date.parse(input.startsAt);
  if (!Number.isFinite(cutoff) || !Number.isInteger(input.season)) throw new Error('Valid tournament cutoff and season required');
  if (!input.players.length || input.players.some(p=>!p.playerId || !p.name) || new Set(input.players.map(p=>p.playerId)).size!==input.players.length) throw new Error('Unique nonempty field required');
  const bases=input.players.map(player=>{
    const seen=new Set<string>();
    const history=player.history.filter(h=>{
      const date=Date.parse(h.endedAt);
      if (!Number.isFinite(date)) throw new Error('Invalid history date');
      if (h.eventId===input.eventId || date>=cutoff || new Date(date).getUTCFullYear()!==input.season) return false;
      if (seen.has(h.eventId)) throw new Error('Duplicate historical appearance');
      seen.add(h.eventId);
      if (h.roundDifferentials.some(n=>!Number.isFinite(n)) || (h.finishPercentile!==null && (!Number.isFinite(h.finishPercentile) || h.finishPercentile<0 || h.finishPercentile>100))) throw new Error('Invalid performance input');
      return h.status!=='did_not_start';
    }).sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt) || a.eventId.localeCompare(b.eventId));
    const results=history.map(h=>{
      if(h.status==='cut')return {score:15,weight:1};
      if(h.status==='finished' && h.finishPercentile!==null)return {score:h.finishPercentile,weight:1};
      // Partial/ambiguous appearances use actual performance at half weight, never a fake finish.
      return h.roundDifferentials.length ? {score:grade(mean(h.roundDifferentials)),weight:0.5} : {score:50,weight:0};
    });
    const stabilized = (rows: {score:number;weight:number}[]) =>
      (150+rows.reduce((s,r)=>s+r.score*r.weight,0))/(3+rows.reduce((s,r)=>s+r.weight,0));
    const season=stabilized(results);
    const recent=stabilized(results.slice(0,5).map((r,i)=>({...r,weight:r.weight*(1-i*0.15)})));
    const rounds=history.flatMap(h=>h.roundDifferentials);
    const quality=grade(rounds.reduce((a,b)=>a+b,0)/(12+rounds.length));
    const appearances=results.filter(r=>r.weight>0).length;
    const confidence=golfValueConfidence(appearances,rounds.length);
    return {playerId:player.playerId,name:player.name,season,recent,quality,appearances,rounds:rounds.length,confidence};
  });
  const raw=bases.map(p=>0.35*p.season+0.30*p.recent+0.35*p.quality);
  const percentiles=golfValuePercentiles(raw);
  const ranked=input.players.filter(p=>Number.isInteger(p.owgrRank) && p.owgrRank!>0);
  const baseline=golfValuePercentiles(ranked.map(p=>-p.owgrRank!));
  const byId=new Map(ranked.map((p,i)=>[p.playerId,baseline[i]]));
  const players=bases.map((p,i)=>{
    const source=input.players[i];
    const owgrPercentile=byId.get(p.playerId) ?? null;
    const blended=blendGolfValue(p.confidence==='no_history'?null:percentiles[i],owgrPercentile,p.confidence);
    const amateur=source.isAmateur===true;
    const suggestedSalary=amateur?10:blended.finalValue===null?null:golfValueSalary(blended.finalValue);
    return {
      playerId:p.playerId,name:p.name,value:rounded(raw[i]),percentile:rounded(percentiles[i]),
      rank:1+raw.filter(n=>n>raw[i]).length,
      finalValue:blended.finalValue===null?null:rounded(blended.finalValue), finalRank:null as number|null,
      confidence:p.confidence,limitedHistory:p.confidence==='low'||p.confidence==='no_history',
      appearances:p.appearances,rounds:p.rounds,
      owgrRank:owgrPercentile===null?null:source.owgrRank!,owgrUpdatedAt:source.owgrUpdatedAt??null,
      owgrPercentile:owgrPercentile===null?null:rounded(owgrPercentile),valueBasis:blended.basis,
      isAmateur:amateur,
      pricing:{status:suggestedSalary===null?'unpriced' as const:'suggested' as const,
        suggestedSalary,effectiveSalary:null,requiresReview:blended.basis!=='blended',
        basis:amateur?'amateur' as const:blended.basis},
      components:{season:rounded(p.season),recent:rounded(p.recent),quality:rounded(p.quality)},
    };
  });
  for(const p of players) if(p.finalValue!==null) p.finalRank=1+players.filter(q=>q.finalValue!==null&&q.finalValue>p.finalValue!).length;
  return {version:GOLF_VALUE_VERSION,eventId:input.eventId,startsAt:input.startsAt,
    priceSetState:'draft' as const,owgrCoverage:{ranked:ranked.length,total:players.length},
    players:players.sort((a,b)=>(a.finalRank??Infinity)-(b.finalRank??Infinity)||a.playerId.localeCompare(b.playerId)),
  };
}
