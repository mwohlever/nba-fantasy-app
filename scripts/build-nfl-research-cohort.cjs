/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit local cohort discovery. It never contacts the app or Supabase.
const fs=require('node:fs'),path=require('node:path');
const base='https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const positions=['QB','RB','WR','TE'], perPosition=12;
async function get(url){const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});if(!response.ok)throw new Error(`ESPN ${response.status}: ${url}`);return response.json();}
async function main(){
 const teams=(await get(`${base}/teams?limit=40`)).sports?.[0]?.leagues?.[0]?.teams??[];
 const athletes=[];
 for(const entry of teams){const team=entry.team, payload=await get(`${base}/teams/${team.id}/roster`);for(const group of payload.athletes??[])for(const athlete of group.items??[]){const position=String(athlete.position?.abbreviation??'').toUpperCase();if(positions.includes(position)&&/^\d+$/.test(String(athlete.id)))athletes.push({espnPlayerId:String(athlete.id),expectedName:String(athlete.displayName??''),position});}}
 const players=[];
 for(const position of positions){const ordered=[...new Map(athletes.filter(x=>x.position===position).map(x=>[x.espnPlayerId,x])).values()].sort((a,b)=>Number(a.espnPlayerId)-Number(b.espnPlayerId));
  if(ordered.length<perPosition)throw new Error(`Insufficient ${position} roster athletes`);
  // One deterministic ID-sorted sample per equal-sized roster band, avoiding a stars-only cohort.
  for(let slot=0;slot<perPosition;slot++)players.push(ordered[Math.floor(slot*ordered.length/perPosition)]);
 }
 players.sort((a,b)=>a.position.localeCompare(b.position)||Number(a.espnPlayerId)-Number(b.espnPlayerId));
 const output={version:'nfl-research-cohort-v1',generatedAt:new Date().toISOString(),source:`${base}/teams + /teams/{id}/roster`,positions,playersPerPosition:perPosition,
  selectionRule:'For each QB/RB/WR/TE, deduplicate current ESPN NFL roster athletes by provider ID, sort ascending numeric ESPN athlete ID, divide that position list into 12 equal index bands, and select the first athlete in each band. The resulting frozen manifest—not a live roster query—is the research cohort.',players};
 const file=path.join(__dirname,'../data/analytics/nfl-research-cohort.json');fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({file,counts:Object.fromEntries(positions.map(p=>[p,players.filter(x=>x.position===p).length]))},null,2));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
