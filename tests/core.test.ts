import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, snapshot, versions, matchup, knowledge, loadouts, buildGroups, runePages } from '../server/data.js';
import { createApp } from '../server/app.js';
import { Coach, endpoint, parseAdvice, cacheKey, transportIssue, coachFacts } from '../server/ai.js';
import { SettingsInput } from '../shared/schema.js';

const version=(await versions())[0];
const ahri=await matchup('Ahri',version);
const settings={baseUrl:'https://example.test/v1',model:'test-model',apiKey:'secret-test-key'};
const valid={headline:'先躲魅惑，再借兵线换血',actions:['把风墙留给魅惑。','留下撤退小兵。'],explanation:'对方关键控制落空后再接近。',sourceIds:['ddragon','mechanics']};
const response=(content:unknown,status=200)=>new Response(JSON.stringify(content),{status,headers:{'Content-Type':'application/json'}});
const completion=(content=JSON.stringify(valid))=>response({choices:[{message:{content}}]});
async function withApp(fn:(app:Awaited<ReturnType<typeof createApp>>,dir:string)=>Promise<void>,opts:Parameters<typeof createApp>[0]={}){
  const parent=path.join(ROOT,'.local');await mkdir(parent,{recursive:true});const dir=await mkdtemp(path.join(parent,'test-'));
  const app=await createApp({configDir:dir,staticFiles:false,...opts});
  try{await fn(app,dir);}finally{await app.close();assert.ok(dir.startsWith(parent+path.sep));await rm(dir,{recursive:true,force:true});}
}
test('bundled data includes all champions, 20 complete distinct guides and valid offline images',async()=>{
  const s=await snapshot(version);assert.ok(Object.keys(s.champions).length>=170);assert.equal(knowledge.guides.length,20);assert.equal(new Set(knowledge.guides.map(g=>g.enemy)).size,20);
  for(const c of Object.values(s.champions)){assert.equal(c.spells.length,4);await access(path.join(ROOT,'public',c.image));for(const spell of c.spells){assert.ok(!spell.description.includes('{{'));await access(path.join(ROOT,'public',spell.image));}}
  for(const g of knowledge.guides){const m=await matchup(g.enemy,version);assert.equal(m.refined,true);assert.equal(m.guide.reminders.length,3);assert.equal(m.guide.phases.length,4);assert.ok(m.sources.some(s=>s.id==='mechanics'&&s.patch==='15.9.1'));assert.match(m.verification,/未完成/);
    for(const t of g.threats)assert.ok(m.enemy.spells.some(s=>s.slot===t.slot));
    for(const page of m.runePages){assert.deepEqual(page.missing,[]);assert.equal(page.primary.length,4);assert.equal(page.secondary.length,2);for(const r of [...page.primary,...page.secondary])await access(path.join(ROOT,'public',r.image));}
    for(const b of m.builds){assert.deepEqual(b.missing,[]);for(const i of b.items){assert.equal(i.purchasable,true);assert.equal(i.maps['11'],true);await access(path.join(ROOT,'public',i.image));}}
  }
});
test('basic fallback never invents windwall claims or matchup statistics',async()=>{const m=await matchup('Garen',version);assert.equal(m.refined,false);assert.deepEqual(m.guide.threats,[]);assert.match(m.statsStatus,/尚未接入/);assert.match(m.guide.summary,/尚未精修/);});
test('dangerous windwall misconceptions are excluded',async()=>{
  const wall=async(id:string,slot:string)=>(await matchup(id,version)).guide.threats.find(t=>t.slot===slot)!;
  assert.equal((await wall('Ahri','E')).wall,'可挡');assert.equal((await wall('Annie','Q')).wall,'可挡');assert.equal((await wall('Annie','W')).wall,'不可挡');assert.equal((await wall('Annie','R')).wall,'不可挡');
  assert.equal((await wall('Zed','W')).wall,'不可挡');assert.equal((await wall('Zed','R')).wall,'不可挡');assert.equal((await wall('Malzahar','R')).wall,'不可挡');
  assert.match((await matchup('Malzahar',version)).guide.summonerNote,/不要.*净化/);assert.equal((await wall('Yone','Q')).wall,'部分可挡');assert.match((await wall('Yone','Q')).interaction,/本体/);
  assert.match((await wall('Fizz','R')).interaction,/鲨鱼区域/);assert.match((await wall('Viktor','E')).interaction,/余震/);assert.equal((await wall('Orianna','Q')).wall,'待核查');
});
test('Yasuo Q and E explain special cooldown rules',()=>{assert.match(ahri.player.spells[0].special!,/攻速/);assert.match(ahri.player.spells[2].special!,/并非再次 E 同一目标/);assert.equal(ahri.player.spells[2].cooldown?.[0],0.5);});
test('matchup loadouts include lethal tempo, bow and priced alternative starting bundles',async()=>{
  assert.deepEqual(Object.keys(loadouts.matchups).sort(),knowledge.guides.map(g=>g.enemy).sort());
  for(const g of knowledge.guides){const m=await matchup(g.enemy,version);assert.equal(m.runePages[0].primary[0].key,'LethalTempo');assert.equal(m.runePages[1].primary[0].key,'FleetFootwork');assert.ok(m.knowledgeRevision.includes(loadouts.revision));
    const starts=m.builds.filter(b=>b.kind==='starter');assert.equal(starts.length,2);
    for(const b of starts){assert.equal(b.totalGold,500);assert.equal(b.budgetValid,true);assert.equal(b.items.filter(i=>i.id!=='2003').length,1);assert.equal(b.totalGold,b.items.reduce((total,i)=>total+i.gold*b.quantities![i.id],0));}
  }
  const bow=ahri.builds[0];assert.equal(bow.items[0].id,'1086');assert.equal(bow.items[0].stats.PercentAttackSpeedMod,0.15);assert.equal(bow.quantities!['2003'],2);
  assert.equal(ahri.builds[1].items[0].id,'1054');assert.equal(ahri.builds[1].quantities!['2003'],1);
  const viktor=await matchup('Viktor',version);assert.equal(viktor.builds[0].items[0].id,'1054');assert.equal(viktor.builds[1].items[0].id,'1086');assert.equal(viktor.runePages[0].primary[0].key,'LethalTempo');
  const fizz=await matchup('Fizz',version);assert.equal(fizz.builds[0].items[0].id,'1055');assert.equal(fizz.runePages[0].secondary[0].key,'BonePlating');assert.equal(ahri.runePages[0].secondary[0].key,'SecondWind');
});
test('different patch availability and prices never silently produce a valid incomplete starter',async()=>{
  const s=structuredClone(await snapshot(version));delete s.items['1086'];
  let b=buildGroups(s,ahri.guide,loadouts.matchups.Ahri)[0];assert.deepEqual(b.missing,['1086']);assert.equal(b.totalGold,null);assert.equal(b.budgetValid,false);assert.deepEqual(b.items,[]);
  s.runes=s.runes.filter(r=>r.key!=='LethalTempo');const pages=runePages(s,loadouts.matchups.Ahri);assert.deepEqual(pages[0].missing,['LethalTempo']);assert.ok(!pages[0].primary.some(r=>r.key==='Conqueror'));
  const priced=structuredClone(await snapshot(version));priced.items['1086'].gold=600;b=buildGroups(priced,ahri.guide,loadouts.matchups.Ahri)[0];assert.equal(b.budgetValid,false);assert.equal(b.quantities!['2003'],undefined);
  priced.items['1086'].gold=450;b=buildGroups(priced,ahri.guide,loadouts.matchups.Ahri)[0];assert.equal(b.budgetValid,true);assert.equal(b.quantities!['2003'],1);assert.equal(b.totalGold,500);
});
test('API serves bundled data and rejects invalid version and champion paths',async()=>withApp(async app=>{
  assert.equal((await app.inject('/api/meta')).statusCode,200);assert.equal((await app.inject(`/api/champions?version=${version}`)).json().length,173);
  assert.equal((await app.inject(`/api/matchup?enemy=Ahri&version=${version}`)).json().enemy.id,'Ahri');
  assert.equal((await app.inject('/api/matchup?enemy=Ahri&version=../../secret')).statusCode,400);
  assert.equal((await app.inject('/api/matchup?enemy=Ahri&version=1.1.1')).statusCode,404);
  assert.equal((await app.inject(`/api/matchup?enemy=NotReal&version=${version}`)).statusCode,404);
}));
test('keys stay server-side; changing provider requires re-entering key; clear removes key',async()=>withApp(async app=>{
  let r=await app.inject({method:'PUT',url:'/api/settings',payload:settings});assert.equal(r.statusCode,200);assert.equal(r.json().hasKey,true);assert.ok(!r.body.includes(settings.apiKey));
  r=await app.inject('/api/settings');assert.ok(!r.body.includes(settings.apiKey));assert.equal(r.json().hasKey,true);
  r=await app.inject({method:'PUT',url:'/api/settings',payload:{baseUrl:'https://different.test/v1',model:'x'}});assert.equal(r.statusCode,400);
  r=await app.inject({method:'PUT',url:'/api/settings',payload:{baseUrl:settings.baseUrl,model:'x',clearKey:true}});assert.equal(r.statusCode,200);assert.equal(r.json().hasKey,false);
  assert.equal((await app.inject('/.local/settings.json')).statusCode,404);
}));
test('cross-site writes and DNS rebinding host are rejected',async()=>withApp(async app=>{
  assert.equal((await app.inject({method:'PUT',url:'/api/settings',headers:{origin:'https://evil.test'},payload:settings})).statusCode,403);
  assert.equal((await app.inject({url:'/api/settings',headers:{host:'evil.test:3210'}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/settings',headers:{'sec-fetch-site':'cross-site'}})).statusCode,403);
}));
test('base URL validation permits local services but rejects insecure remote and credential URLs',()=>{
  assert.equal(SettingsInput.safeParse({...settings,baseUrl:'http://localhost:9999/v1'}).success,true);
  for(const baseUrl of ['http://remote.test/v1','https://user:pass@test.example/v1','https://test.example/v1?key=secret','file:///tmp/key'])assert.equal(SettingsInput.safeParse({...settings,baseUrl}).success,false);
  assert.equal(endpoint('https://a.test/v1/'),'https://a.test/v1/chat/completions');assert.equal(endpoint('https://a.test/v1/chat/completions'),'https://a.test/v1/chat/completions');
});
test('missing AI config has a clear error and keeps base guide available',async()=>withApp(async app=>{
  const r=await app.inject({method:'POST',url:'/api/advice',payload:{enemy:'Ahri',version}});assert.equal(r.statusCode,400);assert.match(r.json().error,/先在设置/);assert.equal((await app.inject(`/api/matchup?enemy=Ahri&version=${version}`)).statusCode,200);
}));
test('AI sends context and history, uses structured schema, and caches identical requests',async()=>{
  let calls=0;let body:any;const coach=new Coach((async(_url,init)=>{calls++;body=JSON.parse(init!.body as string);return completion();}) as typeof fetch);
  const history=[{role:'user',content:'如何补刀？'}];const a=await coach.analyze(settings,ahri,'稳住发育','如何换血？',history);assert.equal(a.cached,false);assert.equal(body.response_format.type,'json_schema');assert.match(body.messages[1].content,/稳住发育/);assert.match(body.messages[1].content,/如何补刀/);
  assert.equal(body.response_format.json_schema.schema.properties.actions.maxItems,5);assert.equal(body.stream,false);
  assert.ok(body.messages.at(-1).content.startsWith('当前问题（本次回答的重点）：\n如何换血？\n'));assert.match(body.messages.at(-1).content,/只返回一个 JSON 对象/);
  assert.match(body.messages[0].content,/优先直接回答当前问题/);
  assert.equal((await coach.analyze(settings,ahri,'稳住发育','如何换血？',history)).cached,true);assert.equal(calls,1);
  await coach.analyze(settings,ahri,'进攻','',[]);assert.equal(calls,2);
});
test('coach loads both champions raw stats and skills with source and numeric limits',async()=>{
  const facts=coachFacts(ahri);
  for(const [hero,expected,source] of [[facts.player,ahri.player,'yasuo'],[facts.enemy,ahri.enemy,'ddragon']] as const){
    assert.deepEqual(hero.stats,expected.stats);assert.equal(hero.sourceId,source);assert.deepEqual(hero.passive,expected.passive);
    assert.equal(hero.spells.length,4);assert.deepEqual(hero.spells[2].cooldown,expected.spells[2].cooldown);assert.equal(hero.spells[2].description,expected.spells[2].description);
  }
  assert.equal(facts.version,version);assert.match(facts.dataNotes.stats,/不能简单线性/);assert.match(facts.dataNotes.skills,/同一目标/);
  assert.ok(facts.statFields.some(f=>f.key==='movespeed'));assert.ok(!JSON.stringify(facts).includes('/assets/game/'));
  const zero=structuredClone(ahri);zero.enemy.spells[0].cooldown=[0,0,0,0,0];assert.equal(coachFacts(zero).enemy.spells[0].cooldown,null);
  const bodies:any[]=[];const coach=new Coach((async(_url,init)=>{bodies.push(JSON.parse(init!.body as string));return completion();}) as typeof fetch);
  await coach.analyze(settings,ahri,'狐狸 E 的基础 CD 是多少？','',[]);
  assert.ok(bodies[0].messages.at(-1).content.startsWith('当前问题（本次回答的重点）：\n狐狸 E 的基础 CD 是多少？\n'));
  await coach.analyze(settings,ahri,'容易被消耗','亚索基础移速是多少？',[{role:'user',content:'如何换血？'}]);
  assert.ok(bodies[1].messages.at(-1).content.startsWith('当前问题（本次回答的重点）：\n亚索基础移速是多少？\n'));
});
test('AI cache separates enemy, model, provider, knowledge revision and context',async()=>{
  const key=cacheKey(settings,ahri,'','',[]);
  for(const other of [cacheKey({...settings,model:'other'},ahri,'','',[]),cacheKey({...settings,baseUrl:'https://b.test'},ahri,'','',[]),cacheKey(settings,await matchup('Zed',version),'','',[]),cacheKey(settings,{...ahri,knowledgeRevision:'new'},'','',[]),cacheKey(settings,ahri,'different','',[])])assert.notEqual(key,other);
});
test('unsupported structured output falls back once to plain JSON instructions',async()=>{
  const bodies:any[]=[];const coach=new Coach((async(_url,init)=>{bodies.push(JSON.parse(init!.body as string));return bodies.length===1?response({error:'response_format json_schema is unsupported'},400):completion();}) as typeof fetch);
  const result=await coach.analyze(settings,ahri,'','',[]);assert.equal(result.advice.headline,valid.headline);assert.equal(bodies.length,2);assert.ok(!bodies[1].response_format);
});
test('bad auth is not retried, and upstream secret-bearing error bodies are not exposed',async()=>{
  let calls=0;const coach=new Coach((async()=>{calls++;return response({error:settings.apiKey},401);}) as typeof fetch);await assert.rejects(coach.analyze(settings,ahri,'','',[]),/密钥无效/);assert.equal(calls,1);
});
test('timeout, invalid JSON, malformed schema and invented sources are handled',async()=>{
  const coach=new Coach((async()=>{throw new DOMException('timeout','TimeoutError');}) as typeof fetch);await assert.rejects(coach.analyze(settings,ahri,'','',[]),/超时/);
  assert.throws(()=>parseAdvice('not json',ahri),/有效 JSON/);assert.throws(()=>parseAdvice(JSON.stringify({headline:'ok'}),ahri),/结构不完整/);assert.throws(()=>parseAdvice(JSON.stringify({...valid,sourceIds:['made-up']}),ahri),/资料包以外/);
});
test('connection test validates the full coach flow instead of accepting an arbitrary OK',async()=>{
  const bodies:any[]=[];const coach=new Coach((async(_url,init)=>{bodies.push(JSON.parse(init!.body as string));return completion();}) as typeof fetch);
  const result=await coach.test(settings,ahri);assert.equal(result.ok,true);assert.match(result.message,/对局分析和格式校验/);assert.equal(bodies[0].response_format.type,'json_schema');assert.match(bodies[0].messages[1].content,/多兰之弓/);assert.match(bodies[0].messages[1].content,/魅惑/);
  const invalid=new Coach((async()=>completion('OK')) as typeof fetch);await assert.rejects(invalid.test(settings,ahri),/有效 JSON/);
});
test('provider returning seven valid actions keeps the leading five and still validates all fields',()=>{
  const actions=Array.from({length:7},(_,i)=>`行动 ${i+1}`);assert.deepEqual(parseAdvice(JSON.stringify({...valid,actions}),ahri).actions,actions.slice(0,5));
  assert.throws(()=>parseAdvice(JSON.stringify({...valid,actions:[...actions,null]}),ahri),/结构不完整/);
  assert.throws(()=>parseAdvice(JSON.stringify({...valid,actions,sourceIds:['invented']}),ahri),/资料包以外/);
  assert.throws(()=>parseAdvice(JSON.stringify({...valid,actions:[]}),ahri),/结构不完整/);
});
test('malformed model format is repaired once under the shared deadline and source validation',async()=>{
  const bodies:any[]=[];const signals:AbortSignal[]=[];
  const coach=new Coach((async(_url,init)=>{bodies.push(JSON.parse(init!.body as string));signals.push(init!.signal as AbortSignal);return completion(bodies.length===1?'请参考致命节奏与当前版本资料。':JSON.stringify(valid));}) as typeof fetch);
  const result=await coach.analyze(settings,ahri,'','怎么选符文？',[]);assert.equal(result.advice.headline,valid.headline);assert.equal(bodies.length,2);assert.equal(signals[0],signals[1]);assert.ok(!bodies[1].response_format);assert.match(bodies[1].messages.at(-1).content,/只修复格式/);
  let calls=0;const invalid=new Coach((async()=>{calls++;return completion('invalid');}) as typeof fetch);await assert.rejects(invalid.analyze(settings,ahri,'','',[]),/有效 JSON/);assert.equal(calls,2);
  calls=0;const invented=new Coach((async()=>{calls++;return completion(JSON.stringify({...valid,sourceIds:['invented']}));}) as typeof fetch);await assert.rejects(invented.analyze(settings,ahri,'','',[]),/资料包以外/);assert.equal(calls,1);
});
test('network diagnostics inspect nested causes without leaking provider error text',()=>{
  assert.equal(transportIssue(new TypeError('fetch failed',{cause:Object.assign(new Error('private-key-or-url'),{code:'ECONNRESET'})})).retryable,true);
  assert.equal(transportIssue(new AggregateError([Object.assign(new Error(),{code:'EAI_AGAIN'})])).code,'EAI_AGAIN');
  for(const code of ['ENOTFOUND','ECONNREFUSED','CERT_HAS_EXPIRED','UND_ERR_CONNECT_TIMEOUT','UND_ERR_BODY_TIMEOUT']){
    const issue=transportIssue(Object.assign(new Error(settings.apiKey),{cause:{code}}));assert.equal(issue.retryable,false);assert.ok(!issue.message.includes(settings.apiKey));
  }
  assert.equal(transportIssue({cause:{code:'UND_ERR_BODY_TIMEOUT'}}).code,'TIMEOUT');
  assert.ok(!transportIssue(new TypeError(`fetch failed ${settings.apiKey}`)).message.includes(settings.apiKey));
});
test('connection reset retries once, including a disconnect while reading the response body',async()=>{
  for(const bodyFailure of [false,true]){
    let calls=0;const bodies:string[]=[];
    const coach=new Coach((async(_url,init)=>{calls++;bodies.push(init!.body as string);if(calls===1){const e=new TypeError('fetch failed',{cause:{code:'UND_ERR_SOCKET'}});if(bodyFailure)return new Response(new ReadableStream({start(controller){controller.error(e);}}));throw e;}return completion();}) as typeof fetch);
    const result=await coach.analyze(settings,ahri,'','',[]);assert.equal(result.advice.headline,valid.headline);assert.equal(calls,2);assert.equal(bodies[0],bodies[1]);
  }
});
test('retry limit is shared with schema fallback and persistent resets produce a useful safe error',async()=>{
  let calls=0;const coach=new Coach((async()=>{calls++;if(calls===1)return response({error:'json_schema unsupported'},400);throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});}) as typeof fetch);
  await assert.rejects(coach.analyze(settings,ahri,'','',[]),e=>{assert.match((e as Error).message,/ECONNRESET/);assert.match((e as Error).message,/自动重试一次/);return true;});assert.equal(calls,3);
});
test('gateway failures retry once; rate limit, TLS and timeout do not retry',async()=>{
  let calls=0;const gateway=new Coach((async()=>{calls++;return calls===1?response({},503):completion();}) as typeof fetch);assert.equal((await gateway.analyze(settings,ahri,'','',[])).advice.headline,valid.headline);assert.equal(calls,2);
  for(const failure of [()=>response({},429),()=>{throw new TypeError('fetch failed',{cause:{code:'CERT_HAS_EXPIRED'}});},()=>{throw new TypeError('fetch failed',{cause:{code:'UND_ERR_BODY_TIMEOUT'}});}]){
    let attempts=0;const coach=new Coach((async()=>{attempts++;return failure();}) as typeof fetch);await assert.rejects(coach.analyze(settings,ahri,'','',[]));assert.equal(attempts,1);
  }
});
test('deadline covers body reads and retries use the same signal; truncated output is identified',async()=>{
  let calls=0;const signals:AbortSignal[]=[];const coach=new Coach((async(_url,init)=>{calls++;signals.push(init!.signal as AbortSignal);if(calls===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});return completion();}) as typeof fetch);
  await coach.analyze(settings,ahri,'','',[]);assert.equal(signals[0],signals[1]);
  const timeout=new Coach((async(_url,init)=>{await new Promise(r=>setTimeout(r,15));init!.signal!.throwIfAborted();return completion();}) as typeof fetch,1);await assert.rejects(timeout.analyze(settings,ahri,'','',[]),/超时/);
  const truncated=new Coach((async()=>response({choices:[{finish_reason:'length',message:{content:JSON.stringify(valid)}}]})) as typeof fetch);await assert.rejects(truncated.analyze(settings,ahri,'','',[]),/截断/);
});
test('coach context retains current mechanics and build facts while excluding local image paths',()=>{
  const facts=coachFacts(ahri);const text=JSON.stringify(facts);assert.match(text,/多兰之弓/);assert.match(text,/致命节奏/);assert.match(text,/未完成/);assert.match(text,/E 魅惑/);assert.ok(!text.includes('/assets/game/'));assert.ok(Buffer.byteLength(text)<Buffer.byteLength(JSON.stringify(ahri)));assert.equal(facts.builds[0].quantities!['2003'],2);
});
test('settings test route and analysis route both accept provider-compatible replies after a reset',async()=>{
  let calls=0;const actions=Array.from({length:7},(_,i)=>`建议 ${i+1}`);
  await withApp(async app=>{
    await app.inject({method:'PUT',url:'/api/settings',payload:settings});
    const checked=await app.inject({method:'POST',url:'/api/settings/test',payload:{}});assert.equal(checked.statusCode,200);assert.match(checked.json().message,/格式校验/);assert.equal(calls,2);
    const analyzed=await app.inject({method:'POST',url:'/api/advice',payload:{enemy:'Ahri',version,context:'稳住发育'}});assert.equal(analyzed.statusCode,200);assert.deepEqual(analyzed.json().advice.actions,actions.slice(0,5));assert.equal(calls,3);assert.ok(!analyzed.body.includes(settings.apiKey));
  },{fetcher:(async()=>{calls++;if(calls===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});return completion(JSON.stringify({...valid,actions}));}) as typeof fetch});
});
test('failed data update keeps existing snapshot available',async()=>withApp(async app=>{
  const r=await app.inject({method:'POST',url:'/api/data/update',payload:{}});assert.equal(r.statusCode,202);assert.equal(r.json().state,'running');
  let current=r.json();for(let i=0;i<100&&current.state==='running';i++){await new Promise(r=>setTimeout(r,5));current=(await app.inject('/api/data/update')).json();}
  assert.equal(current.state,'error');assert.match(current.message,/缓存和攻略仍可使用/);assert.equal((await app.inject(`/api/matchup?enemy=Ahri&version=${version}`)).statusCode,200);
},{sync:async()=>{throw new Error('offline');}}));
