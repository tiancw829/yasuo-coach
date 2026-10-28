import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, snapshot } from './data.js';
import { growth, resistanceMultiplier } from './combat.js';
import { NumericInputSchema, defaultNumericInput, type NumericInput, type NumericHero, type NumericSpell, type NumericReport } from '../shared/numerics.js';
import type { Matchup } from '../shared/schema.js';

const manifest=JSON.parse(await readFile(path.join(ROOT,'data/numerics/16.21/manifest.json'),'utf8'));
const profiles=JSON.parse(await readFile(path.join(ROOT,'data/numerics/profiles.json'),'utf8'));
const cached=new Map<string,any>();
async function load(id:string){
  if(!Object.hasOwn(manifest.champions,id)||manifest.champions[id]!=='ready')return null;
  if(!cached.has(id))cached.set(id,JSON.parse(await readFile(path.join(ROOT,'data/numerics/16.21',`${id}.json`),'utf8')));
  return cached.get(id);
}
const n=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v))throw Error('数值缺失');return Math.round(v*1e6)/1e6;};
const f=(v:number)=>String(Math.round(v*1e6)/1e6);
type Result={value:number;formula:string};
type Env={level:number;rank:number;stats:Record<string,number|null>};
function data(s:any,key:string,rank:number):Result{
  const d=s.dataValues.find((v:any)=>v.name?.toLowerCase()===key.toLowerCase());const value=n(d?.values?.[rank]);
  return {value,formula:`${key}[技能${rank}级]=${f(value)}`};
}
function stat(node:any,env:Env):Result{
  const type=node.mStat??0,mode=node.mStatFormula??0;
  const key=type===0&&mode===0?'ap':type===2&&mode===0?'ad':type===2&&mode===2?'bonusAd':type===6&&mode===0?'mr':type===6&&mode===2?'bonusMr':null;
  if(!key)throw Error(`未解析属性 ${type}/${mode}`);
  return {value:n(env.stats[key]),formula:`${({ap:'AP',ad:'总AD',bonusAd:'额外AD',mr:'总魔抗',bonusMr:'额外魔抗'} as Record<string,string>)[key]} ${f(n(env.stats[key]))}`};
}
export function evaluateCalculation(s:any,key:string,env:Env,depth=0):Result{
  if(depth>18)throw Error('计算节点循环或过深');
  const node=s.calculations[Object.keys(s.calculations).find(k=>k.toLowerCase()===key.toLowerCase())??''];if(!node)throw Error(`未找到计算节点 ${key}`);
  function part(p:any):Result{
    if(!p)throw Error('缺少计算分项');
    const mul=(a:Result,b:Result):Result=>({value:a.value*b.value,formula:`(${a.formula}) × (${b.formula})`});
    switch(p.__type){
      case 'NumberCalculationPart':{const value=n(p.mNumber??0);return {value,formula:f(value)};}
      case 'NamedDataValueCalculationPart':return data(s,p.mDataValue,env.rank);
      case 'StatByNamedDataValueCalculationPart':return mul(data(s,p.mDataValue,env.rank),stat(p,env));
      case 'StatByCoefficientCalculationPart':return mul({value:n(p.mCoefficient),formula:f(n(p.mCoefficient))},stat(p,env));
      case 'EffectValueCalculationPart':{const value=n(s.effects?.[p.mEffectIndex-1]?.value?.[env.rank]);return {value,formula:`Effect${p.mEffectIndex}[技能${env.rank}级]=${f(value)}`};}
      case 'ProductOfSubPartsCalculationPart':return mul(part(p.mPart1),part(p.mPart2));
      case 'SumOfSubPartsCalculationPart':{const results=p.mSubparts.map(part);return {value:results.reduce((sum:number,r:Result)=>sum+r.value,0),formula:results.map((r:Result)=>r.formula).join(' + ')};}
      case 'ByCharLevelBreakpointsCalculationPart':{
        // Only the simple linear variant is approved. Tiered/passive rules need a separate review.
        if(p.mBreakpoints?.length)throw Error('分段英雄等级成长待核查');
        const base=n(p.mLevel1Value),step=n(p.mInitialBonusPerLevel??0);return {value:base+step*(env.level-1),formula:`${f(base)} + ${f(step)} × (英雄等级${env.level} − 1)`};
      }
      default:throw Error(`未解析节点 ${p.__type??'unknown'}`);
    }
  }
  let result:Result;
  if(node.__type==='GameCalculationModified')result=evaluateCalculation(s,node.mModifiedGameCalculation,env,depth+1);
  else if(node.__type==='GameCalculation'){
    if(!Array.isArray(node.mFormulaParts)||!node.mFormulaParts.length)throw Error('空计算节点');
    const parts=node.mFormulaParts.map(part);result={value:parts.reduce((sum:number,p:Result)=>sum+p.value,0),formula:parts.map((p:Result)=>p.formula).join(' + ')};
  }else throw Error(`未解析计算类型 ${node.__type}`);
  if(node.mMultiplier){const mult=part(node.mMultiplier);result={value:result.value*mult.value,formula:`(${result.formula}) × (${mult.formula})`};}
  if(!Number.isFinite(result.value)||result.value<0)throw Error('计算结果无效');return result;
}
function expression(node:any):string{
  if(!node||typeof node!=='object')return '未解析';
  const name=node.__type;
  const statName=()=>{const type=node.mStat??0,mode=node.mStatFormula??0;return type===0&&mode===0?'AP':type===2&&mode===0?'总AD':type===2&&mode===2?'额外AD':type===6&&mode===2?'额外魔抗':`属性(${type},${mode})`;};
  let text:string;
  switch(name){
    case 'GameCalculation':text=(node.mFormulaParts??[]).map(expression).join(' + ');break;
    case 'GameCalculationModified':text=`引用计算(${node.mModifiedGameCalculation})`;break;
    case 'NamedDataValueCalculationPart':return `${node.mDataValue}[技能等级]`;
    case 'StatByNamedDataValueCalculationPart':return `${node.mDataValue}[技能等级] × ${statName()}`;
    case 'StatByCoefficientCalculationPart':return `${f(n(node.mCoefficient??0))} × ${statName()}`;
    case 'NumberCalculationPart':return f(n(node.mNumber??0));
    case 'EffectValueCalculationPart':return `Effect${node.mEffectIndex}[技能等级]`;
    case 'SumOfSubPartsCalculationPart':return `(${(node.mSubparts??[]).map(expression).join(' + ')})`;
    case 'ProductOfSubPartsCalculationPart':return `(${expression(node.mPart1)}) × (${expression(node.mPart2)})`;
    case 'ByCharLevelBreakpointsCalculationPart':return `英雄等级分段规则 ${JSON.stringify(node)}`;
    case 'ByCharLevelInterpolationCalculationPart':return `英雄等级插值(${node.mStartValue}→${node.mEndValue}；具体插值规则待核查)`;
    default:return `未解析节点 ${name??'unknown'}`;
  }
  return node.mMultiplier?`(${text}) × (${expression(node.mMultiplier)})`:text;
}
function rootNumber(raw:any,key:string):number|null{const v=raw.root[key]?.baseValue;return typeof v==='number'&&Number.isFinite(v)?n(v):null;}
function hero(raw:any,level:number,mod:Record<string,number>,input?:NumericInput):NumericHero{
  const at=(base:string,per:string)=>{const b=rootNumber(raw,base),p=rootNumber(raw,per);return b===null||p===null?null:b+p*growth(level);};
  const baseAd=at('baseDamageModifiable','damagePerLevelModifiable'),hp=at('baseHPModifiable','hpPerLevelModifiable'),armor=at('baseArmorModifiable','armorPerLevelModifiable'),mr=at('baseMR','mrPerLevel');
  const bonusAd=(input?.bonusAd??0)+(mod.FlatPhysicalDamageMod??0),bonusMr=(input?.bonusMr??0)+(mod.FlatSpellBlockMod??0);
  const baseAs=rootNumber(raw,'attackSpeedModifiable'),ratio=rootNumber(raw,'attackSpeedRatioModifiable'),asGrowth=rootNumber(raw,'attackSpeedPerLevelModifiable');
  const stats={level,hp:hp===null?null:hp+(mod.FlatHPPoolMod??0),baseAd,bonusAd,ad:baseAd===null?null:baseAd+bonusAd,ap:(input?.ap??0)+(mod.FlatMagicDamageMod??0),armor:armor===null?null:armor+(mod.FlatArmorMod??0),mr:mr===null?null:mr+bonusMr,bonusMr,attackSpeed:baseAs===null||ratio===null||asGrowth===null?null:baseAs+ratio*(asGrowth*growth(level)/100+(mod.PercentAttackSpeedMod??0))};
  function spell(s:any):NumericSpell{
    const max=s.slot==='R'?3:5;
    const rankValues=(values:any,kind:string)=>Array.isArray(values)&&values.every((v:any)=>typeof v==='number'&&Number.isFinite(v))?values.slice(kind==='cost'?0:values.length>=7?1:0,(kind==='cost'?0:values.length>=7?1:0)+max).map(n):null;
    return {key:s.key,slot:s.slot,name:s.key.split('/').at(-1),cooldown:rankValues(s.cooldown,'cooldown'),cost:rankValues(s.cost,'cost'),range:rankValues(s.range,'range'),dataValues:s.dataValues.map((d:any)=>({name:d.name,values:Array.isArray(d.values)?d.values.map(n):null})),calculations:Object.fromEntries(Object.entries(s.calculations).map(([k,v])=>[k,expression(v)]))};
  }
  return {id:raw.id,name:raw.name,source:raw.source,stats,spells:raw.spells.filter((s:any)=>s.slot).sort((a:any,b:any)=>'QWER'.indexOf(a.slot)-'QWER'.indexOf(b.slot)).map(spell),extraSpells:raw.spells.filter((s:any)=>!s.slot&&(Object.keys(s.calculations).length||s.dataValues.length)).map(spell)};
}
export async function numericReport(m:Matchup,request?:NumericInput):Promise<NumericReport>{
  const input=NumericInputSchema.parse(request??defaultNumericInput());
  const result:NumericReport={status:'unavailable',message:'该英雄数值资料未缓存。',revision:`${manifest.revision}:${profiles.revision}`,version:manifest.version,patch:manifest.patch,checkedAt:manifest.checkedAt,coverage:Object.values(manifest.champions).filter(s=>s==='ready').length,input,enemy:null,player:null,components:[],target:null,limits:[],sources:[]};
  if(m.version!==manifest.version)return {...result,status:'versionMismatch',message:`数值资料适用 ${manifest.version}，当前选择 ${m.version}；未套用其他补丁的数值。`};
  const [raw,yasuo,s]=await Promise.all([load(m.enemy.id),load('Yasuo'),snapshot(m.version)]);if(!raw||!yasuo)return result;
  const item=input.item==='none'?null:s.items[input.item];if(input.item!=='none'&&(!item?.purchasable||!item.maps['11']))throw Object.assign(Error('所选版本中缺少该装备。'),{statusCode:400});
  const enemy=hero(raw,input.level,item?.stats??{},input),player=hero(yasuo,input.level,s.items['1086']?.stats??{});
  const targetArmor=input.targetArmor??player.stats.armor,targetMr=input.targetMr??player.stats.mr;if(targetArmor===null||targetMr===null)throw Error('Missing target resistance');
  const profile=profiles.profiles[m.enemy.id];const components:NumericReport['components']=[],limits:string[]=[];
  if(profile){
    limits.push(profile.limit);
    for(const c of profile.components){
      const spell=raw.spells.find((s:any)=>s.key.split('/').at(-1)===c.spell);const rank=spell?.slot?input.ranks[spell.slot as keyof NumericInput['ranks']]:0;if(!rank)continue;
      try{const r=evaluateCalculation(spell,c.calc,{level:input.level,rank,stats:enemy.stats});components.push({slot:spell.slot,label:c.label,type:c.type,raw:r.value,afterResistance:r.value*(c.type==='true'?1:resistanceMultiplier(c.type==='physical'?targetArmor:targetMr)),formula:r.formula,note:c.note});}
      catch(e){limits.push(`${c.label} 未计算：${e instanceof Error?e.message:'数值缺失'}。`);}
    }
  }else limits.push('该英雄已缓存原始数值与计算节点，伤害类型、触发规则和完整连招尚未核查，因此不自动汇总技能伤害。');
  limits.push('分项表不是连招总伤害：可能包含互斥、重复、按每秒／每球和额外触发条件的行，不能直接相加。没有模拟技能时序、符文、暴击、回复、装备特效或胜率。','目标默认是同等级、只带多兰之弓的亚索；可单独覆盖护甲／魔抗。对方装备与属性独立于阿狸完整对拼计算器。','主技能 CD／消耗／距离按技能等级排列；DataValues 保留原始索引，通常索引 0 为占位，不得直接当技能 1 级；仅白名单分项采用已经确认的索引规则。','游戏文件字段可能包含未使用值、旧说明节点和模式专用值；未知节点不执行，缺失数值不补零。基础成长按已列出的非线性规则估算，特殊属性机制不自动模拟。');
  return {...result,status:'ready',message:`已缓存 ${result.coverage} 位英雄同补丁数值资料；${profile?'此对局提供技能分项计算。':'此英雄提供原始数值资料。'}`,enemy,player,components,target:{armor:targetArmor,mr:targetMr},limits,sources:[raw.source,yasuo.source]};
}
export function withNumerics(m:Matchup,report:NumericReport):Matchup{return {...m,numerics:report,sources:[...m.sources,...report.sources]};}
export function numericFacts(report:NumericReport){
  const compact=(h:NumericHero|null)=>h?{...h,extraSpells:h.extraSpells.slice(0,12),extraSpellCount:h.extraSpells.length,extraSpellLimit:'最多检索12个附加技能；主技能字段完整提供，附加资料不足时不得推测。'}:null;
  return {...report,enemy:compact(report.enemy),player:report.player?{id:report.player.id,name:report.player.name,source:report.player.source,stats:report.player.stats}:null};
}
