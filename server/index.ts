import { createApp } from './app.js';
const app=await createApp();
let vite:Awaited<ReturnType<typeof import('vite')['createServer']>>|undefined;
if(process.argv.includes('--dev')){const {createServer}=await import('vite');vite=await createServer();app.addHook('onClose',async()=>{await vite?.close();});}
try{await app.listen({host:'127.0.0.1',port:3210});console.log('御风 · 亚索对线手册  http://127.0.0.1:3210');}catch(e:any){console.error(e.code==='EADDRINUSE'?'3210 端口已被占用。如果已启动，请直接打开 http://127.0.0.1:3210':'启动失败：'+e.message);process.exit(1);}
if(vite){await vite.listen();console.log('开发界面：http://127.0.0.1:5173');}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{await app.close();process.exit(0);});
