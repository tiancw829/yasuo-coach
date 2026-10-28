import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataUpdateStatus } from '../shared/schema.js';

async function request(method:'GET'|'POST'):Promise<DataUpdateStatus>{
  const response=await fetch('/api/data/update',{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'无法获取升级状态，请稍后重试。');return data;
}
export function useDataUpdate(onSuccess:(version:string)=>Promise<void>){
  const [status,setStatus]=useState<DataUpdateStatus|null>(null);
  const [starting,setStarting]=useState(false);const [error,setError]=useState('');
  const callback=useRef(onSuccess);callback.current=onSuccess;
  const seen=useRef<string|null>(null);const mounted=useRef(false);const locked=useRef(false);
  const accept=useCallback(async(next:DataUpdateStatus)=>{
    if(!mounted.current)return;
    setStatus(next);if(next.state!=='idle')setError('');
    if(next.state==='success'&&next.version&&next.id!==seen.current){
      seen.current=next.id;
      try{await callback.current(next.version);}catch{if(mounted.current)setError('数据已升级，但页面资料刷新失败。请刷新网页重试。');}
    }
  },[]);
  useEffect(()=>{
    mounted.current=true;let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{const next=await request('GET');if(cancelled)return;await accept(next);}
      catch{if(!cancelled)setError('暂时无法读取升级进度，正在重新连接；本地服务恢复后将继续显示。');}
      if(!cancelled)timer=setTimeout(poll,1500);
    }
    void poll();return()=>{cancelled=true;mounted.current=false;clearTimeout(timer);};
  },[accept]);
  const start=useCallback(async()=>{
    if(locked.current)return;locked.current=true;setStarting(true);setError('');
    try{await accept(await request('POST'));}
    catch(e:any){if(mounted.current)setError(e.message||'无法启动升级，请检查本地服务。');}
    finally{locked.current=false;if(mounted.current)setStarting(false);}
  },[accept]);
  return {status,error,start,busy:starting||status?.state==='running'};
}
