import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { numericReport,withNumerics,evaluateCalculation } from '../server/numerics.js';
import { defaultNumericInput,NumericInputSchema } from '../shared/numerics.js';
import { matchup,snapshot,knowledge,ROOT } from '../server/data.js';
import { coachFacts,cacheKey } from '../server/ai.js';
import { createApp } from '../server/app.js';

const version='16.21.1';
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const report=async(id:string,level=6)=>numericReport(await matchup(id,version),defaultNumericInput(level));
test('all 173 champions have patch-bound cached roots, four main skill slots and source URLs',async()=>{
  const s=await snapshot(version);assert.equal(Object.keys(s.champions).length,173);
  for(const id of Object.keys(s.champions)){
    const r=await report(id);assert.equal(r.status,'ready',id);assert.equal(r.coverage,173);assert.equal(r.enemy!.id,id);assert.equal(r.player!.id,'Yasuo');
    assert.deepEqual(r.enemy!.spells.map(s=>s.slot),['Q','W','E','R'],id);assert.match(r.enemy!.source.url,/\/16\.21\/game\/data\/characters\//);
    assert.ok(r.enemy!.stats.hp!>0,id);assert.ok(!JSON.stringify(r).includes('NaN'));
  }
});
test('20 reviewed profiles produce per-component values without silent missing calculations or fake combo totals',async()=>{
  for(const g of knowledge.guides){
    const r=await report(g.enemy);assert.ok(r.components.length>=2,g.enemy);assert.ok(!r.limits.some(s=>s.includes('未计算')),g.enemy);
    for(const c of r.components){assert.ok(Number.isFinite(c.raw)&&c.raw>=0);assert.ok(Number.isFinite(c.afterResistance));assert.ok(c.note.length>0);}
    assert.ok(!('totalDamage' in r));assert.match(r.limits.join(' '),/不能直接相加/);
  }
});
test('Zed bonus AD and Annie AP, source index one and independent resistance calculations agree by hand',async()=>{
  const input=defaultNumericInput(3);input.item='1055';input.bonusAd=20;input.targetArmor=100;
  const z=await numericReport(await matchup('Zed',version),input);
  // Rank-one Zed Q = 80 + 1.0 * (10 Blade AD + 20 extra AD), excludes natural AD growth.
  near(z.components.find(c=>c.slot==='Q')!.raw,110);near(z.components.find(c=>c.slot==='Q')!.afterResistance,55);
  near(z.components.find(c=>c.slot==='E')!.raw,70+.7*30);
  input.item='1056';input.ap=100;input.targetMr=100;
  const a=await numericReport(await matchup('Annie',version),input);
  near(a.enemy!.stats.ap!,118);near(a.components.find(c=>c.slot==='Q')!.raw,80+.8*118);near(a.components.find(c=>c.slot==='Q')!.afterResistance,(80+.8*118)/2);
  near(a.components.find(c=>c.slot==='W')!.raw,70+.8*118);
});
test('mixed damage, multiplier references, per-sphere, channel duration and mutually exclusive branches stay explicit',async()=>{
  const input=defaultNumericInput(6);input.bonusAd=30;input.targetArmor=100;input.targetMr=0;
  const y=await numericReport(await matchup('Yone',version),input);const r=y.components.filter(c=>c.slot==='R');
  near(r[0].raw,(200+.8*30)/2);near(r[1].raw,112);near(r[0].afterResistance,56);near(r[1].afterResistance,112);
  const s=await report('Syndra');near(s.components.find(c=>c.slot==='R')!.raw,80);assert.match(s.components.find(c=>c.slot==='R')!.note,/每球伤害/);
  const a=await report('Anivia');near(a.components.find(c=>c.label==='E 未强化')!.raw,55);near(a.components.find(c=>c.label==='E 强化')!.raw,110);assert.match(a.components.find(c=>c.label==='E 强化')!.note,/不能两行相加/);
  const m=await report('Malzahar');near(m.components.find(c=>c.slot==='R')!.raw,125);assert.match(m.components.find(c=>c.slot==='R')!.note,/2.5 秒完整引导/);assert.match(m.limits.join(' '),/R 地面池/);
});
test('unknown champions, old patches and unsupported formula nodes never reuse a reviewed hero damage model',async()=>{
  const g=await report('Garen');assert.equal(g.status,'ready');assert.deepEqual(g.components,[]);assert.match(g.limits[0],/尚未核查/);
  const old=await numericReport(await matchup('Zed','16.20.1'));assert.equal(old.status,'versionMismatch');assert.equal(old.enemy,null);assert.deepEqual(old.components,[]);
  const fake={calculations:{Damage:{__type:'GameCalculation',mFormulaParts:[{__type:'UnknownCalculationPart'}]}}};
  assert.throws(()=>evaluateCalculation(fake,'Damage',{rank:1,level:3,stats:{}}),/未解析节点/);
  for(const level of [1,2,3,6,11,16,18])assert.equal(NumericInputSchema.safeParse(defaultNumericInput(level)).success,true);
  const bad=defaultNumericInput(1);bad.ranks.R=1;assert.equal(NumericInputSchema.safeParse(bad).success,false);
});
test('API works offline without key, includes numerical facts for AI, and cache separates custom stats',async()=>{
  const parent=path.join(ROOT,'.local');await mkdir(parent,{recursive:true});const dir=await mkdtemp(path.join(parent,'numeric-test-'));let body:any;
  const app=await createApp({configDir:dir,staticFiles:false,fetcher:(async(_url,init)=>{body=JSON.parse(init!.body as string);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({headline:'Q 的分项伤害',actions:['基础80加额外攻击力'],explanation:'此处不是全连招。',sourceIds:['numeric-Zed']})}}]}));}) as typeof fetch});
  try{
    const input=defaultNumericInput(3);input.bonusAd=20;
    const r=await app.inject({method:'POST',url:'/api/numerics',payload:{enemy:'Zed',version,numeric:input}});assert.equal(r.statusCode,200);near(r.json().components.find((c:any)=>c.slot==='Q').raw,100);
    assert.equal((await app.inject({method:'POST',url:'/api/numerics',payload:{enemy:'../Zed',version}})).statusCode,400);
    const bad=structuredClone(input);bad.ap=NaN;assert.equal((await app.inject({method:'POST',url:'/api/numerics',payload:{enemy:'Zed',version,numeric:bad}})).statusCode,400);
    const settings={baseUrl:'https://example.test/v1',apiKey:'test-secret',model:'test'};await app.inject({method:'PUT',url:'/api/settings',payload:settings});
    const answer=await app.inject({method:'POST',url:'/api/advice',payload:{enemy:'Zed',version,numeric:input,question:'Q 多少伤害？'}});assert.equal(answer.statusCode,200);
    assert.match(body.messages[1].content,/"numerics":\{"status":"ready"/);assert.match(body.messages[1].content,/"bonusAd":20/);assert.match(body.messages[0].content,/禁止直接相加/);assert.ok(!answer.body.includes(settings.apiKey));
    const m=await matchup('Zed',version);const a=withNumerics(m,await numericReport(m,input)),b=withNumerics(m,await numericReport(m));assert.notEqual(cacheKey(settings,a,'','',[]),cacheKey(settings,b,'','',[]));assert.equal(coachFacts(a).numerics!.enemy!.id,'Zed');
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
