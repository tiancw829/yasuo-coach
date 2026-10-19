import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { z } from 'zod';
import { AdviceInput, SettingsInput, Version, ChampionId } from '../shared/schema.js';
import { ROOT, versions, snapshot, matchup, knowledge, clearSnapshots } from './data.js';
import { ConfigStore, Coach } from './ai.js';
import { syncData } from '../scripts/sync-data.js';
export async function createApp(options:{configDir?:string;fetcher?:typeof fetch;timeout?:number;staticFiles?:boolean;sync?:typeof syncData}={}) {
  const app=Fastify({logger:false,bodyLimit:65536});const store=new ConfigStore(options.configDir||path.join(ROOT,'.local'));const coach=new Coach(options.fetcher,options.timeout);
  let updateBusy=false;let aiBusy=false;
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
    try{return await coach.analyze(await store.read(),await matchup(input.enemy,input.version),input.context,input.question,input.history);}finally{aiBusy=false;}
  });
  app.post('/api/data/update',async(_req,reply)=>{
    if(updateBusy)return reply.code(409).send({error:'数据正在更新，请稍候。'});updateBusy=true;
    try{const version=await (options.sync||syncData)(()=>{});clearSnapshots();return {version,message:'更新完成，旧版本仍然保留。攻略保留原核查版本。'};}catch{return reply.code(502).send({error:'暂时无法更新官方数据，已有缓存和攻略仍可使用。'});}finally{updateBusy=false;}
  });
  if(options.staticFiles!==false){
    await app.register(staticPlugin,{root:path.join(ROOT,'public/assets/game'),prefix:'/assets/game/',decorateReply:false});
    try{await access(path.join(ROOT,'dist/index.html'));await app.register(staticPlugin,{root:path.join(ROOT,'dist'),prefix:'/',wildcard:false});}catch{/* development uses Vite */}
  }
  app.setNotFoundHandler((_req,reply)=>reply.code(404).send({error:'页面或接口不存在。'}));
  return app;
}
