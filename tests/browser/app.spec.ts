import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
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
  await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();await page.getByLabel('这局你想解决什么？').fill('我想稳住发育');await page.getByRole('button',{name:'分析这局',exact:true}).click();await expect(page.getByRole('heading',{name:'先让魅惑落空'})).toBeVisible();await page.getByRole('textbox',{name:'继续追问'}).fill('她不交魅惑呢？');await page.getByRole('button',{name:'追问',exact:true}).click();await expect(page.getByRole('heading',{name:'先让魅惑落空'})).toHaveCount(2);expect(requests[1].history.length).toBe(2);
  await page.getByRole('button',{name:'选择对方英雄'}).click();await page.getByRole('textbox',{name:'搜索英雄'}).fill('Zed');await page.getByRole('dialog').getByRole('button',{name:/影流之主/}).click();await expect(page.getByRole('heading',{name:'先让魅惑落空'})).toHaveCount(0);await page.getByRole('button',{name:'分析这局',exact:true}).click();await expect(page.getByRole('heading',{name:'先让魅惑落空'})).toBeVisible();expect(requests[2].enemy).toBe('Zed');expect(requests[2].history).toEqual([]);expect(requests[2].context).toBe('');
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('test-secret');expect(saved.model).toBe('test-model');
});
test('AI error, data update failure and version mismatch preserve base content',async({page})=>{
  await page.route('**/api/advice',r=>r.fulfill({status:502,json:{error:'AI 请求超时，基础攻略仍然可用。'}}));
  await page.route('**/api/data/update',r=>r.fulfill({status:502,json:{error:'暂时无法更新官方数据，已有缓存和攻略仍可使用。'}}));
  await page.route('**/api/matchup?**',async r=>{const response=await r.fetch();await r.fulfill({json:{...await response.json(),stale:true,reviewedPatch:'16.19.1'}});});
  await page.goto('/');await expect(page.getByText(/与攻略参考版本 16.19.1 不同/)).toBeVisible();await page.locator('.tab-bar').getByRole('button',{name:'AI 教练'}).click();await page.getByRole('button',{name:'分析这局',exact:true}).click();await expect(page.getByRole('alert')).toContainText('超时');await page.locator('.tab-bar').getByRole('button',{name:'对线手册'}).click();await expect(page.locator('.strategy')).toBeVisible();await page.getByRole('button',{name:'资料说明'}).click();await page.getByRole('button',{name:'检查并更新'}).click();await expect(page.locator('.toast')).toContainText('已有缓存和攻略仍可使用');
});
test('mobile layout and dialog stay within viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.strategy')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:path.join(artifacts,'mobile.png'),fullPage:true});await page.getByRole('button',{name:'选择对方英雄'}).click();await expect(page.getByRole('dialog')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await page.locator('.tab-bar').getByRole('button',{name:'符文与装备'}).click();await expect(page.locator('.rune-grid')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
