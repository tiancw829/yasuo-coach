import { z } from 'zod';
import type { Source } from './schema.js';
export const NumericInputSchema=z.object({
  level:z.number().int().min(1).max(18),
  ranks:z.object({Q:z.number().int().min(0).max(5),W:z.number().int().min(0).max(5),E:z.number().int().min(0).max(5),R:z.number().int().min(0).max(3)}),
  item:z.enum(['none','1056','1082','1055','1054','1086']),
  bonusAd:z.number().finite().min(0).max(500),ap:z.number().finite().min(0).max(1500),bonusMr:z.number().finite().min(0).max(300),
  targetArmor:z.number().finite().min(-100).max(500).nullable(),targetMr:z.number().finite().min(-100).max(500).nullable()
}).superRefine((v,c)=>{
  const max=Math.min(5,Math.ceil(v.level/2));const rmax=v.level>=16?3:v.level>=11?2:v.level>=6?1:0;
  if(Object.values(v.ranks).reduce((a,b)=>a+b,0)>v.level||[v.ranks.Q,v.ranks.W,v.ranks.E].some(n=>n>max)||v.ranks.R>rmax)c.addIssue({code:'custom',message:'技能点数超出等级限制。分项计算使用常规英雄加点规则；变身英雄仅提供原始资料。'});
});
export type NumericInput=z.infer<typeof NumericInputSchema>;
export function defaultNumericInput(level=3):NumericInput{
  const ranks={Q:0,W:0,E:0,R:0};const order=['Q','W','E','Q','Q','R','Q','W','Q','W','R','W','W','E','E','R','E','E'] as const;
  for(let i=0;i<level;i++)ranks[order[i]]++;
  return {level,ranks,item:'none',bonusAd:0,ap:0,bonusMr:0,targetArmor:null,targetMr:null};
}
export type NumericSpell={key:string;slot:string|null;name:string;cooldown:number[]|null;cost:number[]|null;range:number[]|null;dataValues:{name:string;values:number[]|null}[];calculations:Record<string,string>};
export type NumericHero={id:string;name:string;source:Source;stats:Record<string,number|null>;spells:NumericSpell[];extraSpells:NumericSpell[]};
export type SkillComponent={slot:string;label:string;type:'physical'|'magic'|'true';raw:number;afterResistance:number;formula:string;note:string};
export type NumericReport={status:'ready'|'unavailable'|'versionMismatch';message:string;revision:string;version:string;patch:string;checkedAt:string;coverage:number;input:NumericInput;enemy:NumericHero|null;player:NumericHero|null;components:SkillComponent[];target:{armor:number;mr:number}|null;limits:string[];sources:Source[]};
