import { z } from 'zod';
import type { Source } from './schema.js';

const num=(max:number)=>z.number().finite().min(0).max(max);
const ranks=z.object({q:num(5).int(),w:num(5).int(),e:num(5).int(),r:num(3).int()});
const bonus=z.object({ad:num(500),ap:num(1500),hp:num(5000),armor:num(300),mr:num(300),as:num(200)});
export const minionInput=z.object({melee:num(12).int(),ranged:num(12).int(),siege:num(6).int(),seconds:num(15),meleeAd:num(300),rangedAd:num(300),siegeAd:num(500)});
export const CombatInputSchema=z.object({
  level:z.number().int().min(1).max(18),yasuoRanks:ranks,ahriRanks:ranks,
  yasuoStarter:z.enum(['none','1086','1054','1055']),ahriStarter:z.enum(['none','1056','1082']),
  yasuoBonus:bonus,ahriBonus:bonus,
  yasuoAutos:num(12).int(),ahriAutos:num(12).int(),yasuoQHits:num(6).int(),yasuoEHit:z.boolean(),yasuoEStacks:num(4).int(),yasuoRHit:z.boolean(),
  ahriQOut:z.boolean(),ahriQReturn:z.boolean(),ahriWFlames:num(3).int(),ahriEHit:z.boolean(),ahriRHits:num(3).int(),
  yasuoHpPercent:z.number().min(1).max(100),ahriHpPercent:z.number().min(1).max(100),
  enemyMinions:minionInput,allyMinions:minionInput
}).superRefine((v,c)=>{
  for(const [name,r]of [['yasuoRanks',v.yasuoRanks],['ahriRanks',v.ahriRanks]] as const){
    const regularMax=Math.min(5,Math.ceil(v.level/2));const rMax=v.level>=16?3:v.level>=11?2:v.level>=6?1:0;
    if(r.q+r.w+r.e+r.r>v.level||[r.q,r.w,r.e].some(n=>n>regularMax)||r.r>rMax)c.addIssue({code:'custom',path:[name],message:'技能点数超出英雄等级或该技能等级上限。'});
  }
  const checks:[boolean,string][]=[
    [v.yasuoQHits>0&&!v.yasuoRanks.q,'亚索 Q 未加点，不能设置命中。'],[v.yasuoEHit&&!v.yasuoRanks.e,'亚索 E 未加点，不能设置命中。'],[v.yasuoRHit&&(!v.yasuoRanks.r||!v.yasuoRanks.q||!v.yasuoQHits),'亚索 R 需要已加点并假设 Q3 击飞命中。'],
    [(v.ahriQOut||v.ahriQReturn)&&!v.ahriRanks.q,'阿狸 Q 未加点，不能设置命中。'],[v.ahriWFlames>0&&!v.ahriRanks.w,'阿狸 W 未加点，不能设置命中。'],[v.ahriEHit&&!v.ahriRanks.e,'阿狸 E 未加点，不能设置命中。'],[v.ahriRHits>0&&!v.ahriRanks.r,'阿狸 R 未加点，不能设置命中。']
  ];for(const [invalid,message]of checks)if(invalid)c.addIssue({code:'custom',message});
});
export type CombatInput=z.infer<typeof CombatInputSchema>;
export const emptyBonus=()=>({ad:0,ap:0,hp:0,armor:0,mr:0,as:0});
export function defaultCombatInput(level=3):CombatInput{
  const y={q:0,w:0,e:0,r:0};const a={q:0,w:0,e:0,r:0};
  const yOrder=['q','e','w','q','q','r','q','e','q','e','r','e','e','w','w','r','w','w'] as const;
  const aOrder=['q','w','e','q','q','r','q','w','q','w','r','w','w','e','e','r','e','e'] as const;
  for(let i=0;i<level;i++){y[yOrder[i]]++;a[aOrder[i]]++;}
  const minions=()=>({melee:0,ranged:0,siege:0,seconds:3,meleeAd:11,rangedAd:19.5,siegeAd:36});
  return {level,yasuoRanks:y,ahriRanks:a,yasuoStarter:'1086',ahriStarter:'1056',yasuoBonus:emptyBonus(),ahriBonus:emptyBonus(),yasuoAutos:2,ahriAutos:2,yasuoQHits:1,yasuoEHit:!!y.e,yasuoEStacks:0,yasuoRHit:!!y.r,ahriQOut:true,ahriQReturn:true,ahriWFlames:a.w?3:0,ahriEHit:!!a.e,ahriRHits:a.r?3:0,yasuoHpPercent:100,ahriHpPercent:100,enemyMinions:minions(),allyMinions:minions()};
}
export type CombatStats={hp:number;currentHp:number;baseAd:number;bonusAd:number;ad:number;ap:number;armor:number;mr:number;attackSpeed:number;attackInterval:number;mana:number;itemName:string;itemStats:Record<string,number>};
export type DamageLine={label:string;type:'physical'|'magic'|'true';hits:number;perHit:number;raw:number;afterResistance:number;formula:string};
export type MinionDamage={rows:DamageLine[];raw:number;afterResistance:number;assumptions:string[]};
export type CombatSide={stats:CombatStats;lines:DamageLine[];raw:number;afterResistance:number;minions:MinionDamage;incoming:number;remainingHp:number;lossPercent:number;manaCost:number};
export type CombatReport={
  status:'ready'|'unsupported';message:string;revision:string;patch:string;checkedAt:string;sources:Source[];
  input:CombatInput|null;yasuo?:CombatSide;ahri?:CombatSide;shield?:{maximum:number;minimumHpLoss:number;maximumHpLoss:number;note:string};
  comparisons:{level:number;yasuoDamage:number;ahriDamage:number;yasuoLossPercent:number;ahriLossPercent:number;assessment:string}[];
  assumptions:string[];warnings:string[];formulas:string[];
};
