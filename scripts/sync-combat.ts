import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './sync-data.js';

// Explicit reviewed formula whitelist. Adding another hero requires reviewing its calculations.
const patch='16.21';
const ids=['yasuo','ahri','sru_orderminionmelee','sru_orderminionranged','sru_orderminionsiege'];
const out:any={revision:'combat-16.21-v1',patch,version:'16.21.1',checkedAt:new Date().toISOString().slice(0,10),sources:[],characters:{}};
for(const id of ids){
  const url=`https://raw.communitydragon.org/${patch}/game/data/characters/${id}/${id}.bin.json`;
  let raw:any;
  if(process.argv.includes('--from-work'))raw=JSON.parse(await readFile(path.join(ROOT,'../../work/combat',`${id}.json`),'utf8'));
  else{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`${id}: HTTP ${r.status}`);raw=await r.json();}
  const entries=Object.entries(raw) as [string,any][];
  const root=entries.find(([k])=>k.endsWith('/CharacterRecords/Root'));
  if(!root)throw Error(`Missing ${id} root`);
  const rootFields=['baseHPModifiable','hpPerLevelModifiable','baseDamageModifiable','damagePerLevelModifiable','baseArmorModifiable','armorPerLevelModifiable','baseMR','mrPerLevel','attackSpeedModifiable','attackSpeedRatioModifiable','attackSpeedPerLevelModifiable','primaryAbilityResource','basicAttack'];
  const spells=entries.filter(([,v])=>v?.mSpell?.mSpellCalculations||v?.mSpell?.DataValues).map(([key,v])=>({key,DataValues:v.mSpell.DataValues??[],calculations:v.mSpell.mSpellCalculations??{},mana:v.mSpell.mana??null,cooldown:v.mSpell.cooldownTime??null}));
  out.characters[id]={rootKey:root[0],root:Object.fromEntries(rootFields.filter(k=>root[1][k]!==undefined).map(k=>[k,root[1][k]])),spells};
  out.sources.push({id:`combat-${id}`,label:`CommunityDragon 游戏文件解析 · ${id} · ${patch}`,url,patch,checkedAt:out.checkedAt});
}
await mkdir(path.join(ROOT,'data/combat'),{recursive:true});const file=path.join(ROOT,'data/combat',`${patch}.json`);await writeFile(file+'.tmp',JSON.stringify(out,null,2));await rename(file+'.tmp',file);console.log(`Saved ${file}; review formulas before enabling another patch.`);
