import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapshotSchema, KnowledgeSchema, LoadoutRulesSchema, Version, type Snapshot, type Matchup, type Guide, type RunePage, type BuildGroup, type LoadoutRule } from '../shared/schema.js';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshots = new Map<string, Snapshot>();
export const knowledge = KnowledgeSchema.parse(JSON.parse(await readFile(path.join(ROOT, 'data/knowledge.json'), 'utf8')));
export const evidence = JSON.parse(await readFile(path.join(ROOT, 'data/mechanics-evidence.json'), 'utf8'));
export const loadouts = LoadoutRulesSchema.parse(JSON.parse(await readFile(path.join(ROOT, 'data/loadouts.json'), 'utf8')));
export async function versions() {
  const files = await readdir(path.join(ROOT, 'data/snapshots'));
  return files.filter(f=>/^\d+\.\d+\.\d+\.json$/.test(f)).map(f=>f.slice(0,-5)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
}
export async function snapshot(version: string) {
  Version.parse(version);
  if (snapshots.has(version)) return snapshots.get(version)!;
  if (!(await versions()).includes(version)) throw Object.assign(new Error('这个数据版本尚未缓存，请选择可用版本。'),{statusCode:404});
  const data = SnapshotSchema.parse(JSON.parse(await readFile(path.join(ROOT, 'data/snapshots', `${version}.json`), 'utf8')));
  snapshots.set(version,data); return data;
}
export function clearSnapshots() { snapshots.clear(); }
function fallback(enemy: string): Guide {
  return {
    enemy,identity:'基础资料模式',difficulty:'细节博弈',runeStyle:'sustain',damage:'mixed',
    summary:'这位对手尚未精修：先认清控制与突进技能，保持血量，用可撤退的兵线做短换血。',
    reminders:['下面是亚索通用思路，不是该对局已核查的专属打法。','风墙只处理适用飞行道具；该英雄逐技能交互尚待核查。','进场前留一个未 E 的小兵作为撤退路线。'],
    threats:[], phases:[{label:'1—2 级',title:'保住补刀与护盾',body:'用 Q 稳定补刀，不为一次消耗承受整波兵线伤害。'},{label:'3—5 级',title:'保留退路',body:'对方关键控制落空后再接近，打完短换血撤回。'},{label:'6 级之后',title:'先读大招',body:'先确认对方大招是否会反打、免控或位移，不把击飞默认成必杀。'},{label:'装备节点',title:'用兵线创造机会',body:'续航和攻速提高容错，但不能替代技能命中与视野。'}],
    mistakes:['没有退路地 E 进整波敌方兵。','把所有技能都当作风墙能挡。','为了追残血忽略打野和兵线。'],
    buildNote:'以下为亚索通用出装模板，请结合对方实际技能与整局阵容调整。',summonerNote:'默认闪现＋点燃；以补刀发育为目标可选传送。',wallPlan:'该对局尚未核查逐技能交互；无法确认时请用走位与距离处理。',aliases:[]
  };
}
export function runePages(s: Snapshot,rule: LoadoutRule): RunePage[] {
  const build = (keys:string[], second:string[], label:string, reason:string) => {
    const missing:string[]=[];
    const resolve=(list:string[])=>list.flatMap(key=>{const r=s.runes.find(x=>x.key===key);if(!r){missing.push(key);return [];}return [r];});
    return {label,reason,primary:resolve(keys),secondary:resolve(second),missing,shards:['攻速','适应之力','成长生命']};
  };
  const lethal=build(['LethalTempo','Triumph','LegendAlacrity','LastStand'],[rule.defensiveRune,'Overgrowth'],'致命节奏 · 常规对拼',`${rule.runeReason} ${rule.defensiveReason}`);
  const sustain=build(['FleetFootwork','Triumph','LegendAlacrity','LastStand'],['SecondWind','Overgrowth'],'迅捷步法 · 承压备选','难以接近、无法持续攻击，且需要充能攻击的治疗和短暂移速帮助拉扯时再选。请展开当前版本效果核对对小兵的治疗折扣，不能把它当作无代价的高续航。牺牲致命节奏的叠层攻速与满层收益，换取换血容错。');
  return [lethal,sustain];
}
export function buildGroups(s:Snapshot,g:Guide,rule:LoadoutRule):BuildGroup[] {
  const starter = (id:string,label:string,reason:string):BuildGroup => {
    const item=s.items[id],pot=s.items['2003'];
    const available=(i:typeof item|undefined)=>!!i?.purchasable&&!!i.maps['11'];
    const missing=[...(!available(item)?[id]:[]),...(!available(pot)?['2003']:[])];
    const affordable=available(item)&&available(pot)&&item.gold<=500&&pot.gold>0;
    const potionCount=affordable?Math.min(2,Math.floor((500-item.gold)/pot.gold)):0;
    const items=[...(available(item)?[item]:[]),...(potionCount>0?[pot]:[])];
    const quantities:Record<string,number>={[id]:1,...(potionCount>0?{'2003':potionCount}:{})};
    const totalGold=missing.length===0?items.reduce((sum,i)=>sum+i.gold*quantities[i.id],0):null;
    return {kind:'starter',label,reason,items,missing,quantities,totalGold,budgetValid:!!affordable&&totalGold!==null&&totalGold<=500};
  };
  const starters=[starter(rule.starter,'出门 · 本局起点',rule.starterReason),starter(rule.alternative,'出门 · 条件备选',rule.alternativeReason)];
  const rows:[string,string,string[]][]=[
    ['首次回城','按金币选择鞋、短剑或长剑；回城前推好兵线，避免为了单件装备残血赖线。',['1001','1042','1036']],
    ['核心路线','参考顺序：狂战士胫甲 → 破败王者之刃 → 不朽盾弓 → 无尽之刃。输出与生存需求会改变先后，这不是统计最优解。',['3006','3153','6673','3031']],
    ['顺风补强','已有足够生存空间再补输出或续航；不要把备选装备全部同时买。',['3031','3072','3036']],
    ['逆风／针对','根据敌方整体威胁择一调整；魔抗与护甲各有用途。盾弓与饮魔刀系护盾装备可能有购买互斥，遵循游戏商店限制。',g.damage==='ad'?['3047','6333','3026']:g.damage==='ap'?['3111','3091','3156']:['3047','3111','6333']]
  ];
  if(g.enemy==='Malzahar') rows.push(['压制应对','仅在压制实质影响输出且经济允许时评估水银饰带；召唤师净化不解除压制。',['3140']]);
  if(g.enemy==='Sylas') rows.push(['治疗应对','点燃窗口不足且队伍缺少重伤时，再评估重伤散件。',['3123']]);
  return [...starters,...rows.map(([label,reason,ids])=>({label,reason,items:ids.flatMap(id=>{const i=s.items[id];return i?.purchasable&&i.maps['11']?[i]:[];}),missing:ids.filter(id=>!s.items[id]?.purchasable||!s.items[id]?.maps['11'])}))];
}
export async function matchup(enemyId:string,version:string):Promise<Matchup> {
  const s=await snapshot(version);const enemy=Object.hasOwn(s.champions,enemyId)?s.champions[enemyId]:undefined;
  if(!enemy) throw Object.assign(new Error('未找到这个英雄，请重新选择。'),{statusCode:404});
  const refined=knowledge.guides.some(g=>g.enemy===enemyId);const guide=knowledge.guides.find(g=>g.enemy===enemyId)||fallback(enemyId);
  const loadoutRule=Object.hasOwn(loadouts.matchups,enemyId)?loadouts.matchups[enemyId]:loadouts.default;
  const sources=[{id:'ddragon',label:`拳头 Data Dragon · ${enemy.name}`,url:`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/champion/${enemyId}.json`,patch:version,checkedAt:s.fetchedAt.slice(0,10)}, {id:'yasuo',label:'拳头 Data Dragon · 亚索',url:`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/champion/Yasuo.json`,patch:version,checkedAt:s.fetchedAt.slice(0,10)}];
  if(evidence[enemyId])sources.push({id:'mechanics',label:'Meraki 机制资料（旧版参考）',url:evidence[enemyId].url,patch:evidence[enemyId].patch,checkedAt:evidence[enemyId].checkedAt});
  sources.push({id:'items',label:'拳头 Data Dragon · 装备',url:`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/item.json`,patch:version,checkedAt:s.fetchedAt.slice(0,10)},{id:'runes',label:'拳头 Data Dragon · 符文',url:`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/runesReforged.json`,patch:version,checkedAt:s.fetchedAt.slice(0,10)});
  return {version,fetchedAt:s.fetchedAt,enemy,player:s.champions.Yasuo,guide,refined,knowledgeRevision:`${knowledge.revision}:${loadouts.revision}`,reviewedPatch:knowledge.reviewedPatch,stale:version!==knowledge.reviewedPatch||version!==loadouts.patch,verification:knowledge.verification,sources,builds:buildGroups(s,guide,loadoutRule),runePages:runePages(s,loadoutRule),loadoutBasis:loadouts.basis,statsStatus:'完整国服／韩服铂金以上对局统计尚未接入。AI 教练可选参考 LOL.PS 公开摘要（韩服 · 翡翠及以上），单独显示来源、补丁和样本，不等同于完整对局数据库。'};
}
