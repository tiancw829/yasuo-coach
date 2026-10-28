import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, matchup } from '../server/data.js';
import { LolpsProvider, publicPageData, withLolps } from '../server/lolps.js';
import { Coach, cacheKey, coachFacts } from '../server/ai.js';
import { createApp } from '../server/app.js';

const fixture=JSON.parse(await readFile(path.join(ROOT,'tests/fixtures/lolps-public.json'),'utf8'));
const html=(data=fixture)=>`<script>kit.start(app, element, {data: [{type:'data',data:${JSON.stringify({versionInfo:data.versions})}},{type:'data',data:${JSON.stringify(data.page)}}], form:null});</script>`;
const pageResponse=(data=fixture)=>new Response(html(data),{headers:{'Content-Type':'text/html'}});
const m=await matchup('Ahri','16.21.1');
async function temp<T>(fn:(dir:string)=>Promise<T>){const parent=path.join(ROOT,'.local');await mkdir(parent,{recursive:true});const dir=await mkdtemp(path.join(parent,'lolps-test-'));try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('public LOL.PS data is parsed as literals, rejects executable and oversized content',()=>{
  const value=publicPageData(html());assert.equal(value.page.champSummary[0].count,17365);assert.equal(value.versions[0].description,'26.21');
  assert.throws(()=>publicPageData(html().replace("data: [","data: [(()=>{throw new Error('execute')})(),")),/not literal/);
  assert.throws(()=>publicPageData(html().replace('"championId":157','"__proto__":{},"championId":157')),/invalid key/);
  assert.throws(()=>publicPageData('x'.repeat(2_000_001)),/too large/);assert.throws(()=>publicPageData('<html>login</html>'),/missing/);
});
test('LOL.PS reference keeps region, tier, patch, build samples and matchup scope separate',async()=>temp(async dir=>{
  let calls=0;const provider=new LolpsProvider(dir,(async(url)=>{calls++;assert.match(String(url),/^https:\/\/lol\.ps\/cn\/champ\/157\?/);assert.ok(!String(url).includes('/api'));return pageResponse();}) as typeof fetch);
  const [a,b]=await Promise.all([provider.get(m),provider.get(await matchup('Sylas',m.version))]);assert.equal(calls,1);
  assert.equal(a.status,'ready');assert.equal(a.versionMatch,true);assert.equal(a.patch,'26.21');assert.equal(a.region,'韩服');assert.equal(a.tier,'翡翠及以上');assert.equal(a.sampleCount,17365);assert.equal(a.matchup,null);
  assert.equal(b.matchup?.sampleCount,824);assert.equal(b.matchup?.winRate,56.67);assert.equal(a.builds[0].runeStats.sampleCount,5308);assert.equal(a.builds[0].runeStats.winRate,46.29);
  assert.equal(a.builds[0].startingItems.find(i=>i.id===2003)?.quantity,2);assert.equal(a.builds[0].runes[0].name,'致命节奏');assert.ok(a.source?.url.startsWith('https://lol.ps/'));
  assert.ok(a.limits.some(s=>s.includes('不能称为针对当前对手')));assert.match(a.timeRange,/未提供精确/);
  const disk=new LolpsProvider(dir,(async()=>{throw Error('should not fetch a fresh cache');}) as typeof fetch);assert.equal((await disk.get(m)).fetchedAt,a.fetchedAt);
  const fail=new LolpsProvider(dir,(async()=>{calls++;throw Error('private upstream error');}) as typeof fetch);const fallback=await fail.get(m,true);assert.equal(fallback.status,'stale');assert.equal(fallback.sampleCount,17365);assert.ok(!JSON.stringify(fallback).includes('private upstream'));
}));
test('LOL.PS chooses cached patch by source ID and flags unavailable versions',async()=>temp(async dir=>{
  const urls:string[]=[];const provider=new LolpsProvider(dir,(async(url)=>{urls.push(String(url));if(urls.length===1)return pageResponse();const older=structuredClone(fixture);older.page.championArguments.versionId=157;older.page.champSummary.forEach((b:any)=>b.versionId=157);return pageResponse(older);}) as typeof fetch);
  const old=await provider.get(await matchup('Ahri','16.20.1'));assert.equal(old.patch,'26.20');assert.equal(old.versionMatch,true);assert.equal(urls.length,2);assert.match(urls[1],/version=157/);
  // The local fixture only advertises older public patches; it must not pretend they are current.
  const olderOnly=structuredClone(fixture);olderOnly.versions=olderOnly.versions.filter((v:any)=>v.versionId!==158);olderOnly.page.championArguments.versionId=157;olderOnly.page.champSummary.forEach((b:any)=>b.versionId=157);
  const other=new LolpsProvider(path.join(dir,'mismatch'),(async()=>pageResponse(olderOnly)) as typeof fetch);const mismatch=await other.get(m);assert.equal(mismatch.versionMatch,false);assert.equal(mismatch.patch,'26.20');assert.match(mismatch.message,/不同/);
}));
test('failed or changed LOL.PS page never fabricates statistics or citations',async()=>temp(async dir=>{
  let calls=0;const changed=structuredClone(fixture);changed.page.championArguments.tierId=999;
  const provider=new LolpsProvider(dir,(async()=>{calls++;return pageResponse(changed);}) as typeof fetch);
  const r=await provider.get(m);assert.equal(r.status,'unavailable');assert.equal(r.source,null);assert.equal(r.sampleCount,null);assert.deepEqual(r.builds,[]);assert.ok(!withLolps(m,r).sources.some(s=>s.id==='lolps'));
  await provider.get(m);assert.equal(calls,1);
  const unknown=structuredClone(fixture);unknown.page.champSummary[0].mainRune1=999999;unknown.page.champSummary[0].coreItemIdList=[999999];
  const provider2=new LolpsProvider(path.join(dir,'missing'),(async()=>pageResponse(unknown)) as typeof fetch);const r2=await provider2.get(m);assert.equal(r2.builds[0].runes[0].available,false);assert.equal(r2.builds[0].coreItems[0].available,false);
}));
test('optional LOL.PS API and model integration pass retrieved data, sources and cache identity',async()=>temp(async dir=>{
  const provider=new LolpsProvider(path.join(dir,'cache'),(async()=>pageResponse()) as typeof fetch);const ref=await provider.get(m);let gets=0;let modelCalls=0;const bodies:any[]=[];
  const settings={baseUrl:'https://example.test/v1',model:'test',apiKey:'private-test-key'};
  const fetcher=(async(_url:any,init:any)=>{modelCalls++;bodies.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({headline:'按统计与机制选择',actions:['常规基石参考致命节奏。'],explanation:'整体统计需结合当前对手，不代表单杀胜率。',sourceIds:['lolps','yasuo']})}}]}));}) as typeof fetch;
  const app=await createApp({configDir:dir,staticFiles:false,fetcher,lolps:{get:async()=>{gets++;return ref;}}});
  try{
    const input={enemy:'Ahri',version:m.version};const preview=await app.inject({method:'POST',url:'/api/references/lolps',payload:input});assert.equal(preview.statusCode,200);assert.equal(preview.json().sampleCount,17365);assert.equal(modelCalls,0);
    await app.inject({method:'PUT',url:'/api/settings',payload:settings});
    const r=await app.inject({method:'POST',url:'/api/advice',payload:{...input,useLolps:true,question:'符文出装怎么选？'}});assert.equal(r.statusCode,200);assert.ok(r.json().sources.some((s:any)=>s.id==='lolps'));assert.equal(r.json().reference.sampleCount,17365);assert.equal(gets,2);
    assert.match(bodies[0].messages[1].content,/5308/);assert.match(bodies[0].messages[0].content,/整体统计不能冒充当前对位/);assert.ok(!r.body.includes(settings.apiKey));
    const enriched=withLolps(m,ref);assert.equal(coachFacts(enriched).lolps?.sampleCount,17365);assert.notEqual(cacheKey(settings,m,'','',[]),cacheKey(settings,enriched,'','',[]));
    assert.notEqual(cacheKey(settings,enriched,'','',[]),cacheKey(settings,withLolps(m,{...ref,fetchedAt:'2026-10-29T00:00:00.000Z'}),'','',[]));
    // Opting out removes the reference from facts, and rejects an unsupported LOL.PS citation.
    const local=await app.inject({method:'POST',url:'/api/advice',payload:input});assert.equal(gets,2);assert.equal(local.statusCode,502);assert.match(local.json().error,/资料包以外/);
    assert.equal((await app.inject({method:'POST',url:'/api/references/lolps',payload:{...input,version:'../secret'}})).statusCode,400);
  }finally{await app.close();}
}));
