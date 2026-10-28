import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { combatReport, growth, resistanceMultiplier, minionAttacks, withCombat } from '../server/combat.js';
import { defaultCombatInput, CombatInputSchema } from '../shared/combat.js';
import { matchup,ROOT } from '../server/data.js';
import { cacheKey,coachFacts } from '../server/ai.js';
import { createApp } from '../server/app.js';

const m=await matchup('Ahri','16.21.1');
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
test('growth, armor and magic resistance rules preserve level one and level eighteen boundaries',()=>{
  near(growth(1),0);near(growth(2),.72);near(growth(3),1.475);near(growth(6),3.95);near(growth(18),17);
  near(resistanceMultiplier(0),1);near(resistanceMultiplier(100),.5);near(resistanceMultiplier(-100),1.5);
  assert.equal(minionAttacks(0,1.25),0);assert.equal(minionAttacks(3,1.25),3);assert.equal(minionAttacks(3,.667),2);
});
test('level one independent hand calculation uses Q and two autos, and Ahri Q return ignores MR',async()=>{
  const r=await combatReport(m,defaultCombatInput(1));assert.equal(r.status,'ready');const y=r.yasuo!,a=r.ahri!;
  near(y.stats.ad,68);near(a.stats.ap,18);near(a.stats.hp,680);near(y.stats.hp,590);
  // Yasuo: 2*68 autos + (20 + 1.05*68) Q, vs 21 armor.
  near(y.raw,227.4);near(y.afterResistance,227.4*100/121);
  // Ahri: 2*53 autos vs 32 armor; Q (35 + .5*18) magic and the same as true.
  near(a.raw,194);near(a.afterResistance,106*100/132+44*100/132+44);
  const raised=defaultCombatInput(1);raised.yasuoBonus.mr=100;const high=await combatReport(m,raised);
  near(high.ahri!.lines.find(l=>l.type==='true')!.afterResistance,44);
  assert.ok(high.ahri!.lines.find(l=>l.type==='magic')!.afterResistance<a.lines.find(l=>l.type==='magic')!.afterResistance);
});
test('same-patch game data corrects DDragon missing AD growth, newer Ahri W repeat, Q and R damage',async()=>{
  const r=await combatReport(m,defaultCombatInput(6));const y=r.yasuo!,a=r.ahri!;
  assert.equal(m.player.stats.attackdamageperlevel,0);near(y.stats.baseAd,60+2.5*3.95);near(a.stats.baseAd,53+3*3.95);
  const ar=a.lines;near(ar.find(l=>l.label.startsWith('阿狸 Q 去程'))!.raw,85+9);
  near(ar.find(l=>l.label.startsWith('阿狸 W 首团'))!.raw,40+.4*18);
  near(ar.find(l=>l.label.startsWith('阿狸 W 后续'))!.raw,(40+.4*18)*.4*2);
  near(ar.find(l=>l.label.startsWith('阿狸 R'))!.raw,(75+.35*18)*3);
  near(y.lines.find(l=>l.label.startsWith('亚索 R'))!.raw,200+1.5*8);
  near(a.manaCost,75+30+60+100);
  near(y.stats.attackSpeed,.697+.67*(.15+3.5*3.95/100));
  assert.ok(r.sources.some(s=>s.url.includes('/16.21/game/data/characters/ahri/')));
});
test('E stack multiplier and bonus AD exclude natural AD growth; zero W flames means zero W damage',async()=>{
  const input=defaultCombatInput(3);input.yasuoBonus.ad=20;input.yasuoBonus.ap=30;
  const base=await combatReport(m,input);input.yasuoEStacks=4;input.ahriWFlames=0;const stacked=await combatReport(m,input);
  const e=(70+.2*28+.6*30);near(base.yasuo!.lines.find(l=>l.label.startsWith('亚索 E'))!.raw,e);near(stacked.yasuo!.lines.find(l=>l.label.startsWith('亚索 E'))!.raw,e*2);
  assert.ok(!stacked.ahri!.lines.some(l=>l.label.startsWith('阿狸 W')));assert.equal(stacked.ahri!.manaCost,base.ahri!.manaCost);
});
test('windwall/miss conditions and minion inputs change numeric results, not just prose',async()=>{
  const input=defaultCombatInput(3);const base=await combatReport(m,input);const charm=base.ahri!.lines.find(l=>l.label.startsWith('阿狸 E'))!;
  input.ahriEHit=false;const missed=await combatReport(m,input);near(base.ahri!.afterResistance-missed.ahri!.afterResistance,charm.afterResistance);
  input.enemyMinions.ranged=3;input.enemyMinions.seconds=3;const ranged=await combatReport(m,input);
  near(ranged.yasuo!.minions.raw,3*2*19.5);near(ranged.yasuo!.incoming-missed.yasuo!.incoming,117*100/(100+ranged.yasuo!.stats.armor));
  input.enemyMinions.rangedAd=30;const scaled=await combatReport(m,input);near(scaled.yasuo!.minions.raw,180);assert.ok(scaled.yasuo!.incoming>ranged.yasuo!.incoming);
});
test('illegal skill levels, rank six, unlearned hits and invalid numbers are rejected',()=>{
  for(const level of [1,2,3,6,11,16,18])assert.equal(CombatInputSchema.safeParse(defaultCombatInput(level)).success,true);
  const one=defaultCombatInput(1);one.yasuoRanks.r=1;assert.equal(CombatInputSchema.safeParse(one).success,false);
  const tooMany=defaultCombatInput(3);tooMany.ahriRanks.q=5;assert.equal(CombatInputSchema.safeParse(tooMany).success,false);
  const noQ=defaultCombatInput(3);noQ.yasuoRanks.q=0;assert.equal(CombatInputSchema.safeParse(noQ).success,false);
  const bad=defaultCombatInput();bad.yasuoBonus.ad=NaN;assert.equal(CombatInputSchema.safeParse(bad).success,false);
});
test('shield is a bound rather than permanent mitigation; minions alone cannot trigger it',async()=>{
  const input=defaultCombatInput(3);const r=await combatReport(m,input);near(r.shield!.maximum,125+475*1.475/17);near(r.shield!.maximumHpLoss,r.yasuo!.incoming);
  input.ahriAutos=0;input.ahriQOut=false;input.ahriQReturn=false;input.ahriWFlames=0;input.ahriEHit=false;input.enemyMinions.ranged=3;
  const minions=await combatReport(m,input);near(minions.shield!.minimumHpLoss,minions.shield!.maximumHpLoss);
});
test('comparisons are independently computed and unsupported heroes or patches never inherit formulas',async()=>{
  const input=defaultCombatInput(3);input.ahriEHit=false;const r=await combatReport(m,input);
  assert.equal(r.comparisons.length,4);for(const c of r.comparisons){const baseline=await combatReport(m,defaultCombatInput(c.level));near(c.yasuoDamage,baseline.yasuo!.afterResistance);near(c.ahriDamage,baseline.ahri!.afterResistance);}
  assert.equal((await combatReport(await matchup('Zed',m.version))).status,'unsupported');assert.equal((await combatReport(await matchup('Ahri','16.20.1'))).status,'unsupported');
});
test('model receives numeric report and cache separates combat inputs',async()=>{
  const one=withCombat(m,await combatReport(m,defaultCombatInput(1))),six=withCombat(m,await combatReport(m,defaultCombatInput(6)));
  const settings={baseUrl:'https://example.test/v1',apiKey:'test',model:'test'};assert.notEqual(cacheKey(settings,one,'','',[]),cacheKey(settings,six,'','',[]));
  const facts=coachFacts(six);assert.equal(facts.combat?.status,'ready');near(facts.combat!.ahri!.lines.find(l=>l.label.startsWith('阿狸 R'))!.raw,243.9);
});
test('local calculation API works without AI key, validates input and passes custom results to model',async()=>{
  const parent=path.join(ROOT,'.local');await mkdir(parent,{recursive:true});const dir=await mkdtemp(path.join(parent,'combat-test-'));let body:any;
  const app=await createApp({configDir:dir,staticFiles:false,fetcher:(async(_url,init)=>{body=JSON.parse(init!.body as string);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({headline:'按计算结果回答',actions:['先躲魅惑。'],explanation:'指定命中条件下的伤害预算。',sourceIds:['combat-ahri','combat-yasuo']})}}]}));}) as typeof fetch});
  try{
    const input=defaultCombatInput(6);input.ahriEHit=false;
    const r=await app.inject({method:'POST',url:'/api/combat',payload:{enemy:'Ahri',version:m.version,combat:input}});assert.equal(r.statusCode,200);assert.equal(r.json().status,'ready');assert.ok(!r.json().ahri.lines.some((l:any)=>l.label.startsWith('阿狸 E')));
    const invalid=structuredClone(input);invalid.yasuoRanks.q=6;assert.equal((await app.inject({method:'POST',url:'/api/combat',payload:{enemy:'Ahri',version:m.version,combat:invalid}})).statusCode,400);
    await app.inject({method:'PUT',url:'/api/settings',payload:{baseUrl:'https://example.test/v1',apiKey:'secret',model:'test'}});
    const ai=await app.inject({method:'POST',url:'/api/advice',payload:{enemy:'Ahri',version:m.version,combat:input,question:'双方伤害多少？'}});assert.equal(ai.statusCode,200);assert.match(body.messages[1].content,/"combat":\{"status":"ready"/);assert.match(body.messages[0].content,/不能再说资料完全没有伤害公式/);assert.ok(ai.json().sources.some((s:any)=>s.id==='combat-ahri'));
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
