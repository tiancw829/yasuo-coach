import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './sync-data.js';

// Keep an explicit patch: downloading a new patch must not silently approve combat formulas.
const version='16.21.1',patch='16.21';
const snapshot=JSON.parse(await readFile(path.join(ROOT,'data/snapshots',`${version}.json`),'utf8'));
const dir=path.join(ROOT,'data/numerics',patch);await mkdir(dir,{recursive:true});
const rawDir=path.join(ROOT,'../../work/numeric-raw',patch);await mkdir(rawDir,{recursive:true});
const ids=Object.keys(snapshot.champions) as string[];
const fields=['baseHPModifiable','hpPerLevelModifiable','baseDamageModifiable','damagePerLevelModifiable','baseArmorModifiable','armorPerLevelModifiable','baseMR','mrPerLevel','attackSpeedModifiable','attackSpeedRatioModifiable','attackSpeedPerLevelModifiable','primaryAbilityResource'];
const checkedAt=new Date().toISOString().slice(0,10);
const statuses:Record<string,string>={};let next=0;
await Promise.all(Array.from({length:6},async()=>{
  while(next<ids.length){const id=ids[next++],lower=id.toLowerCase();
    const url=`https://raw.communitydragon.org/${patch}/game/data/characters/${lower}/${lower}.bin.json`;
    try{
      let raw:any;try{if(process.argv.includes('--refresh'))throw Error('Refresh requested');raw=JSON.parse(await readFile(path.join(rawDir,`${lower}.json`),'utf8'));}catch{
        let failure:unknown;for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`HTTP ${r.status}`);raw=await r.json();break;}catch(e){failure=e;}}
        if(!raw)throw failure;await writeFile(path.join(rawDir,`${lower}.json`),JSON.stringify(raw));
      }
      const entries=Object.entries(raw) as [string,any][];
      const rootEntry=entries.find(([k])=>k.endsWith('/CharacterRecords/Root'));if(!rootEntry)throw Error('Missing root');
      const root=rootEntry[1];
      const main=(root.spells??[]).slice(0,4) as string[];
      const spells=entries.filter(([key,v])=>v?.mSpell&&(main.includes(key)||v.mSpell.DataValues?.length||v.mSpell.mSpellCalculations||v.mSpell.mEffectAmount)).filter(([k])=>!/skin\d|skinmanager/i.test(k)).map(([key,v])=>{
        const s=v.mSpell,slotIndex=main.findIndex(k=>k.toLowerCase()===key.toLowerCase());
        return {key,slot:slotIndex<0?null:['Q','W','E','R'][slotIndex],dataValues:(s.DataValues??[]).map((d:any)=>({name:d.name,values:d.values})),calculations:s.mSpellCalculations??{},effects:s.mEffectAmount??[],coefficient:s.mCoefficient??null,coefficient2:s.mCoefficient2??null,cooldown:s.cooldownTime??null,cost:s.mana??null,range:s.castRange??null};
      });
      const output={id,name:snapshot.champions[id].name,version,patch,checkedAt,source:{id:`numeric-${id}`,label:`CommunityDragon 数值资料 · ${snapshot.champions[id].name} · ${patch}`,url,patch,checkedAt},root:Object.fromEntries(fields.map(k=>[k,root[k]??null])),mainSpells:main,spells};
      const target=path.join(dir,`${id}.json`);await writeFile(`${target}.tmp`,JSON.stringify(output));await rename(`${target}.tmp`,target);statuses[id]='ready';
    }catch(e){statuses[id]='unavailable';console.error(`${id}: ${e instanceof Error?e.message:'下载失败'}`);}
    if(Object.keys(statuses).length%20===0)console.log(`数值资料 ${Object.keys(statuses).length}/${ids.length}`);
  }
}));
const manifest={version,patch,checkedAt,revision:`numerics-${patch}-v1`,champions:Object.fromEntries(ids.map(id=>[id,statuses[id]]))};
await writeFile(path.join(dir,'manifest.json.tmp'),JSON.stringify(manifest,null,2));await rename(path.join(dir,'manifest.json.tmp'),path.join(dir,'manifest.json'));
console.log(`完成：${Object.values(statuses).filter(s=>s==='ready').length}/${ids.length} 英雄。原始技能字段不等于已经核查的伤害公式。`);
