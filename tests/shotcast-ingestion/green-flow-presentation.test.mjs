import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { importTs } from './module-loader.mjs';
const { retainFlowHead, createGreenFlowPresentation, distanceToPuttXY, flowCorridorOpacity, smoothDisplayFade }=await importTs('lib/shotcast/greenFlowPresentation.ts');

test('stable evenly spaced subset retains 28 of 64 families; whole heads/trails use the same selection',()=>{
 const display=createGreenFlowPresentation(64),positions=new Float32Array(64*9);
 const before=positions.slice();display.update(positions,null);
 assert.equal(display.retainedHeads,28);
 const a=Array.from({length:64},(_,i)=>retainFlowHead(i)),b=Array.from({length:64},(_,i)=>retainFlowHead(i));assert.deepEqual(a,b);
 for(let i=0;i<64;i++)for(let j=0;j<3;j++)assert.equal(display.displayAlpha[i*3+j]>0,retainFlowHead(i));
 assert.deepEqual(positions,before);
 const first=display.displayAlpha.slice();display.update(positions,null);assert.deepEqual(display.displayAlpha,first);
 const retained=a.map((v,i)=>v?i:null).filter(v=>v!==null);for(let i=1;i<retained.length;i++)assert.ok([2,3].includes(retained[i]-retained[i-1]));
});
test('distance uses supplied XY segments, including bends and zero-length segments; no new path data',()=>{
 const p=Object.freeze([Object.freeze([0,0,1]),Object.freeze([4,0,9]),Object.freeze([4,0,9]),Object.freeze([4,4,5])]);
 assert.equal(distanceToPuttXY(2,1,p),1);assert.equal(distanceToPuttXY(5,2,p),1);assert.equal(distanceToPuttXY(4,2,p),0);
 assert.equal(distanceToPuttXY(-1,0,p),1);assert.deepEqual(p,[[0,0,1],[4,0,9],[4,0,9],[4,4,5]]);
});
test('soft corridor emphasizes nearby slopes but reserves its centreline; no hard edge; far field stays visible',()=>{
 assert.equal(flowCorridorOpacity(0),0);assert.equal(flowCorridorOpacity(.18),0);
 assert.ok(flowCorridorOpacity(.30)>0);assert.ok(flowCorridorOpacity(.60)>.5);
 assert.ok(flowCorridorOpacity(2)>flowCorridorOpacity(5));assert.ok(flowCorridorOpacity(5)>flowCorridorOpacity(10));
 assert.ok(flowCorridorOpacity(100)>=.3);assert.ok(Math.abs(flowCorridorOpacity(.45-1e-5)-flowCorridorOpacity(.45+1e-5))<1e-5);
 for(let d=0;d<=15;d+=.01)assert.ok(flowCorridorOpacity(d)>=0&&flowCorridorOpacity(d)<=.58);
 assert.equal(smoothDisplayFade(12,12,18),0);assert.equal(smoothDisplayFade(18,12,18),1);
 assert.ok(smoothDisplayFade(15,12,18)>0&&smoothDisplayFade(15,12,18)<1);
});
test('switching selected putt only changes alpha, without changing path, flow positions or source weights',()=>{
 const count=64,positions=new Float32Array(count*9),weights=new Float32Array(count*3).fill(1);
 for(let i=0;i<count;i++)for(let j=0;j<3;j++)positions.set([i*.2,1,11],i*9+j*3);
 const p3=[[0,0,11],[12,0,11]],p4=[[0,10,11],[2,10,11]],before=JSON.stringify({p3,p4,positions:[...positions],weights:[...weights]});
 const display=createGreenFlowPresentation(count);display.update(positions,p3);const a=display.displayAlpha.slice();
 display.update(positions,p4);assert.notDeepEqual(display.displayAlpha,a);
 display.update(positions,p3);assert.deepEqual(display.displayAlpha,a);
 display.update(positions,p3,()=>0);assert.ok(display.displayAlpha.every(v=>v===0));
 assert.equal(JSON.stringify({p3,p4,positions:[...positions],weights:[...weights]}),before);
});
test('accepted golf data, slope/advection and replay contracts remain byte-identical',()=>{
 // Captured before this presentation pass; no generated tmp manifest is required.
 const hashes={
  "lib/shotcast/greenFlow.ts": "236170c8cfa21a541916af246cabe451ee046fea5c9b777735b02ea583b5ed02",
  "lib/shotcast/greenTopography.ts": "55b7deb7946f1be41f4f4170dc84123d73280194b15c21546149cbe0fe8d9916",
  "lib/shotcast/productionGeometry.ts": "6d237a280c637b64c6286dd860b54ce9967f7097d1b28fe2b40c4e2cd6ce6863",
  "lib/shotcast/holeWorld.ts": "4f2c736bff933baf4ed59c1e93aab2c1803be5c9c4bae745a2be4fd2549fa8cb",
  "lib/shotcast/puttReplay.ts": "586b7193279169c4ddc6e4046c150078f4bb2328a048882705aed4f7328d20d0",
  "lib/shotcast/pgaFlight.ts": "864acdfd58b1e68ed0de95be39b9ab2f85df222a57108b44df6d0d912f7e82b6",
  "lib/shotcast/flightReplay.ts": "2b650504cc67ac4f922bc5be53abcf68801b2a685ab1923ae2813bbbf094d22b",
  "lib/shotcast/shotReplay.ts": "338af2ebd675501739176e719f0758604fc2b73d08d3c2d761231e9102c35b38",
  "tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json": "f1a79aea5755540ee569f72bd52e566a35907f9c4e6f23fcdb7385c419274b25"
};
 for(const [file,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,file);
});
