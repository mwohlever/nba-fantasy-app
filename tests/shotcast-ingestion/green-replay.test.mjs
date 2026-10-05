import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { importTs } from './module-loader.mjs';
import { preservedReplay } from './current-provider.mjs';
const g = await importTs('lib/shotcast/productionGeometry.ts');
const { createGreenTopography } = await importTs('lib/shotcast/greenTopography.ts');
const { createGreenFlow, createGreenFlowClock, FLOW_DISPLAY_LIFT, flowSpeed } = await importTs('lib/shotcast/greenFlow.ts');
const { buildPuttPath, createPuttReplay } = await importTs('lib/shotcast/puttReplay.ts');
const { createShotPlayback } = await importTs('lib/shotcast/shotReplay.ts');
const { currentPreparationInput, isShotcast3DView } = await importTs('lib/shotcast/shotcast3dView.ts');
const { resolveDevelopmentShotcast } = await importTs('lib/shotcast/developmentAssetResolver.server.ts');
const near = (a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const d=JSON.parse(fs.readFileSync('tmp/shotcast-ingestion/packages/pga-71908773-fb52-47d0-bb1e-f44f50b34965/descriptor.json'));
d.selection.playerId='46046';d.shotSource.identity.playerName='Scottie Scheffler';d.shotSource.source.localPath='tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json';
const {replay}=await preservedReplay(d);
const bytes=fs.readFileSync(d.assets.find(a=>a.id==='green').localPath);
const green=g.decodeTerrainGlb(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const topo=createGreenTopography(green);
const previous=process.env.NODE_ENV;process.env.NODE_ENV='development';
const view=await resolveDevelopmentShotcast(currentPreparationInput(replay));
if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;
const mesh=(p,indices=[0,1,2])=>[{positions:new Float32Array(p),indices:new Uint32Array(indices)}];

test('donor exact plane math: elevation, winding-independent gradient and downhill; authored normals unused',()=>{
 for(const ids of [[0,1,2],[2,1,0]]){const m=mesh([0,0,5,4,0,13,0,4,17],ids);m[0].normals=new Float32Array(9).fill(1);
 const t=createGreenTopography(m),s=t.sample(1,1);near(s.elevation,10);near(s.slopeMagnitude,Math.sqrt(13));near(s.downhillX,-2/Math.sqrt(13));near(s.downhillY,-3/Math.sqrt(13));assert.equal(t.sample(4,4),null);
 assert.ok(t.sample(1+s.downhillX*.01,1+s.downhillY*.01).elevation<s.elevation);}
 const flat=createGreenTopography(mesh([0,0,-10,4,0,-10,0,4,-10]));assert.equal(flat.sample(1,1).slopeMagnitude,0);assert.equal(createGreenFlow(flat).count,0);
 assert.equal(flowSpeed(.003),0);assert.ok(flowSpeed(.02)<flowSpeed(.04));assert.throws(()=>createGreenTopography(mesh([0,0,0,1,0,NaN,0,1,0])));
});
test('Southwind authored mesh agrees with independent Phase 2 triangle grounding, without changing geometry',()=>{
 const before=green.map(p=>Array.from(p.positions));assert.equal(topo.vertices,4166);assert.equal(topo.triangles,8158);
 near(topo.bounds.minZ,10.756793022155762);near(topo.bounds.maxZ,11.450657844543457);
 for(const m of green)for(let i=0;i<m.indices.length;i+=51){const ids=[m.indices[i],m.indices[i+1],m.indices[i+2]],x=ids.reduce((s,a)=>s+m.positions[a*3],0)/3,y=ids.reduce((s,a)=>s+m.positions[a*3+1],0)/3;
 near(topo.sample(x,y).elevation,g.surfaceHeight(green,x,y));assert.deepEqual(createGreenTopography(green).sample(x,y),topo.sample(x,y));}
 assert.deepEqual(green.map(p=>Array.from(p.positions)),before);
});
test('real supplied putt samples map exactly; terminal millimetre connector leaves all samples/times intact',()=>{
 assert.ok(isShotcast3DView(view));assert.deepEqual(view.puttPaths.map(p=>p.strokeNumber),[3,4]);assert.deepEqual(view.puttPaths.map(p=>p.samples.length),[46,14]);
 for(const p of view.puttPaths){const shot=view.shots.find(s=>s.strokeNumber===p.strokeNumber),raw=replay.shots.find(s=>s.strokeNumber===p.strokeNumber).ballPath.path;
 const r=createPuttReplay(p,topo);assert.deepEqual(r.sample(0).position,shot.from);assert.deepEqual(r.sample(r.duration).position,shot.endpoint);
 p.samples.forEach((s,i)=>{assert.deepEqual(s.native,[raw[i].x,raw[i].y,raw[i].z]);assert.equal(s.secondsSinceStart,raw[i].secondsSinceStart);
 const [x,y]=g.convertNativePoint({tourcastX:raw[i].x,tourcastY:raw[i].y,tourcastZ:raw[i].z},d.configuration.offset);assert.deepEqual(s.position.slice(0,2),[x,y]);near(s.position[2],g.surfaceHeight(green,x,y));
 const actual=r.sample(s.secondsSinceStart).position;actual.forEach((v,a)=>near(v,s.position[a]));assert.ok(Object.isFrozen(s));});
 for(let t=0;t<r.duration;t+=.007){const s=r.sample(t);near(s.position[2],g.surfaceHeight(green,s.position[0],s.position[1]));}
 const render=r.displayPoints();for(const point of render.points)near(point[2],g.surfaceHeight(green,point[0],point[1]));
 assert.deepEqual(r.displayPoints(),render);
 }
 assert.deepEqual(view.shots[2].endpoint,view.shots[3].from);assert.deepEqual(view.puttPaths[1].endpoint,view.pin);
 assert.equal(view.puttPaths[0].connectorSeconds,0);assert.equal(view.puttPaths[1].connectorSeconds,.24);
 const last=view.puttPaths[1].samples.at(-1).position;near(last[0]-view.pin[0],-.001220703125);near(last[1]-view.pin[1],-.000732421875);near(last[2]-view.pin[2],.0000351510965686);
});
test('putt rejects coordinate defects, off-mesh data, non-cup gaps, invalid ordering and missing elevation',()=>{
 const source=replay.shots[3].ballPath,shot=view.shots[3];
 const build=(raw=source,from=shot.from,end=shot.endpoint,made=true)=>buildPuttPath(4,raw,d.configuration.offset,from,end,view.pin,made,topo);
 const bad=structuredClone(source);bad.path[0].x+=1;assert.throws(()=>build(bad),/start/);
 const ordering=structuredClone(source);ordering.path[1].secondsSinceStart=0;assert.throws(()=>build(ordering),/ordering/);
 const missing=structuredClone(source);missing.path[1].z=null;assert.throws(()=>build(missing));
 assert.throws(()=>build(source,shot.from,[shot.endpoint[0]+1,...shot.endpoint.slice(1)]));assert.throws(()=>build(source,shot.from,shot.endpoint,false),/endpoint/);
});
test('one controller: selection inert, event starts, re-click restarts, cross-kind switch replaces; reset deterministic',()=>{
 const before=JSON.stringify(view),buffers=green.map(p=>Array.from(p.positions)),offset=JSON.stringify(d.configuration.offset);
 const c=createShotPlayback(view.flightPaths,view.puttPaths,topo);c.select(1);assert.equal(c.snapshot().phase,'idle');
 const run=stroke=>{assert.ok(c.request(stroke));const states=[c.snapshot()];for(let i=0;i<=600;i++){c.tick(i*1000/60,true);states.push(c.snapshot());}return states;};
 for(const stroke of [1,2,3,4]){const first=run(stroke);c.reset();assert.equal(c.snapshot().sample,null);assert.deepEqual(run(stroke),first);
 const s=view.shots.find(s=>s.strokeNumber===stroke);assert.deepEqual(first[0].sample.position,s.from);assert.deepEqual(first.at(-1).sample.position,s.endpoint);
 assert.ok(c.request(stroke));assert.equal(c.snapshot().elapsed,0);assert.deepEqual(c.snapshot().sample.position,s.from);}
 c.request(1);c.tick(0,true);c.tick(500,true);c.request(3);assert.equal(c.snapshot().kind,'putt');assert.equal(c.snapshot().elapsed,0);assert.deepEqual(c.snapshot().sample.position,view.shots[2].from);
 c.tick(2000,true);c.tick(2400,true);const paused=c.snapshot();c.tick(2500,false);c.tick(20000,true);assert.deepEqual(c.snapshot(),paused);
 assert.equal(c.request(99),false);assert.equal(c.snapshot().sample,null);
 assert.equal(JSON.stringify(view),before);assert.deepEqual(green.map(p=>Array.from(p.positions)),buffers);assert.equal(JSON.stringify(d.configuration.offset),offset);
});
test('flow advection is deterministic, downhill, surface-bound and clock pauses without catch-up',()=>{
 const a=createGreenFlow(topo),b=createGreenFlow(topo);assert.ok(a.count>0);assert.deepEqual(a.positions,b.positions);
 const before=green.map(p=>Array.from(p.positions));
 for(let frame=0;frame<240;frame++){const xy=[...a.xy],respawns=[...a.respawns];a.step(1/60);b.step(1/60);assert.deepEqual(a.positions,b.positions);
 for(let i=0;i<a.count;i++){const s=topo.sample(a.xy[i*2],a.xy[i*2+1]);assert.ok(s);
 if(respawns[i]===a.respawns[i])assert.ok(s.elevation<=topo.sample(xy[i*2],xy[i*2+1]).elevation+1e-8);
 for(let j=0;j<3;j++){const at=i*9+j*3;if(a.weights[i*3+j]>0){const p=a.positions.slice(at,at+3);const hit=topo.sample(p[0],p[1]);assert.ok(hit);near(p[2],hit.elevation+FLOW_DISPLAY_LIFT,5e-5);}}
 }}
 const clock=createGreenFlowClock();assert.equal(clock.tick(0,true),0);near(clock.tick(16,true),.016);assert.equal(clock.tick(400,false),0);assert.equal(clock.tick(4000,true),0);near(clock.tick(9000,true),.25);
 assert.deepEqual(green.map(p=>Array.from(p.positions)),before);
});
test('accepted flight and world files are byte-identical; migration contains no fixture runtime import or extra replay control',()=>{
 // Hash gate guards accepted numerical implementations, not an implementation-mirroring UI assertion.
 for(const [name,hash] of [['pgaFlight','864acdfd58b1e68ed0de95be39b9ab2f85df222a57108b44df6d0d912f7e82b6'],['flightReplay','2b650504cc67ac4f922bc5be53abcf68801b2a685ab1923ae2813bbbf094d22b'],['holeWorld','4f2c736bff933baf4ed59c1e93aab2c1803be5c9c4bae745a2be4fd2549fa8cb'],['productionGeometry','6d237a280c637b64c6286dd860b54ce9967f7097d1b28fe2b40c4e2cd6ce6863']])assert.equal(createHash('sha256').update(fs.readFileSync(`lib/shotcast/${name}.ts`)).digest('hex'),hash);
 for(const name of ['greenTopography','greenFlow']){const donor=fs.readFileSync(`../nba-fantasy-app-3d/lib/shotcast/${name}.ts`,'utf8').replace("import type { Primitive } from './fixturePlacement';", "import type { TerrainPrimitive as Primitive } from './productionGeometry';");assert.equal(fs.readFileSync(`lib/shotcast/${name}.ts`,'utf8'),donor);}
 const renderer=fs.readFileSync('components/lineups/GolfShotcast3D.tsx','utf8');assert.ok(!renderer.includes('Replay shot {selectedStrokeNumber} (3D)'));assert.ok(!renderer.includes('shotcast-fixture'));
});
