import { parseExpressionAt } from 'acorn';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { LolpsReference, Matchup, Snapshot } from '../shared/schema.js';
import { snapshot } from './data.js';

const BASE='https://lol.ps/cn/champ/157';
const TTL=6*3600*1000;
const rate=z.union([z.number(),z.string().regex(/^\d+(?:\.\d+)?$/)]).pipe(z.coerce.number().min(0).max(100));
const count=z.number().int().min(0).max(1e9);
const ids=z.array(z.number().int().positive()).max(30);
const Args=z.object({regionId:z.literal(0),tierId:z.literal(2),laneId:z.literal(2),versionId:count});
const Build=z.object({
  championId:z.literal(157),regionId:z.literal(0),tierId:z.literal(2),laneId:z.literal(2),versionId:count,buildTypeId:z.union([z.literal(0),z.literal(1)]),
  count,winRate:rate,
  mainRune1:count,mainRune2:count,mainRune3:count,mainRune4:count,subRune1:count,subRune2:count,
  statperk1Id:count,statperk2Id:count,statperk3Id:count,
  startingItemIdList:z.array(ids).max(10),shoesId:count,coreItemIdList:ids,
  skillLv15List:z.array(z.enum(['Q','W','E','R'])).max(18),skillMasterList:z.array(z.enum(['Q','W','E','R'])).max(4),
  runeTotalWinrate:rate.nullish(),runeTotalPickrate:rate.nullish(),runeTotalCount:count.nullish(),
  startingWinrate:rate.nullish(),startingPickrate:rate.nullish(),startingCount:count.nullish(),
  counterChampionIdList:ids,counterWinrateList:z.array(rate).max(30),counterCountList:z.array(count).max(30),
  counterEasyChampionIdList:ids,counterEasyWinrateList:z.array(rate).max(30),counterEasyCountList:z.array(count).max(30),
  top1ThreeCoreIdList:ids,top1ThreeCorePickrate:rate.nullish(),top1ThreeCoreWinrate:rate.nullish(),top1ThreeCoreCount:count.nullish(),
  top2ThreeCoreIdList:ids,top2ThreeCorePickrate:rate.nullish(),top2ThreeCoreWinrate:rate.nullish(),top2ThreeCoreCount:count.nullish(),
  top3ThreeCoreIdList:ids,top3ThreeCorePickrate:rate.nullish(),top3ThreeCoreWinrate:rate.nullish(),top3ThreeCoreCount:count.nullish()
});
const VersionInfo=z.object({versionId:count,description:z.string().regex(/^\d+\.\d+$/),patchDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});
const Page=z.object({championId:z.literal(157),championArguments:Args,champSummary:z.array(Build).min(1).max(2)}).refine(p=>p.champSummary.some(b=>b.buildTypeId===0)&&new Set(p.champSummary.map(b=>b.buildTypeId)).size===p.champSummary.length&&p.champSummary.every(b=>b.versionId===p.championArguments.versionId));
const Cached=z.object({revision:z.literal(1),fetchedAt:z.string().datetime(),url:z.string().url().refine(u=>u.startsWith(BASE+'?')),patch:VersionInfo,page:Page}).refine(c=>c.patch.versionId===c.page.championArguments.versionId);
type CachedPage=z.infer<typeof Cached>;

// Decode only literal data nodes. Never execute JavaScript from the remote page.
export function publicPageData(html:string){
  if(html.length>2_000_000)throw new Error('page too large');
  const start=html.indexOf('kit.start(');const dataStart=html.indexOf('data:',start);
  if(start<0||dataStart<0)throw new Error('missing page data');
  let ast:any=parseExpressionAt(html,dataStart+5,{ecmaVersion:'latest'});
  if(ast.type==='SequenceExpression')ast=ast.expressions[0];
  let nodes=0;
  function literal(n:any,depth=0):any{
    if(!n||++nodes>150000||depth>60)throw new Error('invalid literal');
    if(n.type==='Literal'&&['string','number','boolean','object'].includes(typeof n.value)&&!n.regex&&!n.bigint)return n.value;
    if(n.type==='ArrayExpression')return n.elements.map((v:any)=>literal(v,depth+1));
    if(n.type==='ObjectExpression'){
      const result=Object.create(null);
      for(const p of n.properties){
        if(p.type!=='Property'||p.computed||p.method||p.kind!=='init')throw new Error('invalid property');
        const key=p.key.name??p.key.value;if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))throw new Error('invalid key');
        result[key]=literal(p.value,depth+1);
      }
      return result;
    }
    if(n.type==='UnaryExpression'&&n.operator==='void'&&n.argument.type==='Literal'&&n.argument.value===0)return null;
    if(n.type==='UnaryExpression'&&n.operator==='-'&&n.argument.type==='Literal'&&typeof n.argument.value==='number')return -n.argument.value;
    throw new Error('not literal data');
  }
  const data=literal(ast);if(!Array.isArray(data))throw new Error('invalid data');
  const rows=data.flatMap(r=>r?.type==='data'&&r.data&&typeof r.data==='object'?[r.data]:[]);
  const page=Page.parse(rows.find(r=>r.championId===157));
  const versions=z.array(VersionInfo).min(1).max(100).parse(rows.find(r=>Array.isArray(r.versionInfo))?.versionInfo);
  return {page,versions};
}
export function lolpsPatch(version:string){const [major,minor]=version.split('.').map(Number);return `${major+10}.${minor}`;}
function selected(cached:CachedPage,m:Matchup,s:Snapshot,stale=false):LolpsReference{
  const item=(id:number,quantity?:number)=>({id,name:s.items[String(id)]?.name??null,description:s.items[String(id)]?.description??null,gold:s.items[String(id)]?.gold??null,available:!!s.items[String(id)]?.purchasable&&!!s.items[String(id)]?.maps['11'],...(quantity?{quantity}:{})});
  const rune=(id:number)=>({id,name:s.runes.find(r=>r.id===id)?.name??null,description:s.runes.find(r=>r.id===id)?.description??null,available:s.runes.some(r=>r.id===id)});
  const first=cached.page.champSummary.find(b=>b.buildTypeId===0)!;let matchup:LolpsReference['matchup']=null;
  for(const [ids,rates,counts] of [[first.counterChampionIdList,first.counterWinrateList,first.counterCountList],[first.counterEasyChampionIdList,first.counterEasyWinrateList,first.counterEasyCountList]]){
    const index=ids.indexOf(Number(m.enemy.key));if(index>=0&&rates[index]!==undefined&&counts[index]!==undefined)matchup={enemy:m.enemy.name,winRate:rates[index],sampleCount:counts[index]};
  }
  const versionMatch=cached.patch.description===lolpsPatch(m.version);
  return {status:stale?'stale':'ready',message:stale?'更新失败，正在使用上次缓存的公开统计。':versionMatch?'已加载 LOL.PS 公开统计。':'来源版本与所选官方数据不同，仅作历史参考。',
    fetchedAt:cached.fetchedAt,patch:cached.patch.description,requestedPatch:lolpsPatch(m.version),versionMatch,
    source:{id:'lolps',label:`LOL.PS · 亚索中路 · ${cached.patch.description}`,url:cached.url,patch:cached.patch.description,checkedAt:cached.fetchedAt.slice(0,10)},
    region:'韩服',tier:'翡翠及以上',lane:'中路',timeRange:`补丁 ${cached.patch.description}（发布日 ${cached.patch.patchDate}）；公开页未提供精确采样起止时间。`,sampleCount:first.count,overallWinRate:first.winRate,matchup,
    builds:cached.page.champSummary.map(b=>({label:b.buildTypeId===0?'大众性套路':'高胜率套路（来源标签）',
      runes:[b.mainRune1,b.mainRune2,b.mainRune3,b.mainRune4,b.subRune1,b.subRune2].map(rune),shards:[b.statperk1Id,b.statperk2Id,b.statperk3Id],
      startingItems:[...new Set(b.startingItemIdList.flat())].map(id=>item(id,b.startingItemIdList.flat().filter(x=>x===id).length)),boots:item(b.shoesId),coreItems:b.coreItemIdList.map(id=>item(id)),
      runeStats:{winRate:b.runeTotalWinrate??null,pickRate:b.runeTotalPickrate??null,sampleCount:b.runeTotalCount??null},startingStats:{winRate:b.startingWinrate??null,pickRate:b.startingPickrate??null,sampleCount:b.startingCount??null},
      coreCombinations:[1,2,3].map(n=>{const v=b as Record<string,any>;return {items:(v[`top${n}ThreeCoreIdList`] as number[]).map(id=>item(id)),winRate:v[`top${n}ThreeCoreWinrate`]??null,pickRate:v[`top${n}ThreeCorePickrate`]??null,sampleCount:v[`top${n}ThreeCoreCount`]??null};}),
      skillOrder:b.skillLv15List,skillPriority:b.skillMasterList})),
    limits:[...(versionMatch?[`官方数据 ${m.version} 与来源 ${cached.patch.description} 已通过版本列表匹配同一补丁，命名不同不代表补丁不同。`]:[]),'只读取公开英雄页摘要；不读取会员、登录或 /api 数据。','符文、出装是亚索整体中路统计，不能称为针对当前对手的最优方案。','整场胜率不等于对线单杀率或特定等级对拼胜率；出装胜率存在局势与成装时点选择偏差。','公开页没有完整的对线技巧或伤害公式；技巧由 LLM 结合本地已核查机制推导并标为策略判断。','套路样本量与英雄总样本量不同；来源的高胜率标签不表示普遍最优。','属性碎片只提供来源 ID，未加载名称／数值映射时不得凭 ID 猜测具体效果。','标记为缺失或不可用的装备、符文不属于所选版本的可用方案，不可直接推荐。',...(versionMatch?[]:['来源补丁不匹配，不可把来源推荐和胜率表述为所选版本实测结果。'])]};
}
export class LolpsProvider{
  private memory=new Map<string,CachedPage>();private pending=new Map<string,Promise<CachedPage>>();private failedAt=new Map<string,number>();
  constructor(private dir:string,private fetcher:typeof fetch=fetch){}
  private file(version:string){return path.join(this.dir,`yasuo-mid-${version}.json`);}
  private async fetchPage(url:string){
    const response=await this.fetcher(url,{signal:AbortSignal.timeout(8000),redirect:'error',headers:{Accept:'text/html'}});
    if(!response.ok)throw new Error('upstream failed');
    if(Number(response.headers.get('content-length'))>2_000_000)throw new Error('page too large');
    const reader=response.body?.getReader();if(!reader)throw new Error('empty page');
    const chunks:Uint8Array[]=[];let size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw new Error('page too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
    return publicPageData(Buffer.concat(chunks).toString('utf8'));
  }
  private async download(version:string){
    let url=BASE+'?region=0&tier=2&lane=2';let data=await this.fetchPage(url);
    const wanted=data.versions.find(v=>v.description===lolpsPatch(version));
    if(wanted&&wanted.versionId!==data.page.championArguments.versionId){url+=`&version=${wanted.versionId}`;data=await this.fetchPage(url);}
    const patch=data.versions.find(v=>v.versionId===data.page.championArguments.versionId);
    if(!patch||(wanted&&patch.versionId!==wanted.versionId)||data.page.champSummary.some(b=>b.versionId!==patch.versionId))throw new Error('version mismatch');
    const value=Cached.parse({revision:1,fetchedAt:new Date().toISOString(),url,patch,page:data.page});
    await mkdir(this.dir,{recursive:true});const temp=this.file(version)+'.tmp';await writeFile(temp,JSON.stringify(value));await rename(temp,this.file(version));this.memory.set(version,value);this.failedAt.delete(version);return value;
  }
  async get(m:Matchup,refresh=false):Promise<LolpsReference>{
    const s=await snapshot(m.version);let cached=this.memory.get(m.version);
    if(!cached){try{cached=Cached.parse(JSON.parse(await readFile(this.file(m.version),'utf8')));this.memory.set(m.version,cached);}catch{/* No valid disk cache. */}}
    try{
      const age=cached?Date.now()-Date.parse(cached.fetchedAt):Infinity;
      if(cached&&!refresh&&age>=0&&age<TTL)return selected(cached,m,s,this.failedAt.has(m.version));
      if(Date.now()-(this.failedAt.get(m.version)??0)<60000)throw new Error('cooldown');
      let task=this.pending.get(m.version);if(!task){task=this.download(m.version);this.pending.set(m.version,task);task.finally(()=>{if(this.pending.get(m.version)===task)this.pending.delete(m.version);}).catch(()=>{});}
      return selected(await task,m,s);
    }catch{
      this.failedAt.set(m.version,Date.now());if(cached)return selected(cached,m,s,true);
      return {status:'unavailable',message:'暂时无法获取 LOL.PS 公开统计（网络、限流或页面结构变化）。本次使用本地资料，可稍后重试。',fetchedAt:null,source:null,patch:null,requestedPatch:lolpsPatch(m.version),versionMatch:null,region:'韩服',tier:'翡翠及以上',lane:'中路',timeRange:'未获取',sampleCount:null,overallWinRate:null,matchup:null,builds:[],limits:['未取得来源内容，不能声称本次建议参考了 LOL.PS。']};
    }
  }
}
export function withLolps(m:Matchup,reference:LolpsReference):Matchup{return {...m,lolps:reference,sources:reference.source?[...m.sources,reference.source]:m.sources};}
export function lolpsRevision(reference:LolpsReference|undefined){return createHash('sha256').update(JSON.stringify(reference??null)).digest('hex');}
