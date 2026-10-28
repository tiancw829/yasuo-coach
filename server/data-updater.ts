import { randomUUID } from 'node:crypto';
import { Version, type DataUpdateStatus } from '../shared/schema.js';

export class DataUpdater {
  private status:DataUpdateStatus={id:null,state:'idle',message:'可一键获取最新官方数据。',version:null,startedAt:null,finishedAt:null};
  private task:Promise<void>=Promise.resolve();
  constructor(private sync:(progress:(message:string)=>void)=>Promise<string>,private cachedVersions:()=>Promise<string[]>,private onSuccess:()=>void){}
  current():DataUpdateStatus{return {...this.status};}
  start(){
    // All tabs share one job. Repeated clicks return its status instead of
    // starting competing downloads and file renames.
    if(this.status.state==='running')return this.current();
    this.status={id:randomUUID(),state:'running',message:'正在检查拳头官方最新版本…',version:null,startedAt:new Date().toISOString(),finishedAt:null};
    this.task=this.run();return this.current();
  }
  private async run(){
    try{
      const before=await this.cachedVersions();
      const version=Version.parse(await this.sync(message=>{this.status={...this.status,message};}));
      this.onSuccess();
      this.status={...this.status,state:'success',version,finishedAt:new Date().toISOString(),message:before.includes(version)?`已是最新官方数据 ${version}，缓存已检查。`:`已升级到官方数据 ${version}，旧版本已保留。`};
    }catch{
      this.status={...this.status,state:'error',version:null,finishedAt:new Date().toISOString(),message:'暂时无法升级官方数据，已有缓存和攻略仍可使用。请检查网络后重试。'};
    }
  }
  async settled(){await this.task;return this.current();}
}
