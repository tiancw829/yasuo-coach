import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CombatInputSchema, defaultCombatInput, type CombatInput, type CombatReport, type CombatSide, type CombatStats, type DamageLine, type MinionDamage } from '../shared/combat.js';
import type { Matchup, Snapshot, Source } from '../shared/schema.js';
import { ROOT, snapshot } from './data.js';

const evidence=JSON.parse(await readFile(path.join(ROOT,'data/combat/16.21.json'),'utf8'));
const number=(value:unknown)=>Math.round(z.number().finite().parse(value)*1e6)/1e6;
function root(hero:string,field:string){return number(evidence.characters[hero].root[field]?.baseValue);}
function spell(hero:string,suffix:string){const s=evidence.characters[hero].spells.find((s:any)=>s.key.endsWith(suffix));if(!s)throw Error('Missing reviewed spell');return s;}
function values(hero:string,suffix:string,name:string){const value=spell(hero,suffix).DataValues.find((x:any)=>x.name.toLowerCase()===name.toLowerCase());return z.array(z.number().finite()).min(4).parse(value?.values).map(number);}
function value(hero:string,suffix:string,name:string,rank:number){return values(hero,suffix,name)[rank];}
function spellCost(hero:string,suffix:string,rank:number){return number(spell(hero,suffix).mana?.[rank-1]);}
function coefficient(hero:string,suffix:string,calc:string,index:number){return number(spell(hero,suffix).calculations[calc]?.mFormulaParts[index]?.mCoefficient);}
const sources=evidence.sources as Source[];
export const combatRevision=evidence.revision as string;
// These are explicit model rules, separate from the sourced per-rank coefficients.
export function growth(level:number){const n=level-1;return (.7025+.0175*n)*n;}
export function resistanceMultiplier(resistance:number){return resistance>=0?100/(100+resistance):2-100/(100-resistance);}
export function minionAttacks(seconds:number,attackSpeed:number){return Math.floor(seconds*attackSpeed+1e-7);}
function sum(lines:DamageLine[],key:'raw'|'afterResistance'){return lines.reduce((s,l)=>s+l[key],0);}
function stats(hero:'yasuo'|'ahri',input:CombatInput,s:Snapshot):CombatStats{
  const own=hero==='yasuo';const bonus=own?input.yasuoBonus:input.ahriBonus;const id=own?input.yasuoStarter:input.ahriStarter;const item=id==='none'?undefined:s.items[id];
  if(id!=='none'&&(!item?.purchasable||!item.maps['11']))throw Object.assign(new Error('所选版本中缺少该出门装，请重新选择。'),{statusCode:400});
  const mod=item?.stats??{};const g=growth(input.level);
  const baseAd=root(hero,'baseDamageModifiable')+root(hero,'damagePerLevelModifiable')*g;
  const bonusAd=(mod.FlatPhysicalDamageMod??0)+bonus.ad;
  const hp=root(hero,'baseHPModifiable')+root(hero,'hpPerLevelModifiable')*g+(mod.FlatHPPoolMod??0)+bonus.hp;
  const attackSpeed=root(hero,'attackSpeedModifiable')+root(hero,'attackSpeedRatioModifiable')*((root(hero,'attackSpeedPerLevelModifiable')*g+bonus.as)/100+(mod.PercentAttackSpeedMod??0));
  const manaResource=evidence.characters[hero].root.primaryAbilityResource;const mana=own?0:number(manaResource['{726ee5cd}']?.baseValue)+number(manaResource['{6216bf7b}']?.baseValue)*g;
  return {hp,currentHp:hp*(own?input.yasuoHpPercent:input.ahriHpPercent)/100,baseAd,bonusAd,ad:baseAd+bonusAd,ap:(mod.FlatMagicDamageMod??0)+bonus.ap,
    armor:root(hero,'baseArmorModifiable')+root(hero,'armorPerLevelModifiable')*g+(mod.FlatArmorMod??0)+bonus.armor,
    mr:root(hero,'baseMR')+root(hero,'mrPerLevel')*g+(mod.FlatSpellBlockMod??0)+bonus.mr,attackSpeed,attackInterval:1/attackSpeed,mana,itemName:item?.name??'无装备',itemStats:mod};
}
function line(label:string,type:DamageLine['type'],hits:number,perHit:number,target:CombatStats,formula:string):DamageLine{
  const raw=hits*perHit;return {label,type,hits,perHit,raw,afterResistance:raw*(type==='true'?1:resistanceMultiplier(type==='physical'?target.armor:target.mr)),formula};
}
function minions(input:CombatInput['enemyMinions'],target:CombatStats):MinionDamage{
  const rows:DamageLine[]=[];
  for(const [kind,hero,label,ad] of [['melee','sru_orderminionmelee','近战兵',input.meleeAd],['ranged','sru_orderminionranged','远程兵',input.rangedAd],['siege','sru_orderminionsiege','炮车',input.siegeAd]] as const){
    const attacks=minionAttacks(input.seconds,root(hero,'attackSpeedModifiable'));const hits=input[kind]*attacks;
    if(hits)rows.push(line(`${input[kind]} 个${label} × 每个 ${attacks} 次`, 'physical',hits,ad,target,`${input[kind]} × floor(${input.seconds}秒 × ${root(hero,'attackSpeedModifiable')}次/秒) × ${ad}`));
  }
  return {rows,raw:sum(rows,'raw'),afterResistance:sum(rows,'afterResistance'),assumptions:['所有指定小兵全程存活、在攻击范围内并持续攻击该英雄；首击在一个攻击周期后结算，不含走位、弹道和转火延迟。','按指定的每击物理伤害计算；默认值来自 16.21 小兵根配置（11 / 19.5 / 36），未计生成脚本增益、随时间升级和特殊减伤。可按游戏内实际面板修改每击伤害。','不是仇恨仿真：不会预测哪些兵会转火。风墙挡小兵弹道时应减少远程兵数量／暴露时间；兵线损失另行设置。']};
}
function side(stats:CombatStats,lines:DamageLine[],minions:MinionDamage,manaCost=0):CombatSide{return {stats,lines,raw:sum(lines,'raw'),afterResistance:sum(lines,'afterResistance'),minions,incoming:0,remainingHp:stats.currentHp,lossPercent:0,manaCost};}
function calculate(input:CombatInput,s:Snapshot){
  const y=stats('yasuo',input,s),a=stats('ahri',input,s);const yl:DamageLine[]=[],al:DamageLine[]=[];const yr=input.yasuoRanks,ar=input.ahriRanks;
  if(input.yasuoAutos)yl.push(line('亚索普攻（不暴击）','physical',input.yasuoAutos,y.ad,a,`总攻击力 ${y.ad} × ${input.yasuoAutos}`));
  if(input.yasuoQHits){const base=value('yasuo','/YasuoQ1Wrapper','BaseDamage',yr.q),ratio=value('yasuo','/YasuoQ1Wrapper','ADRatio',yr.q);yl.push(line(`亚索 Q · ${yr.q}级`,'physical',input.yasuoQHits,base+ratio*y.ad,a,`${base} + ${ratio} × 总AD ${y.ad}`));}
  if(input.yasuoEHit){const base=value('yasuo','/YasuoE','BaseDamage',yr.e),adRatio=value('yasuo','/YasuoE','ADRatio',yr.e),apRatio=value('yasuo','/YasuoE','APRatio',yr.e),perStack=number(spell('yasuo','/YasuoE').calculations.BonusDamagePerStack.mMultiplier.mNumber);const per=(base+adRatio*y.bonusAd+apRatio*y.ap)*(1+perStack*input.yasuoEStacks);yl.push(line(`亚索 E · ${yr.e}级 · 预叠 ${input.yasuoEStacks} 层`,'magic',1,per,a,`(${base} + ${adRatio} × 额外AD ${y.bonusAd} + ${apRatio} × AP ${y.ap}) × (1 + ${perStack} × ${input.yasuoEStacks})`));}
  if(input.yasuoRHit){const base=value('yasuo','/YasuoR','RBaseDamage',yr.r),ratio=coefficient('yasuo','/YasuoR','Damage',1);yl.push(line(`亚索 R · ${yr.r}级`,'physical',1,base+ratio*y.bonusAd,a,`${base} + ${ratio} × 额外AD ${y.bonusAd}`));}
  if(input.ahriAutos)al.push(line('阿狸普攻（不暴击）','physical',input.ahriAutos,a.ad,y,`总攻击力 ${a.ad} × ${input.ahriAutos}`));
  if(input.ahriQOut||input.ahriQReturn){const base=value('ahri','/AhriQ','BaseDamage',ar.q),ratio=coefficient('ahri','/AhriQ','TotalDamage',1);const per=base+ratio*a.ap;if(input.ahriQOut)al.push(line(`阿狸 Q 去程 · ${ar.q}级`,'magic',1,per,y,`${base} + ${ratio} × AP ${a.ap}`));if(input.ahriQReturn)al.push(line(`阿狸 Q 回程 · ${ar.q}级`,'true',1,per,y,`${base} + ${ratio} × AP ${a.ap}（真实伤害不乘魔抗系数）`));}
  if(input.ahriWFlames){const base=value('ahri','/AhriW','BaseDamage',ar.w),ratio=value('ahri','/AhriW','APRatio',ar.w),repeat=value('ahri','/AhriW','RepeatDamageMod',ar.w);al.push(line(`阿狸 W 首团 · ${ar.w}级`,'magic',1,base+ratio*a.ap,y,`${base} + ${ratio} × AP ${a.ap}`));if(input.ahriWFlames>1)al.push(line('阿狸 W 后续狐火（同目标）','magic',input.ahriWFlames-1,(base+ratio*a.ap)*repeat,y,`(${base} + ${ratio} × AP ${a.ap}) × ${repeat}`));}
  if(input.ahriEHit){const base=value('ahri','/AhriE','BaseDamage',ar.e),ratio=value('ahri','/AhriE','APRatio',ar.e);al.push(line(`阿狸 E · ${ar.e}级`,'magic',1,base+ratio*a.ap,y,`${base} + ${ratio} × AP ${a.ap}`));}
  if(input.ahriRHits){const base=value('ahri','/AhriR','RBaseDamage',ar.r),ratio=value('ahri','/AhriR','RAPCoefficient',ar.r);al.push(line(`阿狸 R · ${ar.r}级 · ${input.ahriRHits} 次冲刺各一弹`,'magic',input.ahriRHits,base+ratio*a.ap,y,`${base} + ${ratio} × AP ${a.ap}（每次冲刺对同目标最多一弹）`));}
  // Hit toggles describe dodging/blocking, not free spell casts. The budget assumes
  // one cast of every learned spell, including misses; R recasts have no extra cost.
  const manaCost=([['q','/AhriQ'],['w','/AhriW'],['e','/AhriE'],['r','/AhriR']] as const).reduce((total,[slot,suffix])=>total+(ar[slot]?spellCost('ahri',suffix,ar[slot]):0),0);
  const ys=side(y,yl,minions(input.enemyMinions,y)),as=side(a,al,minions(input.allyMinions,a),manaCost);
  ys.incoming=as.afterResistance+ys.minions.afterResistance;as.incoming=ys.afterResistance+as.minions.afterResistance;
  for(const target of [ys,as]){target.remainingHp=Math.max(0,target.stats.currentHp-target.incoming);target.lossPercent=target.incoming/target.stats.hp*100;}
  return {yasuo:ys,ahri:as};
}
export async function combatReport(m:Matchup,input?:CombatInput):Promise<CombatReport>{
  const result:CombatReport={status:'unsupported',message:'当前数值计算已支持亚索对阿狸 · 16.21；其他英雄／补丁尚未核查公式，不套用这组伤害。',revision:combatRevision,patch:evidence.patch,checkedAt:evidence.checkedAt,sources:[],input:null,comparisons:[],assumptions:[],warnings:[],formulas:[]};
  if(m.enemy.id!=='Ahri'||m.version!==evidence.version)return result;
  const parsed=CombatInputSchema.parse(input??defaultCombatInput());const s=await snapshot(m.version);const {yasuo,ahri}=calculate(parsed,s);
  const shieldCalc=spell('yasuo','/YasuoPassive').calculations.ShieldValue.mFormulaParts[0];const shield=number(shieldCalc.mStartValue)+(number(shieldCalc.mEndValue)-number(shieldCalc.mStartValue))*growth(parsed.level)/17;
  const warnings=['当前为命中次数指定的伤害预算，不是时间轴对战仿真；攻击距离、走位、击飞、魅惑、动画和先死亡中断不会自动改变命中。','未计算致命节奏叠层／额外伤害、电刑等符文触发、点燃、暴击、全能吸血、多兰盾回复、回血药、装备特效与护盾之外的减伤；可在额外属性中填写符文和回城后的静态面板加成。','小兵默认每击数据为游戏文件基础配置，实际随游戏时间和生成脚本变化；请按当前面板调整。'];
  if(ahri.manaCost>ahri.stats.mana)warnings.push('所选阿狸技能的法力消耗超过满蓝上限，不能在无回蓝情况下完成。');
  if(parsed.yasuoRHit)warnings.push('亚索 R 假设已提前攒好 Q3 并击飞，计入一个 Q 命中；若无法击飞请取消 R。不自动把普通 Q 变成 Q3。');
  if(parsed.yasuoQHits>1)warnings.push('多次 Q 为你指定的命中次数，不自动检查攻速缩短 CD 和对拼时间是否允许。');
  const maximumAbsorbed=ahri.afterResistance>0?Math.min(shield,yasuo.incoming):0;
  const comparisons=[1,2,3,6].map(level=>{
    const d=defaultCombatInput(level);Object.assign(d,{yasuoStarter:parsed.yasuoStarter,ahriStarter:parsed.ahriStarter,yasuoBonus:parsed.yasuoBonus,ahriBonus:parsed.ahriBonus,enemyMinions:parsed.enemyMinions,allyMinions:parsed.allyMinions,yasuoHpPercent:parsed.yasuoHpPercent,ahriHpPercent:parsed.ahriHpPercent});
    const c=calculate(d,s);const diff=c.ahri.lossPercent-c.yasuo.lossPercent;
    return {level,yasuoDamage:c.yasuo.afterResistance,ahriDamage:c.ahri.afterResistance,yasuoLossPercent:c.yasuo.lossPercent,ahriLossPercent:c.ahri.lossPercent,assessment:Math.abs(diff)<2?'该假设下掉血比例接近':diff>0?'该假设下亚索换血占优':'该假设下阿狸换血占优'};
  });
  return {...result,status:'ready',message:'已由程序按同补丁游戏文件数值计算；默认未计符文触发与回复。',sources,input:parsed,yasuo,ahri,shield:{maximum:shield,minimumHpLoss:Math.max(0,yasuo.incoming-maximumAbsorbed),maximumHpLoss:yasuo.incoming,note:'意流满时，首次英雄伤害触发约 1 秒护盾。这里只给出整段承伤中最多吸收一次护盾的掉血区间；没有英雄命中时不触发。不假设持续覆盖整套连招，不计 R 后可能再次触发的护盾。'},comparisons,warnings,
    assumptions:[`双方同为 ${parsed.level} 级，亚索 Q/W/E/R=${Object.values(parsed.yasuoRanks).join('/')}，阿狸=${Object.values(parsed.ahriRanks).join('/')}。`,`亚索 ${yasuo.stats.itemName}，阿狸 ${ahri.stats.itemName}；额外属性按输入加入，未自动应用任何符文。`,'技能按指定命中数计算；W 风墙不造成伤害。被风墙挡住或躲开的技能请取消命中；不会自动按概率扣除。','法力预算按阿狸全部已学技能各施放一轮，未命中也耗蓝；R 重施放不重复扣蓝。满蓝起手，未计回蓝。','英雄与小兵伤害分别先减伤再相加。默认技能点序：亚索 Q-E-W-Q-Q-R；阿狸 Q-W-E-Q-Q-R。','等级比较使用相同出门装／额外属性／兵线、各等级默认连招（双方 2 次普攻，已学伤害技能各一轮，6 级亚索含 Q3+R、阿狸 R 三次），不复用自定义命中开关。','优势比较按承受伤害占最大生命值的比例，未扣意流盾与回复；不是胜率、单杀概率或“某等级必胜”。'],
    formulas:['成长系数 g(L)=[0.7025+0.0175×(L−1)]×(L−1)；基础属性=1级基础+成长字段×g(L)。该非线性成长规则为本计算模型显式规则，尚未逐等级游戏内实测。','正抗性减伤：伤害×100/(100+抗性)；负抗性：伤害×(2−100/(100−抗性))；真实伤害不乘抗性。','攻速=基础攻速+攻速收益系数×额外攻速比例；普攻间隔=1/攻速。只展示面板间隔，不自动安排连招或致命节奏叠层。','小兵预算=兵数×floor(暴露秒数×配置攻速)×指定每击物理伤害×护甲系数。','意流盾模型上限=125+(600−125)×g(L)/17；展示一次满盾的理论吸收范围，不自动决定触发和到期时点。']};
}
export function withCombat(m:Matchup,report:CombatReport):Matchup{return {...m,combat:report,sources:[...m.sources,...report.sources]};}
