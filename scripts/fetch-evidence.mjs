import { mkdir, writeFile } from 'node:fs/promises';
const ids = ['Yasuo','Ahri','Zed','Yone','Akali','Fizz','Annie','Lux','Syndra','Orianna','Viktor','Leblanc','Sylas','Galio','Irelia','Talon','Anivia','Cassiopeia','Malzahar','Veigar','Aurora'];
const evidence = {};
let n=0;
await Promise.all(Array.from({length:4}, async()=>{while(n<ids.length){ const id=ids[n++]; try { const url=`https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions/${id}.json`; const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(String(r.status));const c=await r.json();const patch=c.icon?.match(/cdn\/([^/]+)/)?.[1]||'unknown';evidence[id]={url,patch,checkedAt:new Date().toISOString().slice(0,10),abilities:Object.fromEntries(Object.entries(c.abilities).map(([slot,abilities])=>[slot,abilities.map(a=>({name:a.name,projectile:a.projectile,notes:a.notes,effects:a.effects,cooldown:a.cooldown}))]))}; console.log(id,patch,Object.entries(evidence[id].abilities).map(([s,a])=>`${s}: ${a.map(x=>x.projectile).join('/')}`).join(' | ')); } catch(e){console.log(id,e.message);} }}));
await mkdir(new URL('../data/',import.meta.url),{recursive:true});
await writeFile(new URL('../data/mechanics-evidence.json',import.meta.url),JSON.stringify(evidence,null,2));
