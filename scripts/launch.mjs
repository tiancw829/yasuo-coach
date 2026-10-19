import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const address='http://127.0.0.1:3210';
const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
function openBrowser(){if(process.platform==='win32'){spawn('rundll32.exe',['url.dll,FileProtocolHandler',address],{stdio:'ignore',detached:true,windowsHide:true}).unref();}else{spawn(process.platform==='darwin'?'open':'xdg-open',[address],{stdio:'ignore',detached:true}).unref();}}
async function status(){try{const r=await fetch(`${address}/api/health`,{signal:AbortSignal.timeout(1500)});return await r.json();}catch{return null;}}
async function runNpm(args){if(!existsSync(npmCli))throw new Error('找不到 Node.js 附带的 npm，请安装 Node.js 24 LTS。');await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[npmCli,...args],{cwd:root,stdio:'inherit',windowsHide:true});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`npm ${args[0]} 失败（${code}）`)));});}
try{
  const current=await status();if(current?.name==='yasuo-lane-coach'){console.log(`已在运行，打开 ${address}`);openBrowser();process.exit(0);}if(current)throw new Error('3210 端口已由其他服务占用，请先关闭那个服务。');
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<12))throw new Error('需要 Node.js 22.12 或以上版本，推荐 Node.js 24 LTS。');
  if(!existsSync('node_modules/tsx')){console.log('首次启动：安装依赖，需要联网…');await runNpm(['ci','--no-audit','--no-fund']);}
  console.log('检查并构建网页…');await runNpm(['run','build']);
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,stdio:'inherit',windowsHide:true});
  child.on('error',e=>{console.error(e.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code||0;});
  for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,300));if((await status())?.name==='yasuo-lane-coach'){console.log('\n网页已就绪。保留此窗口；关闭窗口会停止本地服务。');openBrowser();break;}}
  process.on('SIGINT',()=>{child.kill();});process.on('SIGTERM',()=>{child.kill();});
}catch(e){console.error(`\n启动失败：${e.message}`);process.exitCode=1;}
