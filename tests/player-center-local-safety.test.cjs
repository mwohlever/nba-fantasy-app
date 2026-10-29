/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),test=require('node:test'),Module=require('node:module');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const {playerCenterEnabled,playerCenterReadOnlyLocal}=require('../lib/player-center/feature.ts');
const previous={...process.env};
test('production is closed by default; local review never activates in production',()=>{
 try{delete process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED;process.env.NODE_ENV='production';process.env.NEXT_PUBLIC_PLAYER_CENTER_READ_ONLY_LOCAL='true';assert.equal(playerCenterEnabled(),false);assert.equal(playerCenterReadOnlyLocal(),false);
 process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED='true';assert.equal(playerCenterEnabled(),true);process.env.NODE_ENV='development';assert.equal(playerCenterReadOnlyLocal(),true);process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED='false';assert.equal(playerCenterEnabled(),false);
 }finally{for(const key of ['NODE_ENV','NEXT_PUBLIC_PLAYER_CENTER_ENABLED','NEXT_PUBLIC_PLAYER_CENTER_READ_ONLY_LOCAL'])if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
test('local read-only Supabase transport blocks every mutation and all RPCs, while forwarding SELECTs unchanged',async()=>{
 const load=Module._load,fetch=global.fetch;let options,reads=0;
 Module._load=function(request,parent,...args){if(request==='@supabase/supabase-js')return{createClient:(url,key,o)=>{options=o;return{};}};return load.call(this,request,parent,...args);};
 try{process.env.NODE_ENV='development';process.env.NEXT_PUBLIC_PLAYER_CENTER_READ_ONLY_LOCAL='true';global.fetch=async()=>{reads++;return new Response('[]');};require('../lib/supabaseAdmin.ts');
 for(const method of ['POST','PATCH','PUT','DELETE'])assert.equal((await options.global.fetch('https://isolated.test/rest/v1/players',{method})).status,403);
 assert.equal((await options.global.fetch(new Request('https://isolated.test/rest/v1/rpc/mutate',{method:'GET'}))).status,403);
 assert.equal(reads,0);assert.equal((await options.global.fetch('https://isolated.test/rest/v1/players',{method:'GET'})).status,200);assert.equal(reads,1);
 process.env.NODE_ENV='production';assert.equal((await options.global.fetch('https://isolated.test/rest/v1/players',{method:'POST'})).status,200);assert.equal(reads,2,'ordinary production transport is unchanged; this test fetch is stubbed');
 }finally{Module._load=load;global.fetch=fetch;for(const key of ['NODE_ENV','NEXT_PUBLIC_PLAYER_CENTER_READ_ONLY_LOCAL'])if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
