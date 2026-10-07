/** RESEARCH ONLY: executes published PGA functions, never our geometry/registration or donor code.
 * One engine hook exposes existing functions; one webpack hook exposes its existing private converter.
 * Raw GLB accessors form the SDK's point/index inputs; no surface/transform algorithm is reimplemented.
 * This is controlled provider-engine execution, not a claim of live public-page capture. */
import fs from 'node:fs';import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
if (process.env.NODE_ENV === 'production') throw new Error('Research oracle disabled in production');
const { chromium } = await import(pathToFileURL(process.env.SHOTCAST_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:process.env.SHOTCAST_CHROMIUM_BIN,args:['--no-sandbox']});
const reports=[];
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for(const { event, player, round, hole, directory } of cases){
 const meta=JSON.parse(fs.readFileSync(`${directory}/evidence.json`)),course=meta.assignments.find(a=>a.round===round).course.id;
 const readInput = key => {
  const bytes = fs.readFileSync(`${directory}/${key}.bin`);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== meta.inputs[key].sha256) throw Error('Changed oracle input: ' + key);
  return bytes;
 };
 const appKey = Object.keys(meta.inputs).find(k => /\/app\/(?:%5B|\[)product(?:%5D|\])\/page-/.test(meta.inputs[k].sourceUrl));
 const sharedKeys = Object.keys(meta.inputs).filter(k => k.endsWith('.js')).filter(k => { const text = readInput(k).toString(); return text.includes('19811:') && text.includes('54318:'); });
 if (!appKey || sharedKeys.length !== 1) throw Error('Ambiguous PGA registration modules');
 const engine=readInput('engine').toString(),app=readInput(appKey).toString(),shared=readInput(sharedKeys[0]).toString();
 if (meta.inputs.engine.sha256 !== '2a64bbe1e11db7343aab33ca91a357e87139ef0becbbc869d89c73c4a99f3018') throw Error('Unknown PGA grounding engine');
 const native=JSON.parse(readInput(`native-r${round}`)),rawHole=native.holes.find(h=>h.holeNumber===hole);
 const named=[{label:'tee-from',raw:rawHole.strokes[0].overview.leftToRightCoords.fromCoords},{label:'pin',raw:rawHole.pinOverview.leftToRightCoords},...rawHole.strokes.flatMap(s=>[{label:`from-${s.strokeNumber}`,raw:s.overview.leftToRightCoords.fromCoords},{label:`to-${s.strokeNumber}`,raw:s.overview.leftToRightCoords.toCoords}]),{label:'published-tee',raw:rawHole.teeOverview.leftToRightCoords}];
 const terrain=readInput(`c${course}-terrain${String(hole).padStart(2,'0')}.glb`),green=readInput(`c${course}-Green${String(hole).padStart(2,'0')}.glb`);
 const page=await browser.newPage();await page.goto('about:blank');await page.evaluate(()=>{self.webpackChunk_N_E=[]});await page.addScriptTag({content:shared});await page.addScriptTag({content:app});
 await page.evaluate(()=>{
  const modules=Object.assign({},...self.webpackChunk_N_E.map(row=>row[1])),cache={};
  const require=id=>{if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};if(!modules[id])return m.exports;modules[id](m,m.exports,require);return m.exports};require.r=e=>{Object.defineProperty(e,'__esModule',{value:true})};require.d=(e,map)=>{for(const[k,get]of Object.entries(map))Object.defineProperty(e,k,{enumerable:true,get})};require.o=(obj,k)=>Object.prototype.hasOwnProperty.call(obj,k);
  // Expose the existing private converter. Its function body is not rewritten.
  const code=modules[27308].toString(),name=/let (\w+)=\(e,r\)=>\{let t=r.trans;[^}]*\.3048/.exec(code)?.[1];if(!name)throw Error('Unsupported PGA converter source');
  modules[27308]=new Function(`return (${code.slice(0,-1)};r.__registration=${name};})`)();
  window.__pgaApp={offset:require(27308).getTourcastOffset,convert:require(27308).__registration,vec:require(54318),converterSource:require(27308).__registration.toString()};
 });
 const close=engine.lastIndexOf('})();');if(close<0)throw Error('Engine closure missing');
 const hook=';window.__pgaGround={Vector3:b,terrain:iE,green:sE,state:rE,ground:Ia};';await page.addScriptTag({content:engine.slice(0,close)+hook+engine.slice(close)});
 const result=await page.evaluate(({config,course,named,terrain,green})=>{
  const sdk=window.__pgaGround,app=window.__pgaApp;
  const decode=values=>{
   const bytes=Uint8Array.from(values),view=new DataView(bytes.buffer);const doc=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+view.getUint32(12,true))));
   if(doc.nodes?.some(n=>['matrix','translation','scale','rotation'].some(k=>k in n)))throw Error('Unsupported node frame');let binary=0;for(let at=12;at<bytes.length;){const len=view.getUint32(at,true),type=view.getUint32(at+4,true);if(type===0x004e4942)binary=at+8;at+=8+len}
   const read=id=>{const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],width=a.type==='VEC3'?3:1,size=[5126,5125].includes(a.componentType)?4:a.componentType===5123?2:1,start=binary+(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||size*width;return Array.from({length:a.count*width},(_,i)=>{const at=start+Math.floor(i/width)*stride+i%width*size;return a.componentType===5126?view.getFloat32(at,true):size===4?view.getUint32(at,true):size===2?view.getUint16(at,true):view.getUint8(at)})};
   return doc.meshes.flatMap(m=>m.primitives.map(p=>{const positions=read(p.attributes.POSITION),indices=read(p.indices),vectors=[];for(let i=0;i<positions.length;i+=3)vectors.push(new sdk.Vector3(...positions.slice(i,i+3)));return{_positions:vectors,getIndices:()=>indices,subMeshes:[{indexStart:0,indexCount:indices.length,getBoundingInfo:()=>({boundingBox:{},boundingSphere:{}})}]}}));
  };
  sdk.terrain(decode(terrain));sdk.green(decode(green));const offset=app.offset(config,course);
  const registered=named.map(({label,raw})=>{const p=app.vec.fA(raw.tourcastX,raw.tourcastY,raw.tourcastZ);app.convert(p,offset);return{label,raw,converted:Array.from(p)}});
  const ground=(detailed,strict=false)=>{sdk.state({green:{greenViewLoaded:detailed}});const points=registered.map(p=>new sdk.Vector3(p.converted[0],p.converted[1],0));const flags=sdk.ground(points,'independent-phase4c',strict?0:1,strict?0:2);return points.map((p,i)=>({label:registered[i].label,world:[p.x,p.y,p.z],onGreen:flags?.[i]??null,xyWasNudged:p.x!==registered[i].converted[0]||p.y!==registered[i].converted[1]}))};
  return{offset:{quaternion:Array.from(offset.quat),translation:Array.from(offset.trans)},registered,coarse:ground(false),detailed:ground(true),strictCoarse:ground(false,true),strictDetailed:ground(true,true),converterSource:app.converterSource};
 },{config:meta.offsetConfig,course,named,terrain:Array.from(terrain),green:Array.from(green)});
 const report={event,player,round,hole,course,inputs:meta.inputs,nativeSha256:meta.inputs[`native-r${round}`].sha256,rawOffsetConfig:meta.offsetConfig,engineSha256:crypto.createHash('sha256').update(engine).digest('hex'),appSha256:crypto.createHash('sha256').update(app).digest('hex'),method:'actual published webpack registration + original PGA engine Ia/iE/sE functions; isolated browser; read-only closure exposure',...result};reports.push(report);console.log(JSON.stringify({event,round,course,offset:report.offset,detailed:report.detailed}));await page.close();
}
fs.writeFileSync(process.argv[3],JSON.stringify(reports,null,2)+'\n',{flag:'wx'});await browser.close();
