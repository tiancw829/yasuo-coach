import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { z } from 'zod';
import { AdviceInput, SettingsInput, Version, ChampionId } from '../shared/schema.js';
import { ROOT, versions, snapshot, matchup, knowledge, clearSnapshots } from './data.js';
import { ConfigStore, Coach } from './ai.js';
import { syncData } from '../scripts/sync-data.js';
import { DataUpdater } from './data-updater.js';
import { LolpsProvider, withLolps } from './lolps.js';
import { combatReport, withCombat } from './combat.js';
import { CombatInputSchema } from '../shared/combat.js';
import { NumericInputSchema } from '../shared/numerics.js';
import { numericReport, withNumerics } from './numerics.js';
export async function createApp(options:{configDir?:string;fetcher?:typeof fetch;timeout?:number;staticFiles?:boolean;sync?:typeof syncData;lolps?:Pick<LolpsProvider,'get'>}={}) {
  const app=Fastify({logger:false,bodyLimit:65536});const store=new ConfigStore(options.configDir||path.join(ROOT,'.local'));const coach=new Coach(options.fetcher,options.timeout);
  const updater=new DataUpdater(options.sync||syncData,versions,()=>{clearSnapshots();coach.clear();});
  const lolps=options.lolps||new LolpsProvider(path.join(store.dir,'lolps-cache'));
  let aiBusy=false;
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY');
    if(req.url.startsWith('/api')){
      reply.header('Cache-Control','no-store');
      const origin=req.headers.origin;
      if((origin&&!/^http:\/\/(127\.0\.0\.1|localhost):(3210|5173)$/.test(origin))||req.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'仅允许本地页面访问。'});
      const host=req.headers.host||'';
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))return reply.code(403).send({error:'不允许的主机名。'});
    }
  });
  app.setErrorHandler((err:any,_req,reply)=>{
    if(err instanceof z.ZodError)return reply.code(400).send({error:err.issues[0]?.message||'输入格式不正确。'});
    const status=err.statusCode&&err.statusCode>=400&&err.statusCode<600?err.statusCode:500;
    reply.code(status).send({error:status===500?'本地服务处理失败，请查看数据与配置是否完整。':err.message});
  });
  app.get('/api/health',async()=>({ok:true,name:'yasuo-lane-coach',version:'1.0.0'}));
  app.get('/api/meta',async()=>({versions:await versions(),reviewedPatch:knowledge.reviewedPatch,refinedCount:knowledge.guides.length,verification:knowledge.verification}));
  app.get('/api/champions',async(req)=>{
    const {version}=z.object({version:Version}).parse(req.query);const s=await snapshot(version);
    return Object.values(s.champions).map(c=>({id:c.id,name:c.name,title:c.title,image:c.image,aliases:knowledge.guides.find(g=>g.enemy===c.id)?.aliases||[],refined:knowledge.guides.some(g=>g.enemy===c.id)}));
  });
  app.get('/api/matchup',async(req)=>{const q=z.object({enemy:ChampionId,version:Version}).parse(req.query);return matchup(q.enemy,q.version);});
  app.get('/api/settings',async()=>store.public());
  app.put('/api/settings',async(req)=>{
    const input=SettingsInput.parse(req.body);const previous=await store.read();
    const s={baseUrl:input.baseUrl.replace(/\/+$/,''),model:input.model,apiKey:input.clearKey?'':input.apiKey?.trim()||previous.apiKey};
    if(previous.apiKey&&s.baseUrl!==previous.baseUrl&&!input.apiKey?.trim()&&!input.clearKey)throw Object.assign(new Error('更换接口地址时请重新填写密钥，避免把原密钥发送到其他服务。'),{statusCode:400});
    await store.save(s);coach.clear();return store.public();
  });
  app.post('/api/settings/test',async()=>{if(aiBusy)throw Object.assign(new Error('已有 AI 请求进行中，请稍候。'),{statusCode:409});aiBusy=true;try{return await coach.test(await store.read(),await matchup('Ahri',(await versions())[0]));}finally{aiBusy=false;}});
  app.post('/api/advice',async(req)=>{
    const input=AdviceInput.parse(req.body);if(aiBusy)throw Object.assign(new Error('已有 AI 请求进行中，请稍候。'),{statusCode:409});aiBusy=true;
    try{const settings=await store.read();if(!settings.apiKey||!settings.model||!settings.baseUrl)throw Object.assign(new Error('请先在设置中填写接口地址、模型名称和密钥。'),{statusCode:400});let m=await matchup(input.enemy,input.version);m=withCombat(m,await combatReport(m,input.combat));m=withNumerics(m,await numericReport(m,input.numeric));if(input.useLolps)m=withLolps(m,await lolps.get(m));return await coach.analyze(settings,m,input.context,input.question,input.history);}finally{aiBusy=false;}
  });
  app.post('/api/combat',async(req)=>{const input=z.object({enemy:ChampionId,version:Version,combat:CombatInputSchema.optional()}).parse(req.body);return combatReport(await matchup(input.enemy,input.version),input.combat);});
  app.post('/api/numerics',async(req)=>{const input=z.object({enemy:ChampionId,version:Version,numeric:NumericInputSchema.optional()}).parse(req.body);return numericReport(await matchup(input.enemy,input.version),input.numeric);});
  app.post('/api/references/lolps',async(req)=>{const input=z.object({enemy:ChampionId,version:Version,refresh:z.boolean().default(false)}).parse(req.body);return lolps.get(await matchup(input.enemy,input.version),input.refresh);});
  app.post('/api/data/update',async(_req,reply)=>reply.code(202).send(updater.start()));
  app.get('/api/data/update',async()=>updater.current());
  if(options.staticFiles!==false){
    await app.register(staticPlugin,{root:path.join(ROOT,'public/assets/game'),prefix:'/assets/game/',decorateReply:false});
    try{await access(path.join(ROOT,'dist/index.html'));await app.register(staticPlugin,{root:path.join(ROOT,'dist'),prefix:'/',wildcard:false});}catch{/* development uses Vite */}
  }
  app.setNotFoundHandler((_req,reply)=>reply.code(404).send({error:'页面或接口不存在。'}));
  return app;
}
