import test from 'node:test';
import assert from 'node:assert/strict';
import { DataUpdater } from '../server/data-updater.js';

test('upgrade exposes progress, deduplicates requests and only invalidates caches after success',async()=>{
  let finish!:(version:string)=>void;let progress!:(message:string)=>void;let calls=0;let cleared=0;
  const updater=new DataUpdater(async p=>{calls++;progress=p;return new Promise<string>(resolve=>{finish=resolve;});},async()=>['16.20.1'],()=>{cleared++;});
  assert.equal(updater.current().state,'idle');const first=updater.start();assert.equal(first.state,'running');assert.ok(first.id);assert.equal(updater.start().id,first.id);
  await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(cleared,0);
  progress('已缓存 40/173 位英雄');assert.match(updater.current().message,/40\/173/);assert.equal(updater.current().version,null);
  finish('16.21.1');const done=await updater.settled();assert.equal(done.state,'success');assert.equal(done.version,'16.21.1');assert.equal(cleared,1);assert.match(done.message,/已升级到/);assert.ok(done.finishedAt);
});
test('latest cached version is reported without claiming a new upgrade',async()=>{
  const updater=new DataUpdater(async()=> '16.21.1',async()=>['16.21.1','16.20.1'],()=>{});
  updater.start();const done=await updater.settled();assert.equal(done.state,'success');assert.match(done.message,/已是最新官方数据/);
});
test('failed upgrade does not invalidate old data and can be retried',async()=>{
  let calls=0;let cleared=0;
  const updater=new DataUpdater(async()=>{calls++;if(calls===1)throw new Error('private upstream details');return '16.21.1';},async()=>['16.20.1'],()=>{cleared++;});
  const first=updater.start();const failed=await updater.settled();assert.equal(failed.state,'error');assert.equal(failed.version,null);assert.equal(cleared,0);assert.match(failed.message,/已有缓存/);assert.ok(!failed.message.includes('private'));
  assert.notEqual(updater.start().id,first.id);assert.equal((await updater.settled()).state,'success');assert.equal(cleared,1);
});
test('invalid version from sync never becomes a successful upgrade',async()=>{
  let cleared=false;const updater=new DataUpdater(async()=> '../broken',async()=>[],()=>{cleared=true;});updater.start();assert.equal((await updater.settled()).state,'error');assert.equal(cleared,false);
});
