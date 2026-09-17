/* Manual-only Phase C worker: factual observation refresh is deliberately separate. */
const base=process.env.NFL_PROJECTION_INGEST_BASE_URL?.trim(),secret=process.env.NFL_PROJECTION_INGEST_SECRET?.trim(),season=Number(process.env.NFL_PROJECTION_SEASON||2026);
if(!base||!secret)throw new Error('NFL projection generation requires base URL and ingest secret');
if(!Number.isInteger(season)||season<2000||season>2100)throw new Error('NFL_PROJECTION_SEASON must be valid');
(async()=>{const r=await fetch(new URL('/api/internal/nfl/projection-ingest',base),{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({action:'generate',season}),signal:AbortSignal.timeout(90000)});const p=await r.json();if(!r.ok)throw new Error(p.error||`NFL generation HTTP ${r.status}`);console.log(JSON.stringify(p,null,2));})().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1});
