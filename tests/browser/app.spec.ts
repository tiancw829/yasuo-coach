import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { LolpsReference } from '../../shared/schema.js';
const artifacts=path.resolve('..','..','work','browser-qa');
test('offline core, champion search, skill details and loadout',async({page})=>{
  const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:3210')?route.continue():route.abort());
  await page.goto('/');await expect(page.getByRole('heading',{name:/别用第一段 E/})).toBeVisible();
  await mkdir(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'选择对方英雄'}).click();await page.getByRole('textbox',{name:'搜索英雄'}).fill('Annie');await page.getByRole('dialog').getByRole('button',{name:/安妮/}).click();
  await expect(page.getByRole('heading',{name:/盯安妮的被动/})).toBeVisible();await expect(page.locator('.threat-card').filter({hasText:'提伯斯'}).getByText('不可挡',{exact:true})).toBeVisible();
  await page.locator('.tab-bar').getByRole('button',{name:'技能档案'}).click();await page.getByRole('button',{name:'我方 · 亚索'}).click();await expect(page.getByText(/并非再次 E 同一目标/)).toBeVisible();
  await page.locator('.tab-bar').getByRole('button',{name:'符文与装备'}).click();await expect(page.getByRole('heading',{name:'带着理由选符文'})).toBeVisible();await expect(page.getByText('迅捷步法',{exact:true})).toBeVisible();
  const broken=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!(i as HTMLImageElement).complete||(i as HTMLImageElement).naturalWidth===0).map(i=>i.getAttribute('src')));expect(broken).toEqual([]);expect(failures).toEqual([]);
});
test('fallback and empty search are honest',async({page})=>{
  await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();await page.getByRole('button',{name:'选择对方英雄'}).click();await page.getByRole('textbox',{name:'搜索英雄'}).fill('不存在的英雄');await expect(page.getByText('没有找到这个英雄，试试中文名称或英文名。')).toBeVisible();await page.getByRole('textbox',{name:'搜索英雄'}).fill('Garen');await page.getByRole('dialog').getByRole('button',{name:/盖伦/}).click();await expect(page.getByText(/尚未精修 · 以下/)).toBeVisible();await expect(page.getByRole('heading',{name:'这位对手的交互还在整理'})).toBeVisible();
});
test('lethal tempo and bow quantities are visible, with matchup-specific defensive alternatives',async({page})=>{
  await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();await page.locator('.tab-bar').getByRole('button',{name:'符文与装备'}).click();
  await expect(page.locator('.rune-card.recommended').getByText('致命节奏',{exact:true})).toBeVisible();
  const start=page.locator('.build-row').filter({has:page.getByRole('heading',{name:'出门 · 本局起点'})});
  await expect(start.getByText('多兰之弓',{exact:true})).toBeVisible();await expect(start.getByText('生命药水 ×2',{exact:true})).toBeVisible();await expect(start.getByText('合计 500 / 500 金币',{exact:true})).toBeVisible();await expect(start.locator('.starter-stats')).toContainText('15%攻击速度');
  const bow=start.getByRole('img',{name:'多兰之弓'});await expect(bow).toBeVisible();expect(await bow.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'选择对方英雄'}).click();await page.getByRole('textbox',{name:'搜索英雄'}).fill('Viktor');await page.getByRole('dialog').getByRole('button',{name:/维克托/}).click();
  await expect(start.getByText('多兰之盾',{exact:true})).toBeVisible();await expect(page.locator('.rune-card.recommended').getByText('致命节奏',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await expect(start.locator('.starter-stats')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('AI settings, request, followup and hero change clear history without exposing a saved key',async({page})=>{
  let saved:any;const requests:any[]=[];
  await page.route('**/api/settings',async route=>{if(route.request().method()==='PUT'){saved=route.request().postDataJSON();await route.fulfill({json:{baseUrl:saved.baseUrl,model:saved.model,hasKey:true}});}else await route.fulfill({json:{baseUrl:'',model:'',hasKey:false}});});
  await page.route('**/api/settings/test',route=>route.fulfill({json:{ok:true,message:'连接成功，模型已返回文字响应。'}}));
  await page.route('**/api/advice',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{advice:{headline:'先让魅惑落空',actions:['保留风墙。','留下撤退小兵。'],explanation:'测试响应：依据当前对局资料。',sourceIds:['ddragon']},cached:false,model:'test-model'}});});
  await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();await page.locator('.topbar').getByRole('button',{name:'AI 设置'}).click();await page.getByLabel('Base URL').fill('https://example.test/v1');await page.getByLabel('模型名称').fill('test-model');await page.getByLabel('API Key').fill('test-secret');await page.getByRole('button',{name:'保存并测试连接'}).click();await expect(page.getByRole('status')).toContainText('连接成功');await expect(page.getByLabel('API Key')).toHaveValue('');await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();await page.getByLabel('这局你想解决什么？').fill('狐狸 E 各技能等级基础 CD 是多少？');await page.getByRole('button',{name:'回答问题',exact:true}).click();await expect(page.getByRole('heading',{name:'先让魅惑落空'})).toBeVisible();await page.getByRole('textbox',{name:'继续追问'}).fill('她不交魅惑呢？');await page.getByRole('button',{name:'追问',exact:true}).click();await expect(page.getByRole('heading',{name:'先让魅惑落空'})).toHaveCount(2);expect(requests[0].question).toBe('狐狸 E 各技能等级基础 CD 是多少？');expect(requests[0].context).toBe('');await expect(page.getByText('你：狐狸 E 各技能等级基础 CD 是多少？',{exact:true})).toBeVisible();expect(requests[1].question).toBe('她不交魅惑呢？');expect(requests[1].history.length).toBe(2);expect(requests[1].history[0].content).toBe(requests[0].question);
  await page.getByRole('button',{name:'选择对方英雄'}).click();await page.getByRole('textbox',{name:'搜索英雄'}).fill('Zed');await page.getByRole('dialog').getByRole('button',{name:/影流之主/}).click();await expect(page.getByRole('heading',{name:'先让魅惑落空'})).toHaveCount(0);await page.getByRole('button',{name:'分析这局',exact:true}).click();await expect(page.getByRole('heading',{name:'先让魅惑落空'})).toBeVisible();expect(requests[2].enemy).toBe('Zed');expect(requests[2].history).toEqual([]);expect(requests[2].context).toBe('');
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('test-secret');expect(saved.model).toBe('test-model');
});
test('coach data preview contains both champions stats and skill rules without calling AI',async({page})=>{
  let aiCalls=0;await page.route('**/api/advice',r=>{aiCalls++;return r.abort();});
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();
  const version=await page.getByRole('combobox',{name:'数据版本'}).inputValue();const m=await (await page.request.get(`/api/matchup?enemy=Ahri&version=${version}`)).json();
  await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();await page.locator('.coach-data>summary').click();
  await expect(page.locator('.coach-data>section')).toHaveCount(2);
  for(const [index,hero] of [m.player,m.enemy].entries()){
    const section=page.locator('.coach-data>section').nth(index);await expect(section.getByText('移动速度',{exact:true})).toBeVisible();
    await expect(section.locator('.stat-table>div').filter({has:page.getByText('移动速度',{exact:true})}).locator('b')).toHaveText(String(hero.stats.movespeed));
    await expect(section.getByRole('heading',{name:`E · ${hero.spells[2].name}`,exact:true})).toBeVisible();
  }
  await expect(page.locator('.coach-data')).toContainText('并非再次 E 同一目标');expect(aiCalls).toBe(0);
  await page.getByRole('button',{name:'符文出装策略',exact:true}).click();await expect(page.getByLabel('这局你想解决什么？')).toHaveValue(new RegExp(`对线${m.enemy.name}.*符文与出装策略`));
  await page.getByRole('button',{name:'全技能对拼与小兵影响',exact:true}).click();await expect(page.getByLabel('这局你想解决什么？')).toHaveValue(/全技能对拼.*小兵影响.*1、2、3、6 级.*缺失项/);
  await page.getByRole('button',{name:'对线策略',exact:true}).click();await expect(page.getByLabel('这局你想解决什么？')).toHaveValue(new RegExp(`对线${m.enemy.name}.*具体对线策略`));expect(aiCalls).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('LOL.PS preview, attributed answer and opt out work on mobile',async({page})=>{
  const requests:any[]=[];let previews=0;
  const source={id:'lolps',label:'LOL.PS · 亚索中路 · 26.21',url:'https://lol.ps/cn/champ/157?region=0&tier=2&lane=2',patch:'26.21',checkedAt:'2026-10-28'};
  const reference:LolpsReference={status:'ready',message:'已加载 LOL.PS 公开统计。',fetchedAt:'2026-10-28T08:00:00.000Z',source,patch:'26.21',requestedPatch:'26.21',versionMatch:true,region:'韩服',tier:'翡翠及以上',lane:'中路',timeRange:'公开页未提供精确采样起止时间',sampleCount:17365,overallWinRate:49.49,matchup:null,
    builds:[{label:'大众性套路',runes:[{id:8008,name:'致命节奏',available:true}],shards:[5005,5008,5001],startingItems:[{id:1086,name:'多兰之弓',available:true},{id:2003,name:'生命药水',available:true,quantity:2}],boots:{id:3006,name:'狂战士胫甲',available:true},coreItems:[{id:6673,name:'不朽盾弓',available:true}],runeStats:{winRate:46.29,pickRate:34.02,sampleCount:5308},startingStats:{winRate:49.96,pickRate:90.64,sampleCount:15609},coreCombinations:[],skillOrder:['Q','E','W'],skillPriority:['Q','E','W']}],limits:['整体中路统计不能称为当前对位最优方案。']};
  await page.route('**/api/references/lolps',r=>{previews++;return r.fulfill({json:reference});});
  await page.route('**/api/advice',r=>{const input=r.request().postDataJSON();requests.push(input);return r.fulfill({json:{advice:{headline:'统计与机制结合选择',actions:['优先考虑适合换血的方案。'],explanation:'整体中路统计供参考。',sourceIds:input.useLolps?['lolps']:['yasuo']},model:'test',cached:false,sources:input.useLolps?[source]:undefined,reference:input.useLolps?reference:null}});});
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();
  const section=page.getByRole('region',{name:'LOL.PS 参考资料'});await expect(section.getByRole('checkbox')).toBeChecked();expect(previews).toBe(0);
  await section.getByRole('button',{name:'加载参考'}).click();await expect(section).toContainText('英雄总样本 17,365 场');await expect(section).toContainText('公开摘要没有当前对手');
  await section.getByText('查看来源方案与适用限制').click();await expect(section).toContainText('生命药水 ×2');await expect(section).toContainText('5,308 场');expect(requests.length).toBe(0);
  await page.getByRole('button',{name:'符文出装策略',exact:true}).click();await page.getByRole('button',{name:'回答问题',exact:true}).click();await expect(page.locator('.answer-card')).toHaveCount(1);expect(requests[0].useLolps).toBe(true);
  await expect(page.locator('.answer-card').getByRole('link',{name:/LOL.PS/})).toHaveAttribute('href',source.url);
  await section.getByRole('checkbox').uncheck();await page.getByRole('textbox',{name:'继续追问'}).fill('只用本地资料说明对线');await page.getByRole('button',{name:'追问',exact:true}).click();await expect(page.locator('.answer-card')).toHaveCount(2);expect(requests[1].useLolps).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('LOL.PS mismatch and unavailable reference keep coach usable',async({page})=>{
  let refreshes=0;
  const reference={status:'stale',message:'更新失败，正在使用上次缓存的公开统计。',fetchedAt:'2026-10-20T08:00:00.000Z',source:{id:'lolps',label:'LOL.PS',url:'https://lol.ps/cn/champ/157',patch:'26.20',checkedAt:'2026-10-20'},patch:'26.20',requestedPatch:'26.21',versionMatch:false,region:'韩服',tier:'翡翠及以上',lane:'中路',timeRange:'未提供精确采样起止时间',sampleCount:20,overallWinRate:50,matchup:null,builds:[],limits:['来源补丁不同，仅作历史参考。']};
  await page.route('**/api/references/lolps',r=>{refreshes++;return r.fulfill({json:refreshes===1?reference:{...reference,status:'unavailable',source:null,patch:null,fetchedAt:null,sampleCount:null,message:'暂时无法获取 LOL.PS 公开统计。本次使用本地资料。'}});});
  await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();const section=page.getByRole('region',{name:'LOL.PS 参考资料'});
  await section.getByRole('button',{name:'加载参考'}).click();await expect(section).toContainText('上次缓存');await section.getByText('查看来源方案与适用限制').click();await expect(section).toContainText('仅作历史参考');
  await section.getByRole('button',{name:'刷新参考'}).click();await expect(section).toContainText('暂时无法获取');await expect(section.getByRole('link')).toHaveCount(0);await expect(page.getByRole('button',{name:'分析这局',exact:true})).toBeEnabled();
});
test('numeric combat uses local formulas, updates on misses and minions, and sends scenario to AI',async({page})=>{
  let aiCalls=0;let payload:any;
  await page.route('**/api/advice',r=>{aiCalls++;payload=r.request().postDataJSON();return r.fulfill({json:{advice:{headline:'按计算器结果解释',actions:['先确认命中条件。'],explanation:'伤害由程序计算。',sourceIds:['yasuo']},model:'test',cached:false}});});
  await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();await page.getByRole('combobox',{name:'数据版本'}).selectOption('16.21.1');await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();
  const calculator=page.getByRole('region',{name:'数值对拼计算器'});await expect(calculator.locator('.combat-results')).toBeVisible();expect(aiCalls).toBe(0);
  await calculator.getByLabel('双方英雄等级',{exact:true}).fill('1');await expect(calculator.locator('.combat-results>div').first().locator('b')).toHaveText('187.9');await expect(calculator.locator('.combat-results>div').nth(1).locator('b')).toHaveText('157.6');
  await calculator.getByLabel('双方英雄等级',{exact:true}).fill('3');await expect(calculator.locator('.combat-results')).toBeVisible();
  const before=await calculator.locator('.combat-results>div').nth(1).locator('b').innerText();await calculator.getByText('调整连招命中、技能加点与额外属性',{exact:true}).click();await calculator.getByRole('checkbox',{name:'阿狸 E 命中',exact:false}).uncheck();await expect(calculator.locator('.combat-results')).toBeVisible();expect(await calculator.locator('.combat-results>div').nth(1).locator('b').innerText()).not.toBe(before);
  await calculator.getByText('小兵影响：数量、暴露时间与实际每击伤害',{exact:true}).click();await calculator.getByLabel('敌方远程兵数量',{exact:true}).fill('3');await expect(calculator.locator('.combat-results')).toBeVisible();await calculator.getByText('小兵伤害分项',{exact:true}).click();await expect(calculator).toContainText('减伤前 117');
  await page.getByRole('checkbox',{name:'参考 LOL.PS 公开统计'}).uncheck();await page.getByRole('button',{name:'全技能对拼与小兵影响',exact:true}).click();await page.getByRole('button',{name:'回答问题',exact:true}).click();await expect(page.getByRole('heading',{name:'按计算器结果解释'})).toBeVisible();expect(payload.combat.level).toBe(3);expect(payload.combat.ahriEHit).toBe(false);expect(payload.combat.enemyMinions.ranged).toBe(3);expect(aiCalls).toBe(1);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('unsupported combat patch and opponent are explicit; invalid skill ranks do not show old results',async({page})=>{
  await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();await page.getByRole('combobox',{name:'数据版本'}).selectOption('16.21.1');await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();const calculator=page.getByRole('region',{name:'数值对拼计算器'});
  await expect(calculator.locator('.combat-results')).toBeVisible();await calculator.getByText('调整连招命中、技能加点与额外属性',{exact:true}).click();await calculator.getByLabel('亚索 Q 等级',{exact:true}).fill('5');await expect(calculator.getByRole('alert')).toContainText('技能点数超出');await expect(calculator.locator('.combat-results')).toHaveCount(0);
  await page.getByRole('combobox',{name:'数据版本'}).selectOption('16.20.1');await expect(calculator).toContainText('当前英雄或版本尚未核查');
  await page.getByRole('combobox',{name:'数据版本'}).selectOption('16.21.1');await page.getByRole('button',{name:'选择对方英雄'}).click();await page.getByRole('textbox',{name:'搜索英雄'}).fill('Zed');await page.getByRole('dialog').getByRole('button',{name:/影流之主/}).click();await expect(calculator).toContainText('当前英雄或版本尚未核查');
});
test('batch numerical data provides Zed calculations, raw skills, AI parameters and safe fallback on mobile',async({page})=>{
  let sent:any;await page.route('**/api/advice',async route=>{sent=route.request().postDataJSON();await route.fulfill({json:{advice:{headline:'按分项解释',actions:['Q 基础80加额外攻击力'],explanation:'不等于完整连招',sourceIds:['numeric-Zed']},cached:false,model:'mock'}});});
  await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();await page.getByRole('button',{name:'选择对方英雄'}).click();await page.getByRole('textbox',{name:'搜索英雄'}).fill('Zed');await page.getByRole('dialog').getByRole('button',{name:/影流之主/}).click();await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();
  const panel=page.getByRole('region',{name:'全英雄数值资料与技能分项'});await expect(panel).toContainText('已缓存 173 位英雄');await expect(panel.locator('.numeric-components')).toContainText('Q 首个目标');
  await panel.getByText('调整对手技能等级、属性与目标抗性',{exact:true}).click();await panel.getByLabel('对手额外攻击力（装备之外）').fill('20');await expect(panel.locator('.numeric-components').locator('tbody tr').first()).toContainText('100');
  await panel.getByText(/查看 .* 技能数值、加成、消耗与距离/).click();await panel.locator('.numeric-spell').first().locator('summary').first().click();await expect(panel).toContainText('BonusADRatio');
  await page.getByLabel('这局你想解决什么？').fill('劫 Q 的伤害是多少？');await page.getByRole('button',{name:'回答问题',exact:true}).click();await expect(page.locator('.answer-card')).toContainText('按分项解释');expect(sent.numeric.bonusAd).toBe(20);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'选择对方英雄'}).click();await page.getByRole('textbox',{name:'搜索英雄'}).fill('Garen');await page.getByRole('dialog').getByRole('button',{name:/盖伦/}).click();await expect(panel).toContainText('此英雄提供原始数值资料');await expect(panel.locator('.numeric-components')).toHaveCount(0);await expect(page.locator('.answer-card')).toHaveCount(0);
  await page.getByRole('combobox',{name:'数据版本'}).selectOption('16.20.1');await expect(panel).toContainText('未套用其他补丁的数值');await expect(panel.getByTestId('numeric-stats')).toHaveCount(0);
});

test('AI error, data update failure and version mismatch preserve base content',async({page})=>{
  await page.route('**/api/advice',r=>r.fulfill({status:502,json:{error:'AI 请求超时，基础攻略仍然可用。'}}));
  await page.route('**/api/data/update',r=>r.fulfill({status:502,json:{error:'暂时无法更新官方数据，已有缓存和攻略仍可使用。'}}));
  await page.route('**/api/matchup?**',async r=>{const response=await r.fetch();await r.fulfill({json:{...await response.json(),stale:true,reviewedPatch:'16.19.1'}});});
  await page.goto('/');await expect(page.getByText(/与攻略参考版本 16.19.1 不同/)).toBeVisible();await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();await page.getByRole('button',{name:'分析这局',exact:true}).click();await expect(page.getByRole('alert')).toContainText('超时');await page.locator('.tab-bar').getByRole('button',{name:'对线手册'}).click();await expect(page.locator('.strategy')).toBeVisible();await page.getByRole('button',{name:'资料说明'}).click();await page.getByRole('dialog').getByRole('button',{name:'一键升级数据'}).click();await expect(page.getByRole('dialog').getByRole('region',{name:'数据升级状态'})).toContainText('已有缓存和攻略仍可使用');
});
test('one click upgrades in background, survives refresh and selects the completed version',async({page})=>{
  const initial=await (await page.request.get('/api/meta')).json();const oldVersion=initial.versions[0];const nextVersion='99.1.1';let complete=false;let starts=0;
  let state:any={id:null,state:'idle',message:'就绪',version:null,startedAt:null,finishedAt:null};
  await page.route('**/api/meta',r=>r.fulfill({json:{...initial,versions:complete?[nextVersion,...initial.versions]:initial.versions}}));
  await page.route('**/api/data/update',async r=>{
    if(r.request().method()==='POST'){starts++;state={...state,id:'browser-upgrade',state:'running',message:'正在下载：已缓存 40/173 位英雄',startedAt:new Date().toISOString()};}
    await r.fulfill({status:r.request().method()==='POST'?202:200,json:state});
  });
  await page.route('**/api/matchup?**',async r=>{const url=new URL(r.request().url());if(url.searchParams.get('version')!==nextVersion)return r.continue();url.searchParams.set('version',oldVersion);const real=await r.fetch({url:url.toString()});await r.fulfill({json:{...await real.json(),version:nextVersion,stale:true}});});
  await page.route('**/api/champions?**',async r=>{const url=new URL(r.request().url());if(url.searchParams.get('version')!==nextVersion)return r.continue();url.searchParams.set('version',oldVersion);await r.fulfill({response:await r.fetch({url:url.toString()})});});
  await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();const button=page.locator('.topbar').getByRole('button',{name:'一键升级数据'});await button.click();
  await expect(button).toBeDisabled();await expect(page.getByRole('region',{name:'数据升级状态'})).toContainText('40/173');await expect(page.locator('.strategy')).toBeVisible();
  await page.reload();await expect(button).toBeDisabled();await expect(page.getByRole('region',{name:'数据升级状态'})).toContainText('40/173');expect(starts).toBe(1);
  complete=true;state={...state,state:'success',version:nextVersion,message:`已升级到官方数据 ${nextVersion}，旧版本已保留。`,finishedAt:new Date().toISOString()};
  await expect(page.getByRole('combobox',{name:'数据版本'})).toHaveValue(nextVersion);await expect(button).toBeEnabled();await expect(page.getByRole('combobox').locator('option')).toContainText(initial.versions.map((v:string)=>`数据 ${v}`));
  await expect(page.getByRole('region',{name:'数据升级状态'})).toContainText('风墙交互和对线攻略仍保留各自核查版本');await expect(page.getByText(new RegExp(`当前数据 ${nextVersion} 与攻略参考版本`))).toBeVisible();
  await page.setViewportSize({width:390,height:844});await expect(button).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('failed background upgrade offers retry and leaves selected version intact',async({page})=>{
  let calls=0;let state:any={id:null,state:'idle',message:'就绪',version:null,startedAt:null,finishedAt:null};const meta=await (await page.request.get('/api/meta')).json();
  await page.route('**/api/data/update',async r=>{if(r.request().method()==='POST'){calls++;state={...state,id:`retry-${calls}`,state:calls===1?'error':'success',version:calls===1?null:meta.versions[0],message:calls===1?'升级失败，已有缓存和攻略仍可使用。':`已是最新官方数据 ${meta.versions[0]}，缓存已检查。`};}await r.fulfill({status:r.request().method()==='POST'?202:200,json:state});});
  await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();const before=await page.getByRole('combobox',{name:'数据版本'}).inputValue();await page.locator('.topbar').getByRole('button',{name:'一键升级数据'}).click();
  await expect(page.getByRole('region',{name:'数据升级状态'})).toContainText('升级失败');await expect(page.getByRole('combobox',{name:'数据版本'})).toHaveValue(before);await expect(page.locator('.strategy')).toBeVisible();
  await page.getByRole('button',{name:'重试升级'}).click();await expect(page.getByRole('region',{name:'数据升级状态'})).toContainText('已是最新官方数据');expect(calls).toBe(2);
});
test('mobile layout and dialog stay within viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:path.join(artifacts,'mobile.png'),fullPage:true});await page.getByRole('button',{name:'选择对方英雄'}).click();await expect(page.getByRole('dialog')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await page.locator('.tab-bar').getByRole('button',{name:'符文与装备'}).click();await expect(page.locator('.rune-grid')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
