import { mkdir, writeFile, rename, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapshotSchema, Version, type Snapshot } from '../shared/schema.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDN = 'https://ddragon.leagueoflegends.com';
const clean = (s = '') => s.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\{\{.*?\}\}/g, '（数值未提供）').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
async function get(url: string, binary = false): Promise<any> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`); return binary ? Buffer.from(await r.arrayBuffer()) : await r.json(); }
    catch (e) { last = e; if (i < 2) await new Promise(r => setTimeout(r, 400 * (i + 1))); }
  }
  throw last;
}
async function pool<T>(values: T[], fn: (v: T) => Promise<void>, count = 6) {
  let i=0;let failed=false;
  const results=await Promise.allSettled(Array.from({length:count},async()=>{while(!failed&&i<values.length){try{await fn(values[i++]);}catch(e){failed=true;throw e;}}}));
  const failure=results.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failure)throw failure.reason;
}
const itemIds = ['1086','1054','1055','2003','1001','1042','1036','1033','1029','3006','3047','3111','3153','3031','6673','3036','6333','3091','3156','3072','3026','3123','3086','3140'];
async function assetsComplete(snapshot:Snapshot){
  const images=[...Object.values(snapshot.champions).flatMap(c=>[c.image,...c.spells.map(s=>s.image)]),...snapshot.runes.map(r=>r.image),...itemIds.flatMap(id=>snapshot.items[id]?[snapshot.items[id].image]:[])];
  await Promise.all(images.map(image=>access(path.join(ROOT,'public',image))));
}
export async function syncData(onProgress: (s: string) => void = console.log) {
  onProgress('正在检查拳头官方最新版本…');
  const versions = await get(`${CDN}/api/versions.json`);
  const version = Version.parse(versions[0]);
  const file = path.join(ROOT, 'data', 'snapshots', `${version}.json`);
  const assetDir = path.join(ROOT, 'public', 'assets', 'game', version);
  try{
    const cached=SnapshotSchema.parse(JSON.parse(await readFile(file,'utf8')));
    if(cached.version===version&&cached.champions.Yasuo&&Object.keys(cached.champions).length>0){
      onProgress(`正在检查 ${version} 本地数据与离线图标…`);await assetsComplete(cached);
      onProgress(`已是最新官方数据 ${version}，无需重复下载。`);return version;
    }
  }catch{/* Missing/incomplete snapshots are repaired before publishing. */}
  await mkdir(path.dirname(file), { recursive: true }); await mkdir(assetDir, { recursive: true });
  const asset = async (remote: string, name: string) => {
    const full = path.join(assetDir, name);
    try { await access(full); } catch { const bytes=await get(remote,true);await writeFile(`${full}.tmp`,bytes);await rename(`${full}.tmp`,full); }
    return `/assets/game/${version}/${name}`;
  };
  onProgress(`下载 ${version} 中文英雄、装备与符文…`);
  const [index, itemData, runeData] = await Promise.all(['champion.json', 'item.json', 'runesReforged.json'].map(f => get(`${CDN}/cdn/${version}/data/zh_CN/${f}`)));
  const snapshot: Snapshot = { version, fetchedAt: new Date().toISOString(), champions: {}, items: {}, runes: [] };
  let completed = 0;
  await pool(Object.keys(index.data), async id => {
    const d = (await get(`${CDN}/cdn/${version}/data/zh_CN/champion/${id}.json`)).data[id];
    const image = await asset(`${CDN}/cdn/${version}/img/champion/${d.image.full}`, `champion-${id}.png`);
    const spells = await Promise.all(d.spells.map(async (s: any, i: number) => ({ slot: ['Q','W','E','R'][i], name: clean(s.name), description: clean(s.description), cooldown: Array.isArray(s.cooldown) && s.cooldown.length && s.cooldown.every((n: any) => typeof n === 'number' && Number.isFinite(n) && n >= 0) ? s.cooldown : null, image: await asset(`${CDN}/cdn/${version}/img/spell/${s.image.full}`, `spell-${s.image.full}`), ...(id === 'Yasuo' && i === 0 ? { special: 'Q 的实际冷却由攻速机制缩短，不能套用普通技能急速公式；此处仅显示数据源的基础值。' } : id === 'Yasuo' && i === 2 ? { special: '下列数值是连续施放间隔，并非再次 E 同一目标的间隔。官方描述未给出完整同目标数值，本版不作猜测。' } : {}) })));
    snapshot.champions[id] = { id, key: d.key, name: d.name, title: d.title, tags: d.tags, image, stats: d.stats, passive: { name: clean(d.passive.name), description: clean(d.passive.description) }, spells };
    completed++; if (completed % 10 === 0||completed===Object.keys(index.data).length) onProgress(`正在下载 ${version}：已缓存 ${completed}/${Object.keys(index.data).length} 位英雄及技能图标`);
  });
  for (const [id, raw] of Object.entries<any>(itemData.data)) snapshot.items[id] = { id, name: clean(raw.name), description: clean(raw.description), gold: raw.gold.total, image: `/assets/game/${version}/item-${id}.png`, maps: raw.maps || {}, purchasable: !!raw.gold.purchasable && !raw.requiredAlly && !raw.requiredChampion, stats: raw.stats || {} };
  onProgress(`正在缓存 ${version} 装备图标与符文资料…`);
  await pool(itemIds.filter(id => snapshot.items[id]), async id => { await asset(`${CDN}/cdn/${version}/img/item/${id}.png`, `item-${id}.png`); });
  for (const tree of runeData) for (const slot of tree.slots) for (const rune of slot.runes) snapshot.runes.push({ id: rune.id, key: rune.key, name: rune.name, description: clean(rune.longDesc || rune.shortDesc), image: await asset(`${CDN}/cdn/img/${rune.icon}`, `rune-${rune.id}.png`), tree: tree.name });
  try { await asset(`${CDN}/cdn/img/champion/splash/Yasuo_0.jpg`, 'yasuo-splash.jpg'); } catch { onProgress('背景插画暂时无法下载，不影响攻略。'); }
  onProgress(`正在校验 ${version} 数据完整性…`);
  SnapshotSchema.parse(snapshot);await assetsComplete(snapshot);
  const temp = `${file}.tmp`; await writeFile(temp, JSON.stringify(snapshot)); await rename(temp, file);
  onProgress(`完成：${version}，${completed} 位英雄，${Object.keys(snapshot.items).length} 件装备，${snapshot.runes.length} 个符文。`);
  return version;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncData().catch(e => { console.error(e.message); process.exitCode = 1; });
