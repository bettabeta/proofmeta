// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyPairFromPrivate, createEnvelope } from '../../packages/sdk-ts/dist/index.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Preload instrumentation is confined to subprocesses; production sources stay intact.
const preload = String.raw`
const cp=require('node:child_process'),fs=require('node:fs'),net=require('node:net'),http=require('node:http');
const mode=process.env.F1_MODE,kind=process.env.F1_KIND;
const log=e=>fs.appendFileSync(process.env.F1_AUDIT,JSON.stringify({...e,pid:e.pid??process.pid,time:Date.now()})+'\n');
const spawn=cp.spawn;
cp.spawn=function(command,args,opts){
 const k=args.includes('--provider-child')||args.some(x=>x.endsWith('/examples/provider/server.mjs'))?'provider':args.some(x=>x.endsWith('/examples/consumer/client.mjs'))?'consumer':'other';
 if(k==='provider'&&mode==='delayed-start') args=['--input-type=module','--eval',"setTimeout(()=>import("+JSON.stringify(require('node:url').pathToFileURL(args[0]).href)+"),2000)",'--','--provider-child'];
 if(k==='consumer'&&['no-marker','marker-exit1'].includes(mode)) args=['--eval',mode==='no-marker'?'process.exit(0)':"console.log('[consumer] full Tier-1 flow completed OK');process.exit(1)"];
 const child=spawn.call(this,command,args,{...opts,env:{...opts.env,F1_KIND:k}});
 log({event:'spawn',kind:k,pid:child.pid});
 child.once('exit',(code,signal)=>log({event:'exit',kind:k,pid:child.pid,code,signal}));
 child.once('close',(code,signal)=>log({event:'close',kind:k,pid:child.pid,code,signal}));
 const kill=child.kill;child.kill=function(signal){log({event:'kill',kind:k,pid:child.pid,signal});return kill.call(this,signal);};return child;
};
if(kind==='provider'){
 log({event:'provider-start'});
 if(mode==='exit-before') process.exit(7);
 if(mode==='false-console'){console.log('listening 127.0.0.1:4101');setInterval(()=>{},1000);}
const fixtureIgnoreTerm=()=>log({event:'ignored-term'});
if(mode==='ignore-term')process.on('SIGTERM',fixtureIgnoreTerm);
 const send=process.send?.bind(process);
 if(send)process.send=function(msg,...args){
   if(mode==='ignore-term'&&msg?.type==='provider-bound'){
    for(const listener of process.listeners('SIGTERM'))if(listener!==fixtureIgnoreTerm)process.removeListener('SIGTERM',listener);
    log({event:'fixture-term-ready',kind:'provider',pid:process.pid,listenerCount:process.listeners('SIGTERM').length,ownsFixtureIgnoreTerm:process.listeners('SIGTERM').includes(fixtureIgnoreTerm)});
   }
   log({event:'ipc',message:msg});
   if(mode==='wrong-pid'||mode==='ignore-term')msg={...msg,pid:process.pid+1000000};
   if(mode==='wrong-port')msg={...msg,address:{...msg.address,port:4102}};
   if(mode==='wrong-type')msg={...msg,type:'console-listening'};
   if(mode==='wrong-family')msg={...msg,address:{...msg.address,family:'IPv6'}};
   return send(msg,...args);
 };
 const listen=net.Server.prototype.listen;
 net.Server.prototype.listen=function(...args){
  this.once('listening',()=>{log({event:'actual-bound',address:this.address()});});
  if(mode==='false-console')return this;
  if(['delayed-bind','delayed-exit','readiness-budget'].includes(mode)){
   log({event:'listen-deferred'});setTimeout(()=>{if(mode==='delayed-exit'){log({event:'planned-exit'});process.exit(7);}else listen.apply(this,args);},mode==='readiness-budget'?3500:2000);return this;
  }return listen.apply(this,args);
 };
 const emit=http.Server.prototype.emit;
 http.Server.prototype.emit=function(event,...args){
  if(event==='request'){
   const [req]=args;log({event:'request',method:req.method,url:req.url});
   if(mode==='readiness-budget')return true;
   if(req.method==='POST'&&['post-hang','exit-during','disconnect-during'].includes(mode)){
    if(mode==='exit-during')setTimeout(()=>{log({event:'planned-exit'});process.exit(7);},100);
    if(mode==='disconnect-during')setTimeout(()=>{log({event:'planned-disconnect'});process.disconnect();},100);
    return true;
   }
  }return emit.call(this,event,...args);
 };
}
require('node:module').syncBuiltinESMExports();
`;
async function foreignListener() {
 const key = await keyPairFromPrivate(new Uint8Array(32).fill(41));
 const sign = (payload, extra = {}) => createEnvelope({payload,author:key.did,privateKey:key.privateKey,timestamp:'2026-01-01T00:00:00Z',...extra});
 const manifest = await sign({type:'manifest',provider:{id:key.did},request_endpoint:'http://127.0.0.1:4101/requests',items:[{item_id:'qa',name:'QA',available_licenses:['qa']}],license_types:[{id:'qa',terms_url:'http://127.0.0.1:4101/terms',terms_hash:'sha256:'+'0'.repeat(64),scope:['commercial']}]});
 let chain,posts=0,gets=0;const errors=[];
 const server=createServer(async(req,res)=>{try{
  let body=manifest;
  if(req.method==='POST'){
   posts++;const chunks=[];for await(const b of req)chunks.push(b);const open=JSON.parse(Buffer.concat(chunks));
   const pending=await sign({type:'status.update',request_id:open.payload.request_id,status:'PENDING'},{in_reply_to:open.payload_hash});
   const granted=await sign({type:'status.update',request_id:open.payload.request_id,status:'GRANTED'},{in_reply_to:pending.payload_hash});chain=[open,pending,granted];body={chain};
  }else if(req.url.startsWith('/requests/')){gets++;body=chain.at(-1);}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(body));
 }catch(e){errors.push(String(e));res.statusCode=500;res.end('fixture error');}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4101,'127.0.0.1',resolve);});
 return {server,errors,counts:()=>({posts,gets})};
}
async function run(mode,{foreign=false,script=path.join(root,'scripts/e2e.mjs')}={}) {
 const scratch=process.env.TMPDIR||path.join(process.env.HOME,'.cache/proofmeta');await mkdir(scratch,{recursive:true});
 const dir=await mkdtemp(path.join(scratch,'f1-supervisor-'));const audit=path.join(dir,'events.jsonl'),hook=path.join(dir,'audit.cjs');
 await writeFile(audit,'');await writeFile(hook,preload);
 let fixture,result,child;
 try{
  if(foreign)fixture=await foreignListener();
  const started=Date.now();child=spawn(process.execPath,[script],{env:{...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --require=${hook}`,F1_MODE:mode,F1_AUDIT:audit},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const watchdog=setTimeout(()=>child.kill('SIGKILL'),23000);
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(watchdog);
  const events=(await readFile(audit,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const alive=[];for(const e of events.filter(e=>e.event==='spawn')){try{process.kill(e.pid,0);alive.push(e.pid);}catch{}}
  result={mode,...status,elapsedMs:Date.now()-started,output,events,alive,foreignAlive:fixture?(await fetch('http://127.0.0.1:4101/.well-known/proofmeta.json',{signal:AbortSignal.timeout(1000)})).ok:null,counts:fixture?.counts(),errors:fixture?.errors};
  if(process.env.F1_EVIDENCE){await mkdir(process.env.F1_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.F1_EVIDENCE,`${mode}.json`),JSON.stringify(result,null,2));}
  assert.deepEqual(alive,[],'all own children must be reaped');assert.equal(status.signal,null,output);
  return result;
 }finally{
  if(fixture){fixture.server.closeAllConnections();await new Promise(r=>fixture.server.close(r));}
  await rm(dir,{recursive:true,force:true});
 }
}
function fail(r,noConsumer=false){assert.equal(r.code,1,r.output);assert.doesNotMatch(r.output,/\[e2e\] PASS/);if(noConsumer)assert.equal(r.events.some(e=>e.event==='spawn'&&e.kind==='consumer'),false,r.output);}
for(const mode of ['collision','delayed-start','delayed-bind','delayed-exit'])test(`signed foreign ${mode}: no owned bind, no consumer, foreign survives`,{timeout:25000},async()=>{
 const r=await run(mode,{foreign:true});fail(r,true);assert.equal(r.foreignAlive,true);assert.deepEqual(r.counts,{posts:0,gets:0});assert.deepEqual(r.errors,[]);assert.equal(r.events.some(e=>e.event==='actual-bound'),false);
 if(mode==='delayed-start'){assert.ok(r.events.some(e=>e.event==='provider-start'));assert.ok(r.elapsedMs>=2000);assert.match(r.output,/EADDRINUSE/);}
 if(mode==='delayed-exit')assert.ok(r.events.some(e=>e.event==='planned-exit'));
});
for(const mode of ['exit-before','false-console','wrong-type','wrong-port','wrong-pid','wrong-family'])test(`own child ${mode}: fail before consumer`,{timeout:25000},async()=>{const r=await run(mode);fail(r,true);if(mode.startsWith('wrong'))assert.ok(r.events.some(e=>e.event==='ipc'));});
test('TC6: owned provider exits while real consumer has an active POST',{timeout:25000},async()=>{const r=await run('exit-during');fail(r);assert.ok(r.events.some(e=>e.event==='actual-bound'));assert.ok(r.events.some(e=>e.event==='request'&&e.method==='POST'));assert.ok(r.events.some(e=>e.event==='exit'&&e.kind==='provider'&&e.code===7));assert.match(r.output,/provider.*during consumer/);});
test('owned IPC disconnect during active consumer fails closed',{timeout:25000},async()=>{const r=await run('disconnect-during');fail(r);assert.ok(r.events.some(e=>e.event==='planned-disconnect'));assert.ok(r.elapsedMs<6000,String(r.elapsedMs));});
test('TC7: SIGTERM-ignoring own child gets bounded SIGKILL and close/reaping',{timeout:25000},async()=>{const r=await run('ignore-term');fail(r,true);assert.ok(r.events.some(e=>e.event==='ignored-term'));assert.ok(r.events.some(e=>e.event==='kill'&&e.signal==='SIGKILL'));assert.ok(r.events.some(e=>e.event==='close'&&e.kind==='provider'&&e.signal==='SIGKILL'));assert.ok(r.elapsedMs>=1900&&r.elapsedMs<6000);});
test('owned-live POST hang reaches actual 15s consumer deadline',{timeout:25000},async()=>{const r=await run('post-hang');fail(r);const post=r.events.find(e=>e.event==='request'&&e.method==='POST');assert.ok(post);const consumer=r.events.find(e=>e.event==='spawn'&&e.kind==='consumer');const end=r.events.find(e=>e.event==='close'&&e.kind==='consumer');assert.ok(end.time-consumer.time>=14900);assert.ok(r.elapsedMs<20000);const providerExit=r.events.find(e=>e.event==='exit'&&e.kind==='provider');assert.ok(providerExit.time>=end.time);assert.match(r.output,/consumer.*(timeout|deadline|exited)/);});
test('owned readiness shares original 5s deadline including delayed binding',{timeout:25000},async()=>{const r=await runSupervisor('readiness-budget');fail(r,true);readinessGate(r);cleanupGate(r);});
for(const mode of ['no-marker','marker-exit1'])test(`consumer negative ${mode}`,{timeout:25000},async()=>{const r=await run(mode);fail(r);assert.ok(r.events.some(e=>e.event==='actual-bound'));assert.ok(r.events.some(e=>e.event==='spawn'&&e.kind==='consumer'));});
test('positive: real owned provider and unchanged signed consumer flow',{timeout:25000},async()=>{const r=await run('positive');assert.equal(r.code,0,r.output);assert.match(r.output,/\[e2e\] PASS/);assert.match(r.output,/\[consumer\] full Tier-1 flow completed OK/);const bound=r.events.find(e=>e.event==='actual-bound'),consumer=r.events.find(e=>e.event==='spawn'&&e.kind==='consumer');assert.ok(bound&&consumer&&bound.time<=consumer.time);assert.ok(r.events.some(e=>e.event==='request'&&e.method==='POST'));});
// ── Supervisor-level preload: wraps Date.now/fetch/spawn in the supervisor process.
// Captures authentic anchor (D=value+5000 from e2e.mjs callsite), actual cancel events,
// and direct spawn call_time (before child.pid is assigned). Uses original unwrapped clock for log.
import { createHash, verify as verifySignature } from 'node:crypto';
const supervisorPreload = String.raw`
const cp=require('node:child_process'),fs=require('node:fs'),net=require('node:net'),http=require('node:http');
const _now=Date.now.bind(Date),mode=process.env.F1_MODE||'',kind=process.env.F1_KIND||'supervisor';
const log=e=>fs.appendFileSync(process.env.F1_AUDIT,JSON.stringify({...e,pid:e.pid??process.pid,time:_now()})+String.fromCharCode(10));
if(kind==='supervisor'){
 let budgetClock,fetchClock,fetchId=0;
 Date.now=function(){
  const value=_now(),stack=new Error().stack||'';
  if(JSON.parse(process.env.F1_ANCHOR_LINES).some(line=>stack.includes(process.env.F1_SOURCE+':'+line+':'))){
   const D=value+5000;
   // Keep the original D immutable, but publish every actual assignment clock call.
   const frame=stack.split('\n').find(line=>line.includes(process.env.F1_SOURCE+':'));
   const originLine=Number(frame?.match(/:(\d+):\d+\)?$/)?.[1]);
   global.__f1_anchor??={value,D,stack,pid:process.pid};
   log({event:'anchor',value,D,stack,originLine,ppid:process.ppid,source:process.env.F1_SOURCE,sourceHash:process.env.F1_SOURCE_HASH});
  }
  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_BUDGET_LINE+':'))budgetClock=value;
  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_FETCH_LINE+':'))fetchClock=value;
  return value;
 };
 const _setTimeout=globalThis.setTimeout;
 globalThis.setTimeout=function(callback,ms,...args){
  const stack=new Error().stack||'';
  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_TIMER_LINE+':')){
   const phase=stack.includes(process.env.F1_SOURCE+':'+process.env.F1_TERM_LINE+':')?'term-grace':stack.includes(process.env.F1_SOURCE+':'+process.env.F1_KILL_LINE+':')?'kill-reap':'other';
   log({event:'timer-argument',phase,ms,stack});
  }
  if(budgetClock!==undefined&&stack.includes(process.env.F1_SOURCE+':'+process.env.F1_TIMER_LINE+':')){
   log({event:'binding-budget',now:budgetClock,ms,actualD:budgetClock+ms,stack});
   budgetClock=undefined;
  }
  return _setTimeout(callback,ms,...args);
 };
 const _fetch=globalThis.fetch;
 const _timeout=AbortSignal.timeout;
 AbortSignal.timeout=function(ms){
  const id=++fetchId,now=fetchClock;
  const signal=_timeout.call(this,ms);
  log({event:'fetch-budget',id,now,ms});
  signal.addEventListener('abort',()=>log({event:'fetch-abort',id}));
  return signal;
 };
 globalThis.fetch=async function(url,opts){
  const id=fetchId;log({event:'fetch-start',id,url:String(url)});
  let r;
  try{r=await _fetch.call(this,url,opts);}catch(error){
   log({event:'native-fetch-reject',id});
   if(mode==='readiness-reject-6142'&&fetchClock+Math.max(1,Math.min(500,global.__f1_anchor.D-fetchClock))===global.__f1_anchor.D){
    const target=global.__f1_anchor.value+6142;
    log({event:'reject-delay-start',id,target});
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,target-_now())));
   }
   log({event:'fetch-reject',id});throw error;
  }
  const D=global.__f1_anchor?.D??0;
  log({event:'http-headers',status:r.status,ok:r.ok,time_rel_D:_now()-D});
  if(r.body){
   const _cancel=r.body.cancel.bind(r.body);
   r.body.cancel=async function(...args){
    const D2=global.__f1_anchor?.D??0;
    log({event:'cancel-call',time_rel_D:_now()-D2});
    const result=await _cancel(...args);
    log({event:'native-cancel-resolution',time_rel_D:_now()-D2});
    if(mode==='cancel-delay-D150'&&global.__f1_anchor){
     const target=global.__f1_anchor.D+150;const wait=target-_now();
     if(wait>0){log({event:'cancel-delay-start',target});await new Promise(resolve=>setTimeout(resolve,wait));log({event:'cancel-delay-done'});}
    }
    log({event:'cancel-return',time_rel_D:_now()-D2});
    return result;
   };
  }
  return r;
 };
 const _spawn=cp.spawn;
 cp.spawn=function(command,args,opts){
  const k=args&&(args.includes('--provider-child')||args.some(x=>typeof x==='string'&&x.endsWith('/examples/provider/server.mjs')))?'provider':args&&args.some(x=>typeof x==='string'&&x.endsWith('/examples/consumer/client.mjs'))?'consumer':'other';
  const call_time=_now(),D=global.__f1_anchor?.D??0,call_rel_D=call_time-D;
  const child=_spawn.call(this,command,args,{...opts,env:{...(opts&&opts.env||{}),F1_KIND:k}});
  log({event:'spawn',kind:k,pid:child.pid,call_time,call_rel_D});
  child.once('exit',(code,signal)=>log({event:'exit',kind:k,pid:child.pid,code,signal}));
  child.once('close',(code,signal)=>log({event:'close',kind:k,pid:child.pid,code,signal}));
  const _kill=child.kill;child.kill=function(signal){log({event:'kill',kind:k,pid:child.pid,signal});return _kill.call(this,signal);};
  if(k==='provider')child.on('message',message=>log({event:'ipc-received',pid:child.pid,message}));
  return child;
 };
 const _cerr=console.error;console.error=function(...args){log({event:String(args[0]).startsWith('[e2e] FAIL')?'fail-invocation':'stderr-log',msg:String(args[0])});return _cerr.apply(this,args);};
 const _write=process.stderr.write;process.stderr.write=function(...args){log({event:'stderr-write',text:String(args[0])});return _write.apply(this,args);};
}else if(kind==='provider'){
 const fixtureIgnoreTerm=()=>log({event:'ignored-term'});
 if(mode==='ignore-term')process.on('SIGTERM',fixtureIgnoreTerm);
 const listen=net.Server.prototype.listen;
 net.Server.prototype.listen=function(...args){this.once('listening',()=>{
  log({event:'actual-bound',address:this.address()});

 });
 if(mode.startsWith('readiness-')){setTimeout(()=>listen.apply(this,args),3500);return this;}
 return listen.apply(this,args);};
 const emit=http.Server.prototype.emit;
 http.Server.prototype.emit=function(event,...args){if(event==='request'&&mode.startsWith('readiness-')){log({event:'hung-request'});return true;}return emit.call(this,event,...args);};
 const send=process.send?.bind(process);
 if(send)process.send=function(message,...args){
  if(mode==='ignore-term'&&message?.type==='provider-bound'){
   for(const listener of process.listeners('SIGTERM'))if(listener!==fixtureIgnoreTerm)process.removeListener('SIGTERM',listener);
   log({event:'fixture-term-ready',kind:'provider',pid:process.pid,listenerCount:process.listeners('SIGTERM').length,ownsFixtureIgnoreTerm:process.listeners('SIGTERM').includes(fixtureIgnoreTerm)});
  }
  log({event:'ipc',kind:'provider',message});
  return send(mode==='ignore-term'?{...message,pid:process.pid+10000}:message,...args);
 };
}else if(kind==='consumer'){log({event:'consumer-process-start'});}
require('node:module').syncBuiltinESMExports();
`;
// Hash the candidate e2e.mjs source for anchor provenance verification.
const e2eSource = await (async()=>{const {readFile:rf}=await import('node:fs/promises');return rf(path.join(root,'scripts/e2e.mjs'),'utf8');})();
const e2eSourceHash = createHash('sha256').update(e2eSource).digest('hex');
// runSupervisor: runs e2e.mjs with supervisor-level preload; captures anchor + direct spawn timestamps.
async function runSupervisor(mode,{script=path.join(root,'scripts/e2e.mjs'),preloadText=supervisorPreload,witnessStatus=false,providerPreloadText=null}={}) {
 const scratch=process.env.TMPDIR||path.join(process.env.HOME,'.cache/proofmeta');await mkdir(scratch,{recursive:true});
 const dir=await mkdtemp(path.join(scratch,'f1-sup-'));const audit=path.join(dir,'events.jsonl'),hook=path.join(dir,'audit.cjs');
 await writeFile(audit,'');await writeFile(hook,preloadText);
 const providerHook=path.join(dir,'provider-audit.cjs');if(providerPreloadText!==null)await writeFile(providerHook,providerPreloadText);
 if(witnessStatus)await writeFile(audit+'.witness-integrity','PENDING\n');
 let child;
 try{
  const source=await readFile(script,'utf8'),lines=source.split('\n');
  const sourceHash=createHash('sha256').update(source).digest('hex');
  const lineOf=text=>lines.findIndex(line=>line.includes(text))+1;
  const assignmentLines=lines.flatMap((line,index)=>/^\s*(?:(?:const|let)\s+)?deadline\s*=/.test(line)?[index+1]:[]);
  const started=Date.now();child=spawn(process.execPath,[script],{cwd:root,env:{...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --require=${hook}`,F1_MODE:mode,F1_AUDIT:audit,F1_KIND:'supervisor',F1_WITNESS_PROVIDER_OPTIONS:providerPreloadText===null?'':`${process.env.NODE_OPTIONS||''} --require=${providerHook}`,F1_SOURCE:script,F1_SOURCE_HASH:sourceHash,F1_ANCHOR_LINE:String(lineOf('const deadline = Date.now()')),F1_ANCHOR_LINES:JSON.stringify(assignmentLines),F1_BUDGET_LINE:String(lineOf("deadline-Date.now(), {reason:'bound-timeout'}")),F1_TIMER_LINE:String(lineOf('timer = setTimeout(')),F1_FETCH_LINE:String(lineOf('signal: AbortSignal.timeout(')),F1_TERM_LINE:String(lineOf('if (await bounded(state.done, 2000')),F1_KILL_LINE:String(lineOf('if (!await bounded(state.done, 2000'))},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const watchdog=setTimeout(()=>child.kill('SIGKILL'),23000);
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(watchdog);
  const events=(await readFile(audit,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const alive=[];for(const e of events.filter(e=>e.event==='spawn')){try{process.kill(e.pid,0);alive.push(e.pid);}catch{}}
  const witnessStatusText=witnessStatus?await readFile(audit+'.witness-integrity','utf8').catch(()=>null):null;
  const result={assignmentLines,sourceText:source,observerPid:process.pid,providerHookHash:providerPreloadText===null?null:createHash('sha256').update(providerPreloadText).digest('hex'),witnessStatusText,mode,...status,supervisorPid:child.pid,source:script,sourceHash,hookHash:createHash('sha256').update(preloadText).digest('hex'),binary:process.execPath,binaryHash:createHash('sha256').update(await readFile(process.execPath)).digest('hex'),argv:[process.execPath,script],cwd:root,elapsedMs:Date.now()-started,output,events,alive};
  if(process.env.F1_EVIDENCE){await mkdir(process.env.F1_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.F1_EVIDENCE,`sup-${mode}-${path.basename(dir)}.json`),JSON.stringify(result,null,2));}
  assert.deepEqual(alive,[],'all own children must be reaped');assert.equal(status.signal,null,output);
  return result;
 }finally{await rm(dir,{recursive:true,force:true});}
}
// One mandatory gate for the native positive and each live source-fault control.
function anchorGate(r){
 const anchors=r.events.filter(e=>e.event==='anchor');
 assert.equal(anchors.length,1,'exactly one observed deadline assignment clock call required');
 const a=anchors[0];
 assert.equal(a.pid,r.supervisorPid);assert.equal(a.ppid,r.observerPid);
 assert.equal(a.source,r.source);assert.equal(a.sourceHash,r.sourceHash);
 assert.equal(r.assignmentLines.length,1,'exactly one deadline assignment source statement');
 assert.equal(a.originLine,r.assignmentLines[0],'clock must originate directly at deadline assignment');
 assert.ok(a.stack.includes(r.source+':'+a.originLine+':'));
 assert.equal(a.D,a.value+5000);
 return a;
}
// Fixtures are full-layout private copies, never production runtime edits or stubs.
async function withDeadlineFault(transform,probe){
 const scratch=process.env.TMPDIR||path.join(process.env.HOME,'.cache/proofmeta');await mkdir(scratch,{recursive:true});
 const dir=await mkdtemp(path.join(scratch,'f1-deadline-fault-'));
 try{
  await cp(root,dir,{recursive:true,dereference:true});
  const script=path.join(dir,'scripts/e2e.mjs'),source=transform(e2eSource);
  assert.notEqual(source,e2eSource,'actual source fault required');
  await writeFile(script,source);
  await probe(script);
 }finally{await rm(dir,{recursive:true,force:true});}
}
function completedOwnedFlow(r){
 assert.equal(r.code,0,r.output);assert.match(r.output,/\[consumer\] full Tier-1 flow completed OK/);
 const bound=r.events.find(e=>e.event==='actual-bound'),ipc=r.events.find(e=>e.event==='ipc-received');
 assert.ok(bound&&ipc);assert.equal(ipc.pid,bound.pid);assert.equal(ipc.message.pid,bound.pid);
 assert.deepEqual(ipc.message.address,bound.address);
 for(const child of r.events.filter(e=>e.event==='spawn')){
  assert.ok(r.events.some(e=>e.event==='exit'&&e.pid===child.pid));
  assert.ok(r.events.some(e=>e.event==='close'&&e.pid===child.pid));
 }
}
test('anchor: authentic single anchor bound to source callsite and supervisor PID',{timeout:25000},async()=>{
 const r=await runSupervisor('anchor-control');completedOwnedFlow(r);const a=anchorGate(r);
 const consumer=r.events.find(e=>e.event==='spawn'&&e.kind==='consumer');
 assert.ok(consumer&&consumer.call_time<a.D&&consumer.call_rel_D<0);
});
test('anchor: missing assignment clock is EXPECTED_RED in mandatory gate',{timeout:25000},async()=>{
 await withDeadlineFault(s=>s.replace('const deadline = Date.now() + 5000;','const deadline = new Date().getTime() + 5000;'),async script=>{
  const r=await runSupervisor('anchor-missing',{script});completedOwnedFlow(r);
  assert.equal(r.assignmentLines.length,1);assert.equal(r.events.filter(e=>e.event==='anchor').length,0);
  assert.throws(()=>anchorGate(r),{code:'ERR_ASSERTION'},'missing live assignment observation must reject');
 });
});
test('anchor: duplicate actual assignment clocks are EXPECTED_RED in mandatory gate',{timeout:25000},async()=>{
 await withDeadlineFault(s=>s.replace('const deadline = Date.now() + 5000;','const deadline = Date.now() + (Date.now(), 5000);'),async script=>{
  const r=await runSupervisor('anchor-duplicate',{script});completedOwnedFlow(r);
  const a=r.events.filter(e=>e.event==='anchor');assert.equal(a.length,2);
  for(const e of a){assert.equal(e.originLine,r.assignmentLines[0]);assert.equal(e.pid,r.supervisorPid);}
  assert.throws(()=>anchorGate(r),{code:'ERR_ASSERTION'},'first-hit retention must not hide duplicate calls');
 });
});
test('anchor: actual other-callsite clock is EXPECTED_RED in mandatory gate',{timeout:25000},async()=>{
 await withDeadlineFault(s=>s.replace('const deadline = Date.now() + 5000;','const readDeadlineClock = () => Date.now();\n  const deadline = readDeadlineClock() + 5000;'),async script=>{
  const r=await runSupervisor('anchor-wrong-origin',{script});completedOwnedFlow(r);
  const a=r.events.filter(e=>e.event==='anchor');assert.equal(a.length,1);
  assert.notEqual(a[0].originLine,r.assignmentLines[0]);assert.equal(a[0].pid,r.supervisorPid);
  assert.throws(()=>anchorGate(r),{code:'ERR_ASSERTION'},'real helper origin, not fabricated stack, must reject');
 });
});
// ── New cases: cancel-delay admission (fail-closed GREEN vs latency RED, separated) ──
// After runtime fix: D elapsed during injected D+150 cancel delay → no consumer (fail-closed GREEN).
// The injection itself is a deliberate latency fixture: cancel-return time_rel_D ≥ 100ms (latency RED).
// These two assertions are separate and must not be merged.
test('cancel-delay-D150: fail-closed GREEN — no consumer spawn when cancel resolves after D',{timeout:25000},async()=>{
 const r=await runSupervisor('cancel-delay-D150');
 fail(r,true); // code=1, no PASS, no consumer spawn
 assert.ok(r.events.some(e=>e.event==='cancel-delay-done'),'cancel delay injection must have fired (real fixture, not skipped)');
 assert.equal(r.events.filter(e=>e.event==='spawn'&&e.kind==='consumer').length,0,'no consumer after D+150 cancel delay (fail-closed)');
 assert.deepEqual(r.alive,[],'no orphaned children after fail-closed');
});
test('cancel-delay-D150: latency RED — cancel-return time_rel_D ≥ 100ms (injection is real, separate from admission)',{timeout:25000},async()=>{
 const r=await runSupervisor('cancel-delay-D150');
 const nativeResolution=r.events.find(e=>e.event==='native-cancel-resolution');
 const delayStart=r.events.find(e=>e.event==='cancel-delay-start');
 const delayDone=r.events.find(e=>e.event==='cancel-delay-done');
 const cancelReturn=r.events.find(e=>e.event==='cancel-return'&&delayDone&&e.time>=delayDone.time);
 assert.ok(nativeResolution&&delayStart&&delayDone,'native cancellation and actual wrapper timer must all execute');
 assert.ok(nativeResolution.time<=delayStart.time&&delayStart.time<=delayDone.time,'native resolution precedes the delayed awaited wrapper completion');
 assert.ok(cancelReturn,'cancel-return event must be present (observing real cancel path)');
 // After the D+150 injection, cancel return is at least 100ms past D (latency RED evidence).
 assert.ok(cancelReturn.time_rel_D>=100,`cancel-return must be ≥100ms after D (latency RED): actual time_rel_D=${cancelReturn.time_rel_D}ms`);
 // This is the latency RED separately from the admission fail-closed GREEN above.
 // The injected fixture is NOT a semantic pass — fail-closed GREEN and latency RED are disjoint verdicts.
});
// ── New case: provider failure sticky during consumer run ──
// Provider exits mid-consumer POST: failure is sticky, result is fail-closed.
test('provider failure sticky: exit during consumer POST observed and propagated',{timeout:25000},async()=>{
 const r=await run('exit-during');
 fail(r);
 assert.ok(r.events.some(e=>e.event==='actual-bound'),'provider must have bound (real provider path)');
 assert.ok(r.events.some(e=>e.event==='request'&&e.method==='POST'),'provider must have seen POST (consumer was admitted)');
 assert.ok(r.events.some(e=>e.event==='exit'&&e.kind==='provider'&&e.code===7),'provider exit code 7 must be observed');
 assert.match(r.output,/provider.*during consumer|provider exited/,'provider failure must appear in output (sticky)');
});
// ── New case: pre-spawn deadline guard (direct call_time < D in positive run) ──
// The new guard in e2e.mjs checks Date.now() >= deadline immediately before spawn, with no await between.
// In a positive run, call_time must always be < D. If elapsed, the guard throws before spawn.
test('pre-spawn deadline guard: consumer spawn call_time strictly before D in real positive run',{timeout:25000},async()=>{
 const r=await runSupervisor('positive');
 assert.equal(r.code,0,r.output);
 const anchor=r.events.find(e=>e.event==='anchor');
 assert.ok(anchor,'anchor must be present');
 const consumerSpawn=r.events.find(e=>e.event==='spawn'&&e.kind==='consumer');
 assert.ok(consumerSpawn,'consumer must spawn in positive run');
 assert.ok(consumerSpawn.call_time<anchor.D,
  `consumer spawn call_time must be < D. call_rel_D=${consumerSpawn.call_rel_D}ms`);
});
// The native binding timer argument plus its unmodified budget clock reconstructs
// the candidate's actual D. The observer's normative D remains value+5000.
test('D drift +25ms: drifted deadline detected via anchor — anchor.D != value+5000 is semantic RED',{timeout:25000},async()=>{
 const scratch=process.env.TMPDIR||path.join(process.env.HOME,'.cache/proofmeta');await mkdir(scratch,{recursive:true});
 const dir=await mkdtemp(path.join(scratch,'f1-drift-'));
 const scriptsDir=path.join(dir,'scripts');await mkdir(scriptsDir,{recursive:true});
 // Modified e2e.mjs with +5025 instead of +5000 (drift +25ms).
 const driftedSrc=e2eSource.replace('const deadline = Date.now() + 5000;','const deadline = Date.now() + 5025; // drift +25ms RED')
  .replace("const repoRoot = path.resolve(path.dirname(script), '..');",`const repoRoot = ${JSON.stringify(root)};`);
 assert.notEqual(driftedSrc,e2eSource,'source must differ (drift applied)');
 const driftedScript=path.join(scriptsDir,'e2e.mjs');
 await writeFile(driftedScript,driftedSrc);
 try{
  assert.ok(driftedSrc.includes('Date.now() + 5025'),'drifted source must contain +5025');
  assert.ok(!driftedSrc.includes('const deadline = Date.now() + 5000'),'drifted source must not have original +5000 deadline');
  for(const [mode,script,expectedDrift] of [['drift-control',path.join(root,'scripts/e2e.mjs'),0],['drift-fault',driftedScript,25]]){
   const r=await runSupervisor(mode,{script});
   assert.equal(r.code,0,r.output);
   assert.match(r.output,/\[consumer\] full Tier-1 flow completed OK/);
   const anchors=r.events.filter(e=>e.event==='anchor');
   assert.equal(anchors.length,1,'missing or duplicate anchor cannot pass drift sensitivity');
   const anchor=anchors[0];
   assert.equal(anchor.source,r.source);
   assert.equal(anchor.sourceHash,r.sourceHash);
   assert.equal(anchor.pid,r.supervisorPid);
   const budgets=r.events.filter(e=>e.event==='binding-budget');
   assert.equal(budgets.length,1,'one real binding timer budget is required');
   assert.equal(anchor.D,anchor.value+5000);
   assert.equal(budgets[0].actualD-anchor.D,expectedDrift,'actual timer budget must expose exact drift, even within the 100ms measurement window');
   const semanticGate=()=>assert.equal(budgets[0].actualD,anchor.D,'original D must not be extended');
   if(expectedDrift===0)semanticGate();
   else assert.throws(semanticGate,{code:'ERR_ASSERTION'},'fault control must be EXPECTED_RED while sensitivity test stays GREEN');
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
// A real second assignment only after native provider IPC has passed owned-bind validation.
test('deadline renewal: post-owned-bind second clock and effective budget are EXPECTED_RED',{timeout:25000},async()=>{
 const marker="    let ready = false;";
 assert.equal(e2eSource.split(marker).length,2);
 // Exact reviewed source makes the real owned-IPC validation dominate the second assignment.
 assert.equal(e2eSourceHash,'da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84');
 const transform=s=>s.replace('const deadline = Date.now() + 5000;','let deadline = Date.now() + 5000;')
  .replace(marker,'    deadline = Date.now() + 5000; // isolated post-owned-bind renewal fault\n'+marker);
 const fixtureSource=transform(e2eSource),fixtureHash=createHash('sha256').update(fixtureSource).digest('hex');
 await withDeadlineFault(transform,async script=>{
  const r=await runSupervisor('readiness-renewal',{script});fail(r,true);
  assert.equal(r.sourceText,fixtureSource);assert.equal(r.sourceHash,fixtureHash);
  const a=r.events.filter(e=>e.event==='anchor');assert.equal(a.length,2);
  const [original,renewed]=a,bound=r.events.find(e=>e.event==='actual-bound'),ipc=r.events.find(e=>e.event==='ipc-received');
  assert.ok(bound&&ipc);assert.equal(ipc.message.pid,bound.pid);assert.equal(ipc.pid,bound.pid);
  assert.deepEqual(ipc.message.address,bound.address);
  assert.equal(ipc.message.type,'provider-bound');
  assert.deepEqual(ipc.message.address,{address:'127.0.0.1',family:'IPv4',port:4101});
  assert.ok(r.events.some(e=>e.event==='spawn'&&e.kind==='provider'&&e.pid===ipc.pid));
  // actual-bound is an independent child observer, not a causal timestamp gate.
  assert.ok(renewed.D>original.D);
  for(const e of a){assert.equal(e.ppid,r.observerPid);assert.equal(e.source,r.source);assert.equal(e.sourceHash,fixtureHash);}
  assert.equal(original.originLine,r.assignmentLines[0]);assert.equal(renewed.originLine,r.assignmentLines[1]);
  assert.equal(original.pid,r.supervisorPid);assert.equal(renewed.pid,r.supervisorPid);
  assert.equal(r.events.find(e=>e.event==='binding-budget').actualD,original.D);
  const budgets=r.events.filter(e=>e.event==='fetch-budget');assert.ok(budgets.length);
  for(const b of budgets)assert.equal(b.ms,Math.max(1,Math.min(500,renewed.D-b.now)));
  assert.equal(budgets.at(-1).now+budgets.at(-1).ms,renewed.D,'actual final native timeout uses renewed D');
  assert.throws(()=>anchorGate(r),{code:'ERR_ASSERTION'});
  assert.throws(()=>{for(const b of budgets)assert.equal(b.ms,Math.max(1,Math.min(500,original.D-b.now)));},{code:'ERR_ASSERTION'},'original-D budget oracle rejects effective renewal');
  for(const child of r.events.filter(e=>e.event==='spawn')){
   assert.ok(r.events.some(e=>e.event==='exit'&&e.pid===child.pid));assert.ok(r.events.some(e=>e.event==='close'&&e.pid===child.pid));
  }
 });
});
// Readiness and cleanup are independent gates, never a larger outer 6500 budget.
function readinessGate(r){
 const anchors=r.events.filter(e=>e.event==='anchor');assert.equal(anchors.length,1);
 const a=anchors[0];assert.equal(a.D,a.value+5000);assert.equal(a.pid,r.supervisorPid);
 assert.equal(a.source,r.source);assert.equal(a.sourceHash,r.sourceHash);
 const bound=r.events.find(e=>e.event==='actual-bound');
 const ipc=r.events.find(e=>e.event==='ipc-received');
 assert.ok(bound&&ipc);assert.equal(ipc.message.pid,bound.pid);assert.equal(ipc.pid,bound.pid);
 assert.deepEqual(ipc.message.address,{address:'127.0.0.1',family:'IPv4',port:4101});
 assert.deepEqual(bound.address,ipc.message.address);assert.ok(ipc.time<a.D&&bound.time<a.D);
 const budgets=r.events.filter(e=>e.event==='fetch-budget');assert.ok(budgets.length);
 for(const b of budgets){assert.ok(b.now<a.D);assert.equal(b.ms,Math.max(1,Math.min(500,a.D-b.now)));}
 for(const s of r.events.filter(e=>e.event==='fetch-start'))assert.ok(s.time<a.D,'strict fetch admission');
 for(const s of r.events.filter(e=>e.event==='spawn'&&e.kind==='consumer'))assert.ok(s.call_time<a.D,'strict consumer admission');
 const last=budgets.at(-1),abort=r.events.find(e=>e.event==='fetch-abort'&&e.id===last.id),reject=r.events.find(e=>e.event==='fetch-reject'&&e.id===last.id);
 const failure=r.events.find(e=>e.event==='fail-invocation');assert.ok(abort&&reject&&failure);
 for(const e of [abort,failure])assert.ok(e.time-a.value>=4900&&e.time-a.value<=5100,`${e.event} readiness time ${e.time-a.value}`);
 assert.ok(reject.time>=abort.time&&reject.time-abort.time<=100,'abort→reject callback delivery <=100ms');
 assert.ok(r.events.some(e=>e.event==='stderr-write'&&e.time>=failure.time));
}
function cleanupGate(r){
 const failure=r.events.find(e=>e.event==='fail-invocation');assert.ok(failure);
 for(const child of r.events.filter(e=>e.event==='spawn')){
  const events=r.events.filter(e=>e.pid===child.pid),term=events.find(e=>e.event==='kill'&&e.signal==='SIGTERM'),kill=events.find(e=>e.event==='kill'&&e.signal==='SIGKILL'),exit=events.find(e=>e.event==='exit'),close=events.find(e=>e.event==='close');
  assert.ok(term&&exit&&close);assert.ok(term.time>=failure.time&&term.time-failure.time<=100,'FAIL→TERM <=100ms');
  assert.ok(exit.time<=close.time);
  if(kill){assert.ok(kill.time-term.time>=1900&&kill.time-term.time<=2100);assert.ok(close.time>=kill.time&&close.time-kill.time<=2100);}
  else assert.ok(close.time-term.time<=2100);
 }
 const timers=r.events.filter(e=>e.event==='timer-argument'&&['term-grace','kill-reap'].includes(e.phase));
 assert.ok(timers.some(e=>e.phase==='term-grace'));for(const t of timers)assert.equal(t.ms,2000);
 if(r.events.some(e=>e.event==='kill'&&e.signal==='SIGKILL'))assert.ok(timers.some(e=>e.phase==='kill-reap'));
 assert.deepEqual(r.alive,[]);
}
test('readiness phase: hung real HTTP exhausts original D independently of cleanup',{timeout:25000},async()=>{
 const r=await runSupervisor('readiness-budget');fail(r,true);readinessGate(r);cleanupGate(r);
});
test('readiness 6142ms rejection delay: common gate EXPECTED_RED, fail-closed and cleanup GREEN',{timeout:25000},async()=>{
 const r=await runSupervisor('readiness-reject-6142');fail(r,true);
 const delay=r.events.find(e=>e.event==='reject-delay-start');assert.ok(delay);
 const anchor=r.events.find(e=>e.event==='anchor'),failure=r.events.find(e=>e.event==='fail-invocation');
 assert.equal(delay.target,anchor.value+6142);assert.ok(failure.time>=delay.target);
 assert.throws(()=>readinessGate(r),{code:'ERR_ASSERTION'});cleanupGate(r);
});
test('cleanup phase: native TC7 measures FAIL TERM KILL exit close and exact timer arguments',{timeout:25000},async()=>{
 const r=await runSupervisor('ignore-term');fail(r,true);assert.ok(r.events.some(e=>e.event==='ignored-term'));
 const ready=r.events.find(e=>e.event==='fixture-term-ready');
 const actualBound=r.events.find(e=>e.event==='actual-bound');
 const ipc=r.events.find(e=>e.event==='ipc');
 const ignored=r.events.find(e=>e.event==='ignored-term');
 assert.ok(ready,'fixture-term-ready must be emitted before the wrong PID send');
 assert.equal(ready.ownsFixtureIgnoreTerm,true,'fixture must retain its own ignore-term handler');
 assert.equal(ready.listenerCount,1,'fixture must keep exactly one SIGTERM listener in ignore-term mode');
 assert.ok(actualBound,'actual binding observation must be present');
 assert.equal(ready.kind,'provider');assert.equal(ready.pid,actualBound.pid);
 assert.equal(ipc?.message.type,'provider-bound');assert.equal(ipc.message.pid,ready.pid);
 assert.deepEqual(actualBound.address,ipc.message.address);
 const received=r.events.find(e=>e.event==='ipc-received'),failure=r.events.find(e=>e.event==='fail-invocation'),term=r.events.find(e=>e.event==='kill'&&e.signal==='SIGTERM');
 assert.ok(received&&failure&&term);
 for(const [before,after] of [[ready,ipc],[ipc,received],[received,failure],[failure,term],[term,ignored]]){
  assert.ok(r.events.indexOf(before)<r.events.indexOf(after),'fixture readiness, IPC, FAIL and TERM must be ordered in the real audit');
  assert.ok(before.time<=after.time);
 }
 assert.equal(received.message.pid,ready.pid+10000);
 for(const event of ['exit','close'])assert.ok(r.events.some(e=>e.event===event&&e.pid===ready.pid&&e.signal==='SIGKILL'));
 assert.ok(ipc&&ready.time<=ipc.time,'fixture-term-ready must precede the IPC send');
 assert.ok(ignored&&ipc.time<=ignored.time,'ignored-term must follow the IPC-triggered TERM path');
 assert.ok(r.events.some(e=>e.event==='kill'&&e.signal==='SIGKILL'));cleanupGate(r);
});
// ── New case: 2s/2s cleanup clock — TERM→KILL within ~2s, KILL→close within ~2s, total < 6000ms ──
test('2s/2s cleanup clock: TERM→KILL 1900…2100ms, KILL→close ≤2100ms, total < 6000ms (not 6500 raised)',{timeout:25000},async()=>{
 const r=await run('ignore-term');
 fail(r,true);
 const ignoredTerm=r.events.find(e=>e.event==='ignored-term');
 const killEv=r.events.find(e=>e.event==='kill'&&e.signal==='SIGKILL');
 const closeEv=r.events.find(e=>e.event==='close'&&e.kind==='provider'&&e.signal==='SIGKILL');
 assert.ok(ignoredTerm,'SIGTERM must have been observed (ignored) by provider');
 assert.ok(killEv,'SIGKILL must have been issued by supervisor');
 assert.ok(closeEv,'provider close with SIGKILL must be observed');
 const termToKill=killEv.time-ignoredTerm.time;
 const killToClose=closeEv.time-killEv.time;
 assert.ok(termToKill>=1900&&termToKill<=2100,`TERM→KILL must be 1900…2100ms: actual=${termToKill}ms`);
 assert.ok(killToClose<=2100,`KILL→close must be ≤2100ms: actual=${killToClose}ms`);
 assert.ok(r.elapsedMs<6000,`total elapsed must be <6000ms (2s+2s cleanup, not 6500 raised): ${r.elapsedMs}ms`);
});
// ── New case: KILL absence in positive run (no KILL = not exercised, not a KILL-PASS) ──
test('positive run: no SIGKILL issued (KILL absence is not a KILL-PASS, only TC7 exercises KILL)',{timeout:25000},async()=>{
 const r=await run('positive');
 assert.equal(r.code,0,r.output);
 // In a clean positive run, provider exits cleanly; SIGTERM may be sent by cleanup but no SIGKILL escalation.
 const kills=r.events.filter(e=>e.event==='kill'&&e.signal==='SIGKILL');
 assert.equal(kills.length,0,'no SIGKILL in a clean positive run (SIGKILL not exercised here, KILL-PASS only from TC7)');
});

// HIGH04 bounded addendum: only the two source-reachable original obligations.
// H04-05/10/11 remain explicitly BLOCKED in the pinned handoff, not skipped PASS.
// This reuses the reviewed native operations and actual objects; no event delivery fault.
function high04Preload(mode){
 assert.ok(['high04-providerfail-cancel','high04-elapsed-prespawn'].includes(mode));
 let text=supervisorPreload;
 const replaceOne=(before,after)=>{assert.equal(text.split(before).length,2,'HIGH04 exact preload edge');text=text.replace(before,after);};
 if(mode==='high04-providerfail-cancel'){
  replaceOne(' const _spawn=cp.spawn;',' let high04Provider;\n const _spawn=cp.spawn;');
  replaceOne("  log({event:'spawn',kind:k,pid:child.pid,call_time,call_rel_D});","  if(k==='provider')high04Provider=child;\n  log({event:'spawn',kind:k,pid:child.pid,call_time,call_rel_D});");
  replaceOne("    log({event:'native-cancel-resolution',time_rel_D:_now()-D2});",`    log({event:'native-cancel-resolution',time_rel_D:_now()-D2});
    if(mode==='high04-providerfail-cancel'){
     if(!high04Provider)throw Error('HIGH04 fixture STOP: missing actual owned provider');
     log({event:'high04-provider-fault-start',pid:high04Provider.pid});
     const killed=high04Provider.kill('SIGTERM');
     log({event:'high04-provider-term-return',pid:high04Provider.pid,killed});
     await new Promise(resolve=>setTimeout(resolve,100));
     log({event:'high04-provider-fault-done',pid:high04Provider.pid});
    }`);
 }else{
  replaceOne(' const _cerr=console.error;',` const _clog=console.log;console.log=function(...args){
  if(mode==='high04-elapsed-prespawn'&&String(args[0])==='[e2e] provider ready — running consumer…'){
   const D=global.__f1_anchor?.D;
   if(!Number.isSafeInteger(D))throw Error('HIGH04 fixture STOP: missing original D');
   const target=D+25;log({event:'high04-prespawn-delay-start',D,target});
   while(_now()<target){} // Real elapsed walltime, same native clock return values.
   log({event:'high04-prespawn-delay-done',D,target});
  }
  return _clog.apply(this,args);
 };
 const _cerr=console.error;`);
 }
 return text;
}
function high04NativeAdmission(r){
 assert.equal(r.sourceHash,'da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84');
 const a=anchorGate(r),providers=r.events.filter(e=>e.event==='spawn'&&e.kind==='provider');
 assert.equal(providers.length,1);const provider=providers[0];
 const bound=r.events.find(e=>e.event==='actual-bound'),ipc=r.events.find(e=>e.event==='ipc-received');
 assert.ok(bound&&ipc);assert.equal(bound.pid,provider.pid);assert.equal(ipc.pid,provider.pid);
 assert.equal(ipc.message.type,'provider-bound');assert.equal(ipc.message.pid,provider.pid);
 assert.deepEqual(bound.address,{address:'127.0.0.1',family:'IPv4',port:4101});assert.deepEqual(ipc.message.address,bound.address);
 assert.ok(bound.time<a.D&&ipc.time<a.D);
 const headers=r.events.find(e=>e.event==='http-headers'),call=r.events.find(e=>e.event==='cancel-call'),native=r.events.find(e=>e.event==='native-cancel-resolution');
 assert.ok(headers&&call&&native,'actual HTTP and native cancel must execute');assert.equal(headers.status,200);assert.equal(headers.ok,true);
 assert.ok(headers.time<=call.time&&call.time<=native.time&&native.time<a.D);
 for(const child of r.events.filter(e=>e.event==='spawn'))for(const event of ['exit','close'])assert.ok(r.events.some(e=>e.event===event&&e.pid===child.pid),'actual owned '+event);
 assert.deepEqual(r.alive,[]);fail(r,true);
 return {a,provider,headers,call,native};
}
test('HIGH04 H04-06: provider failure DURING awaited cancel is sticky',{timeout:25000},async()=>{
 const mode='high04-providerfail-cancel',hook=high04Preload(mode);
 assert.equal(createHash('sha256').update(hook).digest('hex'),'81f511c0c1058187c287f2b548c28613efffec140a5c1036ac19ef88a724036c','pinned HIGH04 providerfail fixture');
 const r=await runSupervisor(mode,{preloadText:hook});assert.equal(r.hookHash,createHash('sha256').update(hook).digest('hex'));
 const {a,provider,native}=high04NativeAdmission(r);
 const one=event=>{const xs=r.events.filter(e=>e.event===event);assert.equal(xs.length,1,event+' must activate exactly once');return xs[0];};
 const start=one('high04-provider-fault-start'),sent=one('high04-provider-term-return'),done=one('high04-provider-fault-done'),returned=one('cancel-return'),failure=one('fail-invocation');
 const exit=r.events.find(e=>e.event==='exit'&&e.pid===provider.pid),close=r.events.find(e=>e.event==='close'&&e.pid===provider.pid);
 assert.equal(start.pid,provider.pid);assert.equal(sent.pid,provider.pid);assert.equal(done.pid,provider.pid);assert.equal(sent.killed,true);
 for(const [before,after] of [[native,start],[start,sent],[sent,exit],[exit,close],[close,done],[done,returned],[returned,failure]]){
  assert.ok(r.events.indexOf(before)<r.events.indexOf(after),'real DURING-cancel activation/event order');assert.ok(before.time<=after.time);
 }
 assert.ok(returned.time<a.D,'provider failure must be tested separately from elapsed-D rejection');
 assert.match(failure.msg,/provider (IPC disconnected|exited unexpectedly)/);
 // Provider was already natively exited/closed before FAIL: cleanup(state) early returns.
 // cleanupGate's FAIL→TERM predicate is not applicable to that pre-FAIL fault TERM.
});
test('HIGH04 H04-07: original D actually elapsed immediately before consumer spawn',{timeout:25000},async()=>{
 const mode='high04-elapsed-prespawn',hook=high04Preload(mode);
 assert.equal(createHash('sha256').update(hook).digest('hex'),'2acc7f09258047eba82cb7b40df2500a61210b9fad671b24fda0fe85d5df02d6','pinned HIGH04 prespawn fixture');
 const r=await runSupervisor(mode,{preloadText:hook});assert.equal(r.hookHash,createHash('sha256').update(hook).digest('hex'));
 const {a,native}=high04NativeAdmission(r);
 const start=r.events.filter(e=>e.event==='high04-prespawn-delay-start'),done=r.events.filter(e=>e.event==='high04-prespawn-delay-done');assert.equal(start.length,1);assert.equal(done.length,1);
 const returned=r.events.find(e=>e.event==='cancel-return'),failure=r.events.find(e=>e.event==='fail-invocation');assert.ok(returned&&failure);
 assert.ok(native.time<=returned.time&&returned.time<a.D&&returned.time<=start[0].time&&start[0].time<a.D);
 assert.equal(start[0].D,a.D);assert.equal(done[0].D,a.D);assert.equal(start[0].target,a.D+25);assert.equal(done[0].target,a.D+25);
 assert.ok(done[0].time>=a.D+25&&failure.time>=done[0].time);
 assert.equal(failure.msg,'[e2e] FAIL — deadline elapsed before consumer spawn');cleanupGate(r);
});

// Scope-A Witness B: PREP candidate, independent source review required before any run.
const witnessDigest=text=>createHash('sha256').update(text).digest('hex');
const witnessTestHash=witnessDigest(await readFile(fileURLToPath(import.meta.url),'utf8'));
const witnessObserver="\n const W=(()=>{\n  const ids=new WeakMap();let serial=0,current=null,observerFault=false;\n  let wrapperEntries=0,resolverOutcomes=0,registeredOperations=0;\n  const records=[],children=[];let explicitExit=false,fatal=false,naturalReady=false;\n  let failCount=0,failActive=null,failReturned=false,stderrReturned=false;\n  const ident=x=>{if((typeof x!=='object'||x===null)&&typeof x!=='function')throw Error('witness nonreference');if(!ids.has(x))ids.set(x,++serial);return ids.get(x);};\n  const emit=(c,event,extra={})=>log({event:'witness-'+event,fetchId:c.fetchId,record:c.record,...extra});\n  const need=(condition)=>{if(!condition)throw Error('witness integrity');};\n  const observe=(c,work)=>{try{work();}catch(error){\n   observerFault=true;\n   // Sticky fault; parent's pre-existing PENDING status is the independent fallback.\n   // Even if the primary audit is unwritable, no OK status can be published.\n   try{emit(c,'integrity-error',{message:String(error)});}catch{observerFault=true;}\n  }};\n  const complete=()=>!observerFault&&!explicitExit&&!fatal&&failCount===1&&failReturned&&stderrReturned&&\n   current===null&&records.length===1&&records.every(c=>c.forwarded&&(\n    c.promise?c.registrations===1&&c.callbacks===1&&c.outcomes===1&&c.outcome==='return'&&\n     c.backend!==c.resolve&&c.callback===c.resolve&&\n     ((c.operands===1&&c.continuations===1)||(c.operands===0&&c.continuations===0)):\n     !c.resolve&&!c.backend&&c.registrations===0&&c.callbacks===0&&c.outcomes===0&&c.operands===0&&c.continuations===0))&&\n   registeredOperations===records.reduce((n,c)=>n+c.registrations,0)&&\n   wrapperEntries===registeredOperations&&resolverOutcomes===registeredOperations&&\n   children.length===1&&children.every(c=>c.kind==='provider'&&c.exited&&c.closed);\n  // Observe normal exhaustion, never manufacture exit or keep a timer alive.\n  process.on('beforeExit',code=>{naturalReady=code===1&&complete();});\n  // Monitor only: does not consume or change normal fatal exception handling.\n  process.on('uncaughtExceptionMonitor',()=>{fatal=true;});\n  const originalExit=process.exit;\n  process.exit=function(...args){explicitExit=true;return originalExit.apply(this,args);};\n  process.once('exit',code=>{\n   if(code!==1||!naturalReady||!complete())return;\n   // Natural source-bound planned FAIL, completed records/callbacks and reaping.\n   // Atomic publish retains PENDING on failed write/fsync/close/rename.\n   const status=process.env.F1_AUDIT+'.witness-integrity',completePath=status+'.complete';\n   let fd;\n   try{\n    fd=fs.openSync(completePath,'wx');\n    fs.writeFileSync(fd,'OK '+process.pid+' '+process.env.F1_SOURCE_HASH+'\\n');\n    fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;\n    fs.renameSync(completePath,status);\n   }catch{observerFault=true;if(fd!==undefined){try{fs.closeSync(fd);}catch{}}}\n  });\n  return {\n   child(child,kind){\n    observe(null,()=>{\n     const c={child,kind,exited:false,closed:false};children.push(c);\n     child.once('exit',()=>{c.exited=true;});child.once('close',()=>{c.closed=true;});\n    });\n   },\n   fail(thisArg,args,original){\n    const stack=new Error().stack||'',msg=String(args[0]);\n    observe(null,()=>{\n     log({event:msg.startsWith('[e2e] FAIL')?'fail-invocation':'stderr-log',msg});\n     if(msg.startsWith('[e2e] FAIL')){\n      failCount++;need(failCount===1&&msg==='[e2e] FAIL \u2014 provider HTTP endpoint not ready after owned-bound');\n      need(stack.includes(process.env.F1_SOURCE+':128:')&&process.env.F1_SOURCE_HASH==='da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84');\n      need(records.length===1&&records[0].forwarded);failActive=msg;\n     }\n    });\n    let result;\n    try{result=original.apply(thisArg,args);}catch(error){observerFault=true;failActive=null;throw error;}\n    observe(null,()=>{if(failActive){need(stderrReturned);failReturned=true;failActive=null;}});\n    return result;\n   },\n   stderr(thisArg,args,original){\n    observe(null,()=>log({event:'stderr-write',text:String(args[0])}));\n    let result;\n    try{result=original.apply(thisArg,args);}catch(error){observerFault=true;throw error;}\n    observe(null,()=>{if(failActive){need(String(args[0])===failActive+String.fromCharCode(10));stderrReturned=true;}});\n    return result;\n   },\n   begin(fetchId,error,clock,budget){\n    need(current===null);current={fetchId,error,clock,budget,record:++serial,callbacks:0,outcomes:0,registrations:0,operands:0,continuations:0};\n    emit(current,'catch',{error:ident(error),clock,budget,finalD:clock+budget,sourceHash:process.env.F1_SOURCE_HASH});\n    records.push(current);return current;\n   },\n   resolver(resolve){const c=current;need(c&&!c.resolve);c.resolve=resolve;ident(resolve);return resolve;},\n   clock(value){const c=current;need(c&&c.argumentClock===undefined);c.argumentClock=value;return value;},\n   timer(callback,ms,args,thisArg,original){\n    const c=current,originalResolver=callback;\n    // Separate the backend function from the exact observer-input resolver.\n    const backendFunction=function(...actual){\n     observe(c,()=>{\n      need(c.callback===c.resolve&&originalResolver===c.resolve&&c.backend===backendFunction&&actual.length===args.length&&actual.every((x,i)=>x===args[i])&&c.registrations===1&&c.callbacks===0);\n      c.callbacks++;wrapperEntries++;\n      emit(c,'wrapper-entry',{resolver:ident(originalResolver),entryCallback:ident(c.callback),backendWrapper:ident(backendFunction),sameEntry:c.callback===c.resolve,distinctBackend:backendFunction!==originalResolver,argumentCount:actual.length,wrapperCount:c.callbacks});\n     });\n     // No observer work can skip this sole call. Original return/throw is preserved.\n     let result;\n     try{result=originalResolver.apply(this,actual);}catch(originalError){\n      observe(c,()=>{need(c.registrations===1&&c.callbacks===1&&c.outcomes===0);c.outcomes++;resolverOutcomes++;emit(c,'resolver-outcome',{resolver:ident(originalResolver),backendWrapper:ident(backendFunction),outcome:'throw',error:ident(originalError),outcomeCount:c.outcomes,wrapperCount:c.callbacks,argumentCount:actual.length});});\n      throw originalError;\n     }\n     observe(c,()=>{need(c.registrations===1&&c.callbacks===1&&c.outcomes===0);c.outcomes++;resolverOutcomes++;emit(c,'resolver-outcome',{resolver:ident(originalResolver),backendWrapper:ident(backendFunction),outcome:'return',outcomeCount:c.outcomes,wrapperCount:c.callbacks,argumentCount:actual.length});c.outcome='return';});\n     return result;\n    };\n    observe(c,()=>{\n     need(c&&callback===c.resolve&&c.argumentClock!==undefined&&args.length===0&&c.registrations===0);\n     c.callback=callback;c.backend=backendFunction;c.ms=ms;c.due=c.argumentClock+ms;\n     ident(backendFunction);\n     need(ms===Math.max(0,global.__f1_anchor.D+25-c.argumentClock));\n     emit(c,'timer-register',{resolver:ident(c.resolve),entryCallback:ident(callback),backendWrapper:ident(backendFunction),sameEntry:callback===c.resolve,distinctBackend:backendFunction!==callback,clock:c.argumentClock,ms,due:c.due});\n     c.registrations++;registeredOperations++;\n    });\n    return original.call(thisArg,backendFunction,ms,...args);\n   },\n   promise(p){const c=current;need(c&&c.resolve&&c.registrations===1&&!c.promise&&Object.getPrototypeOf(p)===Promise.prototype);c.promise=p;ident(p);return p;},\n   operand(p){const c=current;need(c&&c.promise===p&&c.operands===0);c.operands++;emit(c,'operand',{promise:ident(p),registeredPromise:ident(c.promise),same:p===c.promise});return p;},\n   continuation(error){const c=current;need(c&&error===c.error&&c.operands===1&&c.callbacks===1&&c.outcomes===1&&c.continuations===0);c.continuations++;emit(c,'continuation',{promise:ident(c.promise),error:ident(error)});},\n   forward(error){\n    const c=current;need(c&&error===c.error);\n    const hasPromise=!!c.promise;\n    need(!hasPromise||(c.callback===c.resolve&&c.backend!==c.resolve&&c.registrations===1));\n    emit(c,'forward',{error:ident(error),caughtError:ident(c.error),sameError:error===c.error,hasPromise,\n     promise:hasPromise?ident(c.promise):null,resolver:hasPromise?ident(c.resolve):null,entryCallback:hasPromise?ident(c.callback):null,backendWrapper:hasPromise?ident(c.backend):null,\n     sameEntry:hasPromise?c.callback===c.resolve:null,distinctBackend:hasPromise?c.backend!==c.resolve:null,operands:c.operands,continuations:c.continuations,\n     registrations:c.registrations,callbacks:c.callbacks,outcomes:c.outcomes,clock:c.argumentClock??null,ms:c.ms??null,due:c.due??null});\n    c.forwarded=true;current=null;\n   },\n   owns(callback){return !!current&&current.resolve===callback;}\n  };\n })();";
const witnessFixtures=[
 {
  "name": "native",
  "source": "   W.begin(id,error,fetchClock,Math.max(1,Math.min(500,global.__f1_anchor.D-fetchClock)));\n   W.forward(error);\n",
  "topology": "direct"
 },
 {
  "name": "original",
  "source": "   W.begin(id,error,fetchClock,Math.max(1,Math.min(500,global.__f1_anchor.D-fetchClock)));\n   await W.operand(W.promise(new Promise(resolve=>setTimeout(W.resolver(resolve),Math.max(0,global.__f1_anchor.D+25-W.clock(_now()))))));\n   W.continuation(error);W.forward(error);\n",
  "topology": "awaited"
 },
 {
  "name": "renamed",
  "source": "   W.begin(id,error,fetchClock,Math.max(1,Math.min(500,global.__f1_anchor.D-fetchClock)));\n   const releaseToken=W.promise(new Promise(unlock=>{\n    const originalResolver=W.resolver(unlock);\n    const sampledClock=W.clock(_now());\n    const releaseInterval=Math.max(0,global.__f1_anchor.D+25-sampledClock);\n    setTimeout(originalResolver,releaseInterval);\n   }));\n   { const carriedToken=releaseToken;await W.operand(carriedToken);W.continuation(error); }\n   W.forward(error);\n",
  "topology": "awaited"
 },
 {
  "name": "detached",
  "source": "   W.begin(id,error,fetchClock,Math.max(1,Math.min(500,global.__f1_anchor.D-fetchClock)));\n   const releaseToken=W.promise(new Promise(resolve=>setTimeout(W.resolver(resolve),Math.max(0,global.__f1_anchor.D+25-W.clock(_now())))));\n   // Deliberately no await or cleanup join: real ref'ed timer remains live.\n   W.forward(error);\n",
  "topology": "detached"
 }
];
const witnessActivationObserver="\n const A=(()=>{\n  const crypto=require('node:crypto'),keys=crypto.generateKeyPairSync('ed25519');\n  const publicKey=keys.publicKey.export({type:'spki',format:'pem'});\n  let fault=false,attempts=0,exports=0,fetches=0,raw=null,signature=null;\n  const need=x=>{if(!x)throw Error('activation integrity');};\n  const observe=work=>{try{work();}catch(error){fault=true;try{log({event:'activation-error',message:String(error)});}catch{}}};\n  return {\n   anchor(value,stack){observe(()=>{\n    attempts++;need(attempts===1&&global.__f1_anchor.value===value&&global.__f1_anchor.stack===stack);\n    need(process.env.F1_SOURCE_HASH==='da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84');\n    need(require('node:crypto').createHash('sha256').update(fs.readFileSync(process.env.F1_SOURCE)).digest('hex')===process.env.F1_SOURCE_HASH);\n    need(Number(process.env.F1_ANCHOR_LINE)===73&&Number.isSafeInteger(value));\n    const record={version:1,value,D:global.__f1_anchor.D,stack,source:process.env.F1_SOURCE,sourceHash:process.env.F1_SOURCE_HASH,supervisorPid:process.pid,anchorLine:73};\n    need(record.D===value+5000&&stack.includes(record.source+':73:'));\n    raw=JSON.stringify(record);signature=crypto.sign(null,Buffer.from(raw),keys.privateKey).toString('base64');\n    // This runs synchronously inside the genuine Date.now call, before the runtime's env spread/spawn.\n    process.env.F1_WITNESS_D=raw;process.env.F1_WITNESS_D_SIGNATURE=signature;process.env.F1_WITNESS_D_KEY=publicKey;\n    log({event:'activation-D-created',raw,signature,publicKey});\n   });},\n   environment(k,opts){\n    const env={...(opts&&opts.env||{}),F1_KIND:k};\n    observe(()=>{\n     need(k==='provider'&&attempts===1&&!fault&&raw!==null&&exports===0);\n     need(env.F1_WITNESS_D===raw&&env.F1_WITNESS_D_SIGNATURE===signature&&env.F1_WITNESS_D_KEY===publicKey);\n     need(typeof process.env.F1_WITNESS_PROVIDER_OPTIONS==='string'&&process.env.F1_WITNESS_PROVIDER_OPTIONS.length>0);\n     env.NODE_OPTIONS=process.env.F1_WITNESS_PROVIDER_OPTIONS;exports++;\n     log({event:'activation-D-export',raw,signature,publicKey,kind:k});\n    });return env;\n   },\n   fetch(id,now,ms){observe(()=>{\n    fetches++;need(fetches===1&&id===1&&exports===1&&raw!==null);\n    const D=global.__f1_anchor.D;need(Number.isSafeInteger(now)&&now<D&&now>=D-500&&ms===D-now&&ms>0&&ms<=500);\n    log({event:'activation-first-fetch',id,now,ms,D});\n   });},\n   complete(){return !fault&&attempts===1&&exports===1&&fetches===1;}\n  };\n })();\n";
const witnessProviderPreload="\n// Test-only owned provider binding. The serialized D comes from the genuine supervisor clock return.\nconst fs=require('node:fs'),net=require('node:net'),http=require('node:http'),crypto=require('node:crypto');\nconst now=Date.now.bind(Date),mono=()=>process.hrtime.bigint().toString();\nconst log=e=>fs.appendFileSync(process.env.F1_AUDIT,JSON.stringify({...e,pid:process.pid,time:now(),monoNs:mono()})+'\\n');\nconst need=x=>{if(!x)throw Error('provider activation STOP');};\nconst raw=process.env.F1_WITNESS_D,signature=process.env.F1_WITNESS_D_SIGNATURE,publicKey=process.env.F1_WITNESS_D_KEY;\nneed(typeof raw==='string'&&typeof signature==='string'&&typeof publicKey==='string');\nneed(crypto.verify(null,Buffer.from(raw),publicKey,Buffer.from(signature,'base64')));\nconst record=JSON.parse(raw);\nneed(Object.keys(record).join(',')==='version,value,D,stack,source,sourceHash,supervisorPid,anchorLine');\nneed(record.version===1&&record.supervisorPid===process.ppid&&record.anchorLine===73);\nneed(record.source===process.env.F1_SOURCE&&record.sourceHash===process.env.F1_SOURCE_HASH);\nneed(record.sourceHash==='da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84');\nneed(crypto.createHash('sha256').update(fs.readFileSync(record.source)).digest('hex')===record.sourceHash);\nneed(Number.isSafeInteger(record.value)&&Number.isSafeInteger(record.D)&&record.D===record.value+5000);\nneed(typeof record.stack==='string'&&record.stack.includes(record.source+':73:'));\nlog({event:'activation-D-import',raw,signature,publicKey,parentPid:process.ppid});\nconst D=record.D,target=D-300;let listens=0,bounds=0,sends=0;\nconst listen=net.Server.prototype.listen;\nnet.Server.prototype.listen=function(...args){\n need(++listens===1);const sampledClock=now(),ms=target-sampledClock;need(ms>0);\n log({event:'activation-bind-timer',sampledClock,ms,target,D});\n this.once('listening',()=>{\n  need(++bounds===1);const address=this.address(),boundClock=now();\n  need(boundClock>=D-400&&boundClock<=D-200);\n  need(address?.address==='127.0.0.1'&&address.port===4101&&address.family==='IPv4');\n  log({event:'actual-bound',address,boundClock,D,target});\n });\n setTimeout(()=>{\n  const callbackClock=now();need(callbackClock>=D-400&&callbackClock<=D-200);\n  log({event:'activation-listen-call',callbackClock,D,target});\n  listen.apply(this,args);\n },ms);return this;\n};\nconst send=process.send;need(typeof send==='function');\nprocess.send=function(message,...args){\n need(message?.type==='provider-bound'&&++sends===1&&message.pid===process.pid);\n need(message.address?.address==='127.0.0.1'&&message.address.port===4101&&message.address.family==='IPv4');\n log({event:'ipc',kind:'provider',message});return send.call(this,message,...args);\n};\nconst emit=http.Server.prototype.emit;\nhttp.Server.prototype.emit=function(event,...args){\n if(event==='request'){const [req]=args;log({event:'hung-request',method:req.method,url:req.url});return true;}\n return emit.call(this,event,...args);\n};\nrequire('node:module').syncBuiltinESMExports();\n";
function makeWitnessPreload(fixture){
 let text=supervisorPreload;
 const activationPairs=[
  [" let budgetClock,fetchClock,fetchId=0;",witnessActivationObserver+"\n let budgetClock,fetchClock,fetchId=0;"],
  ["  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_BUDGET_LINE+':'))budgetClock=value;","  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_ANCHOR_LINE+':'))A.anchor(value,stack);\n  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_BUDGET_LINE+':'))budgetClock=value;"],
  ["  log({event:'fetch-budget',id,now,ms});","  A.fetch(id,now,ms);\n  log({event:'fetch-budget',id,now,ms});"],
  ["  const child=_spawn.call(this,command,args,{...opts,env:{...(opts&&opts.env||{}),F1_KIND:k}});","  const child=_spawn.call(this,command,args,{...opts,env:A.environment(k,opts)});"]
 ];
 for(const [before,after] of activationPairs){assert.equal(text.split(before).length,2);text=text.replace(before,after);}
 const marker=' const _setTimeout=globalThis.setTimeout;';
 assert.equal(text.split(marker).length,2);text=text.replace(marker,witnessObserver.replace('const complete=()=>!observerFault','const complete=()=>A.complete()&&!observerFault')+'\n'+marker);
 const timer='  return _setTimeout(callback,ms,...args);';
 assert.equal(text.split(timer).length,2);
 text=text.replace(timer,'  if(W.owns(callback))return W.timer(callback,ms,args,this,_setTimeout);\n'+timer);
 const substitutions=[
  [" const _cerr=console.error;console.error=function(...args){log({event:String(args[0]).startsWith('[e2e] FAIL')?'fail-invocation':'stderr-log',msg:String(args[0])});return _cerr.apply(this,args);};"," const _cerr=console.error;console.error=function(...args){return W.fail(this,args,_cerr);};"],
  [" const _write=process.stderr.write;process.stderr.write=function(...args){log({event:'stderr-write',text:String(args[0])});return _write.apply(this,args);};"," const _write=process.stderr.write;process.stderr.write=function(...args){return W.stderr(this,args,_write);};"],
  ["  log({event:'spawn',kind:k,pid:child.pid,call_time,call_rel_D});","  log({event:'spawn',kind:k,pid:child.pid,call_time,call_rel_D});W.child(child,k);"]
 ];
 for(const [before,after] of substitutions){assert.equal(text.split(before).length,2);text=text.replace(before,after);}
 const rejection="   log({event:'fetch-reject',id});throw error;";
 assert.equal(text.split(rejection).length,2);
 const body="   if(fetchClock+Math.max(1,Math.min(500,global.__f1_anchor.D-fetchClock))===global.__f1_anchor.D){\n"+fixture.source+'   }\n';
 return text.replace(rejection,body+rejection);
}
// Frozen static map is a review input, not a dynamically asserted proof.
const witnessFlowMap=witnessFixtures.map(f=>({
 preloadHash:witnessDigest(makeWitnessPreload(f)),providerPreloadHash:witnessDigest(witnessProviderPreload),fixtureHash:witnessDigest(f.source),
 topology:f.topology,executorSources:f.topology==='direct'?0:1,
 settlementSources:f.topology==='direct'?0:1,adoptionSources:0,
 forwardingAwaitOperands:f.topology==='awaited'?1:0,cleanupAwaitOperands:0,
 firstContinuationForwards:f.topology==='awaited',testHash:witnessTestHash,runtimeHash:e2eSourceHash
}));

function witnessActivation(r,m){
 const one=name=>{const xs=r.events.filter(e=>e.event===name);assert.equal(xs.length,1,'Activation STOP: '+name);return xs[0];};
 assert.equal(r.events.filter(e=>e.event==='activation-error').length,0,'Activation STOP: sticky source error');
 const a=one('anchor'),created=one('activation-D-created'),exported=one('activation-D-export'),imported=one('activation-D-import');
 assert.equal(a.pid,r.supervisorPid);assert.equal(a.source,r.source);assert.equal(a.sourceHash,r.sourceHash);
 assert.equal(a.D,a.value+5000);assert.ok(a.stack.includes(r.source+':73:'));
 const record=JSON.parse(created.raw);
 assert.deepEqual(record,{version:1,value:a.value,D:a.D,stack:a.stack,source:r.source,sourceHash:r.sourceHash,supervisorPid:r.supervisorPid,anchorLine:73});
 assert.ok(verifySignature(null,Buffer.from(created.raw),created.publicKey,Buffer.from(created.signature,'base64')),'Activation STOP: bad serialized signature');
 for(const x of [exported,imported])for(const k of ['raw','signature','publicKey'])assert.equal(x[k],created[k],'Activation STOP: cross-process D mismatch');
 for(const x of [created,exported])assert.equal(x.pid,r.supervisorPid);
 assert.equal(exported.kind,'provider');
 const spawns=r.events.filter(e=>e.event==='spawn');assert.equal(spawns.length,1);
 const child=spawns[0];assert.equal(child.kind,'provider');assert.ok(child.pid>0&&child.pid!==r.supervisorPid);
 assert.equal(imported.pid,child.pid);assert.equal(imported.parentPid,r.supervisorPid);
 assert.ok(r.events.indexOf(created)<r.events.indexOf(exported));assert.ok(created.time<=exported.time&&exported.time<=imported.time);
 const timer=one('activation-bind-timer'),call=one('activation-listen-call'),bound=one('actual-bound'),sent=one('ipc'),ipc=one('ipc-received');
 for(const x of [timer,call,bound,sent])assert.equal(x.pid,child.pid);
 assert.equal(timer.D,a.D);assert.equal(timer.target,a.D-300);assert.equal(timer.ms,timer.target-timer.sampledClock);assert.ok(timer.ms>0);
 assert.equal(call.D,a.D);assert.equal(call.target,timer.target);assert.ok(call.callbackClock>=a.D-400&&call.callbackClock<=a.D-200);
 assert.equal(bound.D,a.D);assert.equal(bound.target,timer.target);assert.ok(bound.boundClock>=a.D-400&&bound.boundClock<=a.D-200);
 assert.ok(imported.time<=timer.time&&timer.time<=call.time&&call.time<=bound.time);
 const providerEvents=r.events.filter(e=>e.pid===child.pid&&e.monoNs!==undefined);
 assert.ok(providerEvents.length>=6);for(let i=1;i<providerEvents.length;i++){
  assert.ok(BigInt(providerEvents[i].monoNs)>=BigInt(providerEvents[i-1].monoNs),'Activation STOP: nonmonotonic provider observer');
  assert.ok(providerEvents[i].time>=providerEvents[i-1].time,'Activation STOP: wallclock regression');
 }
 for(const x of [sent,ipc]){assert.equal(x.message.type,'provider-bound');assert.equal(x.message.pid,child.pid);assert.equal(x.pid,child.pid);assert.deepEqual(x.message.address,{address:'127.0.0.1',port:4101,family:'IPv4'});}
 assert.deepEqual(bound.address,ipc.message.address);assert.ok(bound.time<=ipc.time&&sent.time<=ipc.time&&ipc.time<a.D);
 const b=one('fetch-budget'),s=one('fetch-start'),admitted=one('activation-first-fetch'),abort=one('fetch-abort'),native=one('native-fetch-reject'),reject=one('fetch-reject');
 for(const x of [b,s,admitted,abort,native,reject]){assert.equal(x.pid,r.supervisorPid);assert.equal(x.id,1);}
 assert.ok(b.now>=a.D-500&&b.now<a.D);assert.equal(b.ms,a.D-b.now);assert.equal(b.ms,Math.max(1,Math.min(500,a.D-b.now)));
 assert.equal(admitted.now,b.now);assert.equal(admitted.ms,b.ms);assert.equal(admitted.D,a.D);
 assert.ok(s.time>=ipc.time&&s.time>=a.D-500&&s.time<a.D);assert.equal(s.url,'http://127.0.0.1:4101/.well-known/proofmeta.json');
 const req=one('hung-request');assert.equal(req.pid,child.pid);assert.equal(req.method,'GET');assert.equal(req.url,'/.well-known/proofmeta.json');assert.ok(req.time>=s.time&&req.time<=abort.time);
 assert.equal(r.events.filter(e=>e.event==='http-headers').length,0,'Activation STOP: HTTP answered');
 assert.ok(abort.time<=native.time&&native.time<=reject.time);
 assert.equal(m.providerPreloadHash,r.providerHookHash,'Activation STOP: provider bytes not source-bound');
}

function witnessIntegrity(r,flowMap){
 assert.equal(r.witnessStatusText,'OK '+r.supervisorPid+' '+r.sourceHash+'\n','Integrity STOP: observer completion missing/faulted');
 assert.equal(r.events.filter(e=>e.event==='witness-integrity-error').length,0,'Integrity STOP: observer error');
 assert.equal(r.code,1,'Integrity STOP: expected natural planned FAIL exit 1');assert.equal(r.signal,null);
 const planned=r.events.filter(e=>e.event==='fail-invocation');assert.equal(planned.length,1);
 assert.equal(planned[0].pid,r.supervisorPid);assert.equal(planned[0].msg,'[e2e] FAIL — provider HTTP endpoint not ready after owned-bound');
 assert.ok(r.events.some(e=>e.event==='stderr-write'&&e.pid===r.supervisorPid&&e.text===planned[0].msg+'\n'&&e.time>=planned[0].time));
 cleanupGate(r); // real TERM/exit/close/reaping before any timing classification
 const matches=flowMap.filter(m=>m.preloadHash===r.hookHash&&m.testHash===witnessTestHash&&m.runtimeHash===r.sourceHash);
 assert.equal(matches.length,1,'Integrity RED: missing/ambiguous source flow binding');const m=matches[0];
 assert.equal(m.runtimeHash,'da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84');
 assert.equal(m.adoptionSources,0);assert.equal(m.cleanupAwaitOperands,0);
 witnessActivation(r,m); // explicit activation STOP before Witness structure/timing
 const events=r.events.filter(e=>e.event.startsWith('witness-'));
 const catches=events.filter(e=>e.event==='witness-catch');
 assert.equal(catches.length,1,'INCONCLUSIVE STOP: real final catch not activated');
 const c=catches[0];assert.equal(c.pid,r.supervisorPid);assert.equal(c.sourceHash,r.sourceHash);
 const anchor=r.events.find(e=>e.event==='anchor');assert.ok(anchor);assert.equal(c.finalD,anchor.D);
 const budget=r.events.find(e=>e.event==='fetch-budget'&&e.id===c.fetchId);
 const start=r.events.find(e=>e.event==='fetch-start'&&e.id===c.fetchId);
 const native=r.events.find(e=>e.event==='native-fetch-reject'&&e.id===c.fetchId);
 assert.ok(budget&&start&&native);assert.equal(budget.now,c.clock);assert.equal(budget.ms,c.budget);
 assert.ok(start.pid===c.pid&&native.pid===c.pid&&native.time<=c.time);
 const scoped=events.filter(e=>e.record===c.record);
 assert.equal(scoped.length,events.length,'Integrity RED: foreign/extra records');
 assert.ok(scoped.every(e=>e.pid===c.pid&&e.fetchId===c.fetchId));
 const exactly=name=>{const x=scoped.filter(e=>e.event==='witness-'+name);assert.equal(x.length,1,'Integrity RED: '+name);return x[0];};
 const f=exactly('forward');assert.ok(f.sameError&&f.error===c.error&&f.caughtError===c.error);
 const realReject=r.events.find(e=>e.event==='fetch-reject'&&e.id===c.fetchId);
 assert.ok(realReject&&realReject.time>=f.time);
 const ref=x=>assert.ok(Number.isSafeInteger(x)&&x>0,'Integrity RED: invalid reference ID');ref(c.error);ref(c.record);
 if(m.topology==='direct'){
  assert.equal(m.executorSources,0);assert.equal(m.settlementSources,0);assert.equal(m.forwardingAwaitOperands,0);
  assert.equal(f.hasPromise,false);assert.equal(scoped.length,2);
  for(const key of ['promise','resolver','entryCallback','backendWrapper','clock','ms','due'])assert.equal(f[key],null);
  for(const key of ['operands','continuations','registrations','callbacks','outcomes'])assert.equal(f[key],0);
 }else{
  assert.ok(['awaited','detached'].includes(m.topology));assert.equal(m.executorSources,1);assert.equal(m.settlementSources,1);
  const t=exactly('timer-register'),b=exactly('wrapper-entry'),v=exactly('resolver-outcome');
  for(const x of [f.promise,f.resolver,f.entryCallback,f.backendWrapper,t.resolver,t.entryCallback,t.backendWrapper,b.resolver,b.entryCallback,b.backendWrapper,v.resolver,v.backendWrapper])ref(x);
  assert.equal(new Set([c.error,c.record,f.promise,f.resolver,f.backendWrapper]).size,5);
  assert.ok(f.hasPromise&&f.sameEntry&&t.sameEntry&&b.sameEntry&&f.distinctBackend&&t.distinctBackend&&b.distinctBackend);
  assert.ok([f.entryCallback,t.resolver,t.entryCallback,b.resolver,b.entryCallback,v.resolver].every(x=>x===f.resolver));
  assert.ok([t.backendWrapper,b.backendWrapper,v.backendWrapper].every(x=>x===f.backendWrapper));
  assert.notEqual(f.backendWrapper,f.resolver);
  assert.equal(f.registrations,1);assert.equal(b.argumentCount,0);assert.equal(v.argumentCount,0);
  assert.equal(b.wrapperCount,1);assert.equal(v.wrapperCount,1);assert.equal(v.outcomeCount,1);assert.equal(v.outcome,'return');
  assert.ok(scoped.indexOf(b)<scoped.indexOf(v)&&b.time<=v.time);
  assert.equal(t.clock,f.clock);assert.equal(t.ms,f.ms);assert.equal(t.due,f.due);
  assert.ok(Number.isFinite(t.clock)&&Number.isFinite(t.ms)&&Number.isFinite(t.due));
  assert.equal(t.ms,Math.max(0,anchor.D+25-t.clock));assert.equal(t.due,t.clock+t.ms);
  assert.ok(t.ms>0,'INCONCLUSIVE STOP: no positive authentic wait');
  assert.ok(t.time>=c.time&&b.time>=t.time);
  if(m.topology==='awaited'){
   assert.equal(m.forwardingAwaitOperands,1);assert.equal(m.firstContinuationForwards,true);
   const o=exactly('operand'),a=exactly('continuation');
   assert.ok(o.same&&o.promise===f.promise&&o.registeredPromise===f.promise&&a.promise===f.promise&&a.error===c.error);
   assert.equal(f.operands,1);assert.equal(f.continuations,1);assert.equal(f.callbacks,1);assert.equal(f.outcomes,1);assert.equal(scoped.length,7);
   assert.ok(scoped.indexOf(t)<scoped.indexOf(o)&&scoped.indexOf(o)<scoped.indexOf(b)&&scoped.indexOf(b)<scoped.indexOf(v)&&scoped.indexOf(v)<scoped.indexOf(a)&&scoped.indexOf(a)<scoped.indexOf(f));
   assert.ok(v.time<=a.time&&a.time<=f.time);
  }else{
   assert.equal(m.forwardingAwaitOperands,0);assert.equal(m.firstContinuationForwards,false);
   assert.equal(f.operands,0);assert.equal(f.continuations,0);assert.equal(f.callbacks,0);assert.equal(f.outcomes,0);assert.equal(scoped.length,5);
   assert.ok(scoped.indexOf(t)<scoped.indexOf(f)&&scoped.indexOf(f)<scoped.indexOf(b));
   assert.ok(b.time>=f.time,'detached callback must really execute after forwarding');
  }
 }
 return {m,c,f,anchor};
}
function witnessGate(r,flowMap){
 // Integrity/source binding before causality; no caseMode/name/expected disposition.
 const {m,f,anchor}=witnessIntegrity(r,flowMap);
 readinessGate(r); // exact existing budgets, strict admission and 4900..5100/100ms
 return m.forwardingAwaitOperands===1&&f.due>anchor.D&&f.time>anchor.D?'TIMING_RED':'GREEN';
}
// Four first serial runs ONLY after exact candidate pin is externally reviewed.
// Review authorization is not itself a behavioral PASS. Fixture expectations live outside gate.
for(const [index,fixture] of witnessFixtures.entries())test(`Witness B first ${index+1}: ${fixture.name}`,{
 timeout:25000,concurrency:false,
 skip:process.env.F1_WITNESS_SOURCE_REVIEWED_SHA!==witnessTestHash
},async()=>{
 const r=await runSupervisor('readiness-budget',{preloadText:makeWitnessPreload(fixture),witnessStatus:true,providerPreloadText:witnessProviderPreload});
 fail(r,true);cleanupGate(r);
 assert.equal(witnessGate(r,witnessFlowMap),fixture.topology==='awaited'?'TIMING_RED':'GREEN');
});

// Owner-approved local delivery coverage only. Original HIGH04 claims remain untouched.
// H04-05 is STOP before construction: no proven live post-D server write path.
async function high04DeliveryProof(mode,hook,expectedHash){
 assert.equal(createHash('sha256').update(hook).digest('hex'),expectedHash);
 const r=await runSupervisor(mode,{preloadText:hook});
 assert.equal(r.hookHash,expectedHash);
 assert.equal(r.sourceHash,'da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84');
 const a=anchorGate(r);fail(r,true);assert.deepEqual(r.alive,[]);
 const one=name=>{const xs=r.events.filter(e=>e.event===name);assert.equal(xs.length,1,name);return xs[0];};
 const child=one('spawn'),registration=one('delivery-registration'),receipt=one('delivery-native-receipt');
 assert.equal(child.kind,'provider');assert.equal(registration.pid,child.pid);assert.equal(receipt.pid,child.pid);
 assert.ok(child.call_time<a.D);assert.ok(registration.stack.includes(r.source+':57:'));
 for(const e of [registration,receipt]){assert.equal(e.onceRestored,true);assert.equal(e.emitUnchanged,true);}
 for(const field of ['childId','callbackId','onceId'])assert.equal(registration[field],receipt[field]);
 const nativeExit=one('exit'),nativeClose=one('close'),kill=r.events.find(e=>e.event==='kill'&&e.signal==='SIGKILL');
 const ready=one('fixture-term-ready'),bound=one('actual-bound'),sent=one('ipc'),received=one('ipc-received'),ignored=one('ignored-term');
 assert.ok(kill);assert.equal(ready.pid,child.pid);assert.equal(ready.listenerCount,1);assert.equal(ready.ownsFixtureIgnoreTerm,true);
 assert.equal(bound.pid,child.pid);assert.equal(sent.message.pid,child.pid);assert.equal(sent.message.type,'provider-bound');
 assert.deepEqual(bound.address,{address:'127.0.0.1',family:'IPv4',port:4101});assert.deepEqual(sent.message.address,bound.address);
 assert.equal(received.pid,child.pid);assert.equal(received.message.pid,child.pid+10000);
 assert.ok(bound.time<a.D&&received.time<a.D);assert.equal(ignored.pid,child.pid);
 for(const e of [nativeExit,nativeClose,receipt]){assert.equal(e.pid,child.pid);assert.equal(e.code,null);assert.equal(e.signal,'SIGKILL');}
 assert.ok(receipt.killClock>=kill.time&&receipt.killClock-kill.time<=100);
 assert.ok(nativeExit.time<=nativeClose.time&&nativeClose.time<=receipt.time);
 assert.ok(r.events.indexOf(nativeClose)<r.events.indexOf(receipt),'native observer executes separately before interception callback');
 // Native positive ledger must pass the ORIGINAL gate, never conceal the separate negative.
 cleanupGate(r);
 const errors=r.events.filter(e=>e.event==='fail-invocation');
 assert.equal(errors.length,2);assert.match(errors[0].msg,/provider did not send owned-bound signal/);
 assert.equal(errors[1].msg,'[e2e] FAIL — cleanup: own child failed to close after SIGKILL');
 assert.ok(errors[1].time-kill.time>=1900&&errors[1].time-kill.time<=2100);
 // Rename only authentic callback-completion events. No created events, timestamp edits or metadata delay.
 const runtimeEvents=r.events.filter(e=>e.event!=='close').map(e=>e.event==='runtime-close-delivery'?{...e,event:'close'}:e);
 const deliveryLedger={...r,events:runtimeEvents};
 const delivered=r.events.filter(e=>e.event==='runtime-close-delivery');
 if(mode==='high04-close-late'){
  assert.equal(delivered.length,1);assert.equal(r.events.filter(e=>e.event==='delivery-withheld').length,0);
  const d=delivered[0],timer=one('delivery-timer');assert.equal(d.pid,child.pid);
  assert.equal(d.code,nativeClose.code);assert.equal(d.signal,nativeClose.signal);
  for(const field of ['receiverSame','callbackSame','argsSame','emitUnchanged','resultUndefined'])assert.equal(d[field],true);
  for(const field of ['childId','callbackId','onceId'])assert.equal(d[field],registration[field]);
  assert.equal(timer.target,receipt.killClock+2200);assert.equal(timer.ms,Math.max(0,timer.target-timer.sampledClock));
  assert.ok(d.time>=timer.target&&d.time-kill.time>2100);
  assert.ok(errors[1].time<d.time,'cleanup error before actual late callback completion');
 }else{
  assert.equal(mode,'high04-close-missing');assert.equal(delivered.length,0);
  const withheld=one('delivery-withheld');assert.equal(withheld.pid,child.pid);assert.equal(withheld.receipts,1);assert.equal(withheld.deliveries,0);
  assert.equal(r.events.filter(e=>e.event==='delivery-timer').length,0);
 }
 // All earlier native cleanup conditions passed; these exact retained predicates reject delivery.
 assert.throws(()=>cleanupGate(deliveryLedger),{code:'ERR_ASSERTION'});
 if(process.env.F1_EVIDENCE)await writeFile(path.join(process.env.F1_EVIDENCE,`two-ledgers-${mode}.json`),JSON.stringify({mode,nativeEvents:r.events,runtimeDeliveryEvents:runtimeEvents,nativeGate:'PASS',runtimeDeliveryGate:'EXPECTED_RED',cleanupError:errors[1],sourceHash:r.sourceHash,hookHash:r.hookHash,supervisorPid:r.supervisorPid,alive:r.alive},null,2));
}

const high04_close_late="\nconst cp=require('node:child_process'),fs=require('node:fs'),net=require('node:net'),http=require('node:http');\nconst _now=Date.now.bind(Date),mode=\"high04-close-late\",kind=process.env.F1_KIND||'supervisor';\nconst log=e=>fs.appendFileSync(process.env.F1_AUDIT,JSON.stringify({...e,pid:e.pid??process.pid,time:_now()})+String.fromCharCode(10));\nif(kind==='supervisor'){\n let budgetClock,fetchClock,fetchId=0;\n Date.now=function(){\n  const value=_now(),stack=new Error().stack||'';\n  if(JSON.parse(process.env.F1_ANCHOR_LINES).some(line=>stack.includes(process.env.F1_SOURCE+':'+line+':'))){\n   const D=value+5000;\n   // Keep the original D immutable, but publish every actual assignment clock call.\n   const frame=stack.split('\\n').find(line=>line.includes(process.env.F1_SOURCE+':'));\n   const originLine=Number(frame?.match(/:(\\d+):\\d+\\)?$/)?.[1]);\n   global.__f1_anchor??={value,D,stack,pid:process.pid};\n   log({event:'anchor',value,D,stack,originLine,ppid:process.ppid,source:process.env.F1_SOURCE,sourceHash:process.env.F1_SOURCE_HASH});\n  }\n  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_BUDGET_LINE+':'))budgetClock=value;\n  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_FETCH_LINE+':'))fetchClock=value;\n  return value;\n };\n const _setTimeout=globalThis.setTimeout;\n globalThis.setTimeout=function(callback,ms,...args){\n  const stack=new Error().stack||'';\n  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_TIMER_LINE+':')){\n   const phase=stack.includes(process.env.F1_SOURCE+':'+process.env.F1_TERM_LINE+':')?'term-grace':stack.includes(process.env.F1_SOURCE+':'+process.env.F1_KILL_LINE+':')?'kill-reap':'other';\n   log({event:'timer-argument',phase,ms,stack});\n  }\n  if(budgetClock!==undefined&&stack.includes(process.env.F1_SOURCE+':'+process.env.F1_TIMER_LINE+':')){\n   log({event:'binding-budget',now:budgetClock,ms,actualD:budgetClock+ms,stack});\n   budgetClock=undefined;\n  }\n  return _setTimeout(callback,ms,...args);\n };\n const _fetch=globalThis.fetch;\n const _timeout=AbortSignal.timeout;\n AbortSignal.timeout=function(ms){\n  const id=++fetchId,now=fetchClock;\n  const signal=_timeout.call(this,ms);\n  log({event:'fetch-budget',id,now,ms});\n  signal.addEventListener('abort',()=>log({event:'fetch-abort',id}));\n  return signal;\n };\n globalThis.fetch=async function(url,opts){\n  const id=fetchId;log({event:'fetch-start',id,url:String(url)});\n  let r;\n  try{r=await _fetch.call(this,url,opts);}catch(error){\n   log({event:'native-fetch-reject',id});\n   if(mode==='readiness-reject-6142'&&fetchClock+Math.max(1,Math.min(500,global.__f1_anchor.D-fetchClock))===global.__f1_anchor.D){\n    const target=global.__f1_anchor.value+6142;\n    log({event:'reject-delay-start',id,target});\n    await new Promise(resolve=>setTimeout(resolve,Math.max(0,target-_now())));\n   }\n   log({event:'fetch-reject',id});throw error;\n  }\n  const D=global.__f1_anchor?.D??0;\n  log({event:'http-headers',status:r.status,ok:r.ok,time_rel_D:_now()-D});\n  if(r.body){\n   const _cancel=r.body.cancel.bind(r.body);\n   r.body.cancel=async function(...args){\n    const D2=global.__f1_anchor?.D??0;\n    log({event:'cancel-call',time_rel_D:_now()-D2});\n    const result=await _cancel(...args);\n    log({event:'native-cancel-resolution',time_rel_D:_now()-D2});\n    if(mode==='cancel-delay-D150'&&global.__f1_anchor){\n     const target=global.__f1_anchor.D+150;const wait=target-_now();\n     if(wait>0){log({event:'cancel-delay-start',target});await new Promise(resolve=>setTimeout(resolve,wait));log({event:'cancel-delay-done'});}\n    }\n    log({event:'cancel-return',time_rel_D:_now()-D2});\n    return result;\n   };\n  }\n  return r;\n };\n const _spawn=cp.spawn;\n cp.spawn=function(command,args,opts){\n  const k=args&&(args.includes('--provider-child')||args.some(x=>typeof x==='string'&&x.endsWith('/examples/provider/server.mjs')))?'provider':args&&args.some(x=>typeof x==='string'&&x.endsWith('/examples/consumer/client.mjs'))?'consumer':'other';\n  const call_time=_now(),D=global.__f1_anchor?.D??0,call_rel_D=call_time-D;\n  const child=_spawn.call(this,command,args,{...opts,env:{...(opts&&opts.env||{}),F1_KIND:k}});\n  log({event:'spawn',kind:k,pid:child.pid,call_time,call_rel_D});\n  child.once('exit',(code,signal)=>log({event:'exit',kind:k,pid:child.pid,code,signal}));\n  child.once('close',(code,signal)=>log({event:'close',kind:k,pid:child.pid,code,signal}));\n  let high04KillClock=null;const _kill=child.kill;child.kill=function(signal){log({event:'kill',kind:k,pid:child.pid,signal});if(signal==='SIGKILL')high04KillClock=_now();return _kill.call(this,signal);};\n  if(k==='provider')child.on('message',message=>log({event:'ipc-received',pid:child.pid,message}));\n  if(k==='provider'){\n   // Only the true runtime registration is faulted; native observers above stay independent.\n   const originalOnce=child.once,originalEmit=child.emit;\n   const ids=new WeakMap();let serial=0,registrations=0,receipts=0,deliveries=0;\n   const ident=x=>{if(!ids.has(x))ids.set(x,++serial);return ids.get(x);};\n   const need=x=>{if(!x)throw Error('HIGH04 close-delivery integrity STOP');};\n   child.once=function(event,callback){\n    const stack=new Error().stack||'';\n    if(event!=='close')return originalOnce.call(this,event,callback);\n    need(this===child&&stack.includes(process.env.F1_SOURCE+':57:')&&++registrations===1);\n    need(process.env.F1_SOURCE_HASH==='da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84');\n    need(require('node:crypto').createHash('sha256').update(fs.readFileSync(process.env.F1_SOURCE)).digest('hex')===process.env.F1_SOURCE_HASH);\n    const runtimeCallback=callback,childId=ident(child),callbackId=ident(callback),onceId=ident(originalOnce);\n    child.once=originalOnce;\n    log({event:'delivery-registration',kind:k,pid:child.pid,stack,childId,callbackId,onceId,onceRestored:child.once===originalOnce,emitUnchanged:child.emit===originalEmit});\n    return originalOnce.call(child,'close',function(...nativeArgs){\n     const killClock=high04KillClock;\n     need(this===child&&++receipts===1&&killClock!==null&&child.emit===originalEmit&&child.once===originalOnce);\n     need(nativeArgs[0]===null&&nativeArgs[1]==='SIGKILL');\n     log({event:'delivery-native-receipt',kind:k,pid:child.pid,childId,callbackId,onceId,code:nativeArgs[0],signal:nativeArgs[1],killClock,emitUnchanged:true,onceRestored:true});\n     if(mode==='high04-close-missing'){\n      log({event:'delivery-withheld',kind:k,pid:child.pid,childId,callbackId,receipts,deliveries});\n      return;\n     }\n     const target=killClock+2200,sampledClock=_now(),ms=Math.max(0,target-sampledClock);\n     log({event:'delivery-timer',kind:k,pid:child.pid,target,sampledClock,ms,killClock});\n     _setTimeout(function(){\n      need(++deliveries===1&&receipts===1&&runtimeCallback===callback&&ident(child)===childId&&ident(runtimeCallback)===callbackId&&child.emit===originalEmit);\n      const result=runtimeCallback.apply(child,nativeArgs);\n      // Completion of the actual callback, not a timestamp-shifted native close record.\n      log({event:'runtime-close-delivery',kind:k,pid:child.pid,childId,callbackId,onceId,code:nativeArgs[0],signal:nativeArgs[1],killClock,target,receiverSame:true,callbackSame:true,argsSame:true,emitUnchanged:true,resultUndefined:result===undefined});\n     },ms);\n    });\n   };\n  }\n  return child;\n };\n const _cerr=console.error;console.error=function(...args){log({event:String(args[0]).startsWith('[e2e] FAIL')?'fail-invocation':'stderr-log',msg:String(args[0])});return _cerr.apply(this,args);};\n const _write=process.stderr.write;process.stderr.write=function(...args){log({event:'stderr-write',text:String(args[0])});return _write.apply(this,args);};\n}else if(kind==='provider'){\n const fixtureIgnoreTerm=()=>log({event:'ignored-term'});\n if(['ignore-term','high04-close-late','high04-close-missing'].includes(mode))process.on('SIGTERM',fixtureIgnoreTerm);\n const listen=net.Server.prototype.listen;\n net.Server.prototype.listen=function(...args){this.once('listening',()=>{\n  log({event:'actual-bound',address:this.address()});\n\n });\n if(mode.startsWith('readiness-')){setTimeout(()=>listen.apply(this,args),3500);return this;}\n return listen.apply(this,args);};\n const emit=http.Server.prototype.emit;\n http.Server.prototype.emit=function(event,...args){if(event==='request'&&mode.startsWith('readiness-')){log({event:'hung-request'});return true;}return emit.call(this,event,...args);};\n const send=process.send?.bind(process);\n if(send)process.send=function(message,...args){\n  if(['ignore-term','high04-close-late','high04-close-missing'].includes(mode)&&message?.type==='provider-bound'){\n   for(const listener of process.listeners('SIGTERM'))if(listener!==fixtureIgnoreTerm)process.removeListener('SIGTERM',listener);\n   log({event:'fixture-term-ready',kind:'provider',pid:process.pid,listenerCount:process.listeners('SIGTERM').length,ownsFixtureIgnoreTerm:process.listeners('SIGTERM').includes(fixtureIgnoreTerm)});\n  }\n  log({event:'ipc',kind:'provider',message});\n  return send(['ignore-term','high04-close-late','high04-close-missing'].includes(mode)?{...message,pid:process.pid+10000}:message,...args);\n };\n}else if(kind==='consumer'){log({event:'consumer-process-start'});}\nrequire('node:module').syncBuiltinESMExports();\n";
test('HIGH04 H04-10: owner-addendum real close delivery late is EXPECTED_RED',{timeout:25000},async()=>{
 await high04DeliveryProof('high04-close-late',high04_close_late,'b2c97ae49dff0bec5718140c75d351e9d18699b65f89294f8bd1539dd08e0dfb');
});

const high04_close_missing="\nconst cp=require('node:child_process'),fs=require('node:fs'),net=require('node:net'),http=require('node:http');\nconst _now=Date.now.bind(Date),mode=\"high04-close-missing\",kind=process.env.F1_KIND||'supervisor';\nconst log=e=>fs.appendFileSync(process.env.F1_AUDIT,JSON.stringify({...e,pid:e.pid??process.pid,time:_now()})+String.fromCharCode(10));\nif(kind==='supervisor'){\n let budgetClock,fetchClock,fetchId=0;\n Date.now=function(){\n  const value=_now(),stack=new Error().stack||'';\n  if(JSON.parse(process.env.F1_ANCHOR_LINES).some(line=>stack.includes(process.env.F1_SOURCE+':'+line+':'))){\n   const D=value+5000;\n   // Keep the original D immutable, but publish every actual assignment clock call.\n   const frame=stack.split('\\n').find(line=>line.includes(process.env.F1_SOURCE+':'));\n   const originLine=Number(frame?.match(/:(\\d+):\\d+\\)?$/)?.[1]);\n   global.__f1_anchor??={value,D,stack,pid:process.pid};\n   log({event:'anchor',value,D,stack,originLine,ppid:process.ppid,source:process.env.F1_SOURCE,sourceHash:process.env.F1_SOURCE_HASH});\n  }\n  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_BUDGET_LINE+':'))budgetClock=value;\n  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_FETCH_LINE+':'))fetchClock=value;\n  return value;\n };\n const _setTimeout=globalThis.setTimeout;\n globalThis.setTimeout=function(callback,ms,...args){\n  const stack=new Error().stack||'';\n  if(stack.includes(process.env.F1_SOURCE+':'+process.env.F1_TIMER_LINE+':')){\n   const phase=stack.includes(process.env.F1_SOURCE+':'+process.env.F1_TERM_LINE+':')?'term-grace':stack.includes(process.env.F1_SOURCE+':'+process.env.F1_KILL_LINE+':')?'kill-reap':'other';\n   log({event:'timer-argument',phase,ms,stack});\n  }\n  if(budgetClock!==undefined&&stack.includes(process.env.F1_SOURCE+':'+process.env.F1_TIMER_LINE+':')){\n   log({event:'binding-budget',now:budgetClock,ms,actualD:budgetClock+ms,stack});\n   budgetClock=undefined;\n  }\n  return _setTimeout(callback,ms,...args);\n };\n const _fetch=globalThis.fetch;\n const _timeout=AbortSignal.timeout;\n AbortSignal.timeout=function(ms){\n  const id=++fetchId,now=fetchClock;\n  const signal=_timeout.call(this,ms);\n  log({event:'fetch-budget',id,now,ms});\n  signal.addEventListener('abort',()=>log({event:'fetch-abort',id}));\n  return signal;\n };\n globalThis.fetch=async function(url,opts){\n  const id=fetchId;log({event:'fetch-start',id,url:String(url)});\n  let r;\n  try{r=await _fetch.call(this,url,opts);}catch(error){\n   log({event:'native-fetch-reject',id});\n   if(mode==='readiness-reject-6142'&&fetchClock+Math.max(1,Math.min(500,global.__f1_anchor.D-fetchClock))===global.__f1_anchor.D){\n    const target=global.__f1_anchor.value+6142;\n    log({event:'reject-delay-start',id,target});\n    await new Promise(resolve=>setTimeout(resolve,Math.max(0,target-_now())));\n   }\n   log({event:'fetch-reject',id});throw error;\n  }\n  const D=global.__f1_anchor?.D??0;\n  log({event:'http-headers',status:r.status,ok:r.ok,time_rel_D:_now()-D});\n  if(r.body){\n   const _cancel=r.body.cancel.bind(r.body);\n   r.body.cancel=async function(...args){\n    const D2=global.__f1_anchor?.D??0;\n    log({event:'cancel-call',time_rel_D:_now()-D2});\n    const result=await _cancel(...args);\n    log({event:'native-cancel-resolution',time_rel_D:_now()-D2});\n    if(mode==='cancel-delay-D150'&&global.__f1_anchor){\n     const target=global.__f1_anchor.D+150;const wait=target-_now();\n     if(wait>0){log({event:'cancel-delay-start',target});await new Promise(resolve=>setTimeout(resolve,wait));log({event:'cancel-delay-done'});}\n    }\n    log({event:'cancel-return',time_rel_D:_now()-D2});\n    return result;\n   };\n  }\n  return r;\n };\n const _spawn=cp.spawn;\n cp.spawn=function(command,args,opts){\n  const k=args&&(args.includes('--provider-child')||args.some(x=>typeof x==='string'&&x.endsWith('/examples/provider/server.mjs')))?'provider':args&&args.some(x=>typeof x==='string'&&x.endsWith('/examples/consumer/client.mjs'))?'consumer':'other';\n  const call_time=_now(),D=global.__f1_anchor?.D??0,call_rel_D=call_time-D;\n  const child=_spawn.call(this,command,args,{...opts,env:{...(opts&&opts.env||{}),F1_KIND:k}});\n  log({event:'spawn',kind:k,pid:child.pid,call_time,call_rel_D});\n  child.once('exit',(code,signal)=>log({event:'exit',kind:k,pid:child.pid,code,signal}));\n  child.once('close',(code,signal)=>log({event:'close',kind:k,pid:child.pid,code,signal}));\n  let high04KillClock=null;const _kill=child.kill;child.kill=function(signal){log({event:'kill',kind:k,pid:child.pid,signal});if(signal==='SIGKILL')high04KillClock=_now();return _kill.call(this,signal);};\n  if(k==='provider')child.on('message',message=>log({event:'ipc-received',pid:child.pid,message}));\n  if(k==='provider'){\n   // Only the true runtime registration is faulted; native observers above stay independent.\n   const originalOnce=child.once,originalEmit=child.emit;\n   const ids=new WeakMap();let serial=0,registrations=0,receipts=0,deliveries=0;\n   const ident=x=>{if(!ids.has(x))ids.set(x,++serial);return ids.get(x);};\n   const need=x=>{if(!x)throw Error('HIGH04 close-delivery integrity STOP');};\n   child.once=function(event,callback){\n    const stack=new Error().stack||'';\n    if(event!=='close')return originalOnce.call(this,event,callback);\n    need(this===child&&stack.includes(process.env.F1_SOURCE+':57:')&&++registrations===1);\n    need(process.env.F1_SOURCE_HASH==='da554968404af6c9953f86820143095879dd135f2b6f6fe7089f79be8777cb84');\n    need(require('node:crypto').createHash('sha256').update(fs.readFileSync(process.env.F1_SOURCE)).digest('hex')===process.env.F1_SOURCE_HASH);\n    const runtimeCallback=callback,childId=ident(child),callbackId=ident(callback),onceId=ident(originalOnce);\n    child.once=originalOnce;\n    log({event:'delivery-registration',kind:k,pid:child.pid,stack,childId,callbackId,onceId,onceRestored:child.once===originalOnce,emitUnchanged:child.emit===originalEmit});\n    return originalOnce.call(child,'close',function(...nativeArgs){\n     const killClock=high04KillClock;\n     need(this===child&&++receipts===1&&killClock!==null&&child.emit===originalEmit&&child.once===originalOnce);\n     need(nativeArgs[0]===null&&nativeArgs[1]==='SIGKILL');\n     log({event:'delivery-native-receipt',kind:k,pid:child.pid,childId,callbackId,onceId,code:nativeArgs[0],signal:nativeArgs[1],killClock,emitUnchanged:true,onceRestored:true});\n     if(mode==='high04-close-missing'){\n      log({event:'delivery-withheld',kind:k,pid:child.pid,childId,callbackId,receipts,deliveries});\n      return;\n     }\n     const target=killClock+2200,sampledClock=_now(),ms=Math.max(0,target-sampledClock);\n     log({event:'delivery-timer',kind:k,pid:child.pid,target,sampledClock,ms,killClock});\n     _setTimeout(function(){\n      need(++deliveries===1&&receipts===1&&runtimeCallback===callback&&ident(child)===childId&&ident(runtimeCallback)===callbackId&&child.emit===originalEmit);\n      const result=runtimeCallback.apply(child,nativeArgs);\n      // Completion of the actual callback, not a timestamp-shifted native close record.\n      log({event:'runtime-close-delivery',kind:k,pid:child.pid,childId,callbackId,onceId,code:nativeArgs[0],signal:nativeArgs[1],killClock,target,receiverSame:true,callbackSame:true,argsSame:true,emitUnchanged:true,resultUndefined:result===undefined});\n     },ms);\n    });\n   };\n  }\n  return child;\n };\n const _cerr=console.error;console.error=function(...args){log({event:String(args[0]).startsWith('[e2e] FAIL')?'fail-invocation':'stderr-log',msg:String(args[0])});return _cerr.apply(this,args);};\n const _write=process.stderr.write;process.stderr.write=function(...args){log({event:'stderr-write',text:String(args[0])});return _write.apply(this,args);};\n}else if(kind==='provider'){\n const fixtureIgnoreTerm=()=>log({event:'ignored-term'});\n if(['ignore-term','high04-close-late','high04-close-missing'].includes(mode))process.on('SIGTERM',fixtureIgnoreTerm);\n const listen=net.Server.prototype.listen;\n net.Server.prototype.listen=function(...args){this.once('listening',()=>{\n  log({event:'actual-bound',address:this.address()});\n\n });\n if(mode.startsWith('readiness-')){setTimeout(()=>listen.apply(this,args),3500);return this;}\n return listen.apply(this,args);};\n const emit=http.Server.prototype.emit;\n http.Server.prototype.emit=function(event,...args){if(event==='request'&&mode.startsWith('readiness-')){log({event:'hung-request'});return true;}return emit.call(this,event,...args);};\n const send=process.send?.bind(process);\n if(send)process.send=function(message,...args){\n  if(['ignore-term','high04-close-late','high04-close-missing'].includes(mode)&&message?.type==='provider-bound'){\n   for(const listener of process.listeners('SIGTERM'))if(listener!==fixtureIgnoreTerm)process.removeListener('SIGTERM',listener);\n   log({event:'fixture-term-ready',kind:'provider',pid:process.pid,listenerCount:process.listeners('SIGTERM').length,ownsFixtureIgnoreTerm:process.listeners('SIGTERM').includes(fixtureIgnoreTerm)});\n  }\n  log({event:'ipc',kind:'provider',message});\n  return send(['ignore-term','high04-close-late','high04-close-missing'].includes(mode)?{...message,pid:process.pid+10000}:message,...args);\n };\n}else if(kind==='consumer'){log({event:'consumer-process-start'});}\nrequire('node:module').syncBuiltinESMExports();\n";
test('HIGH04 H04-11: owner-addendum real close delivery missing is EXPECTED_RED',{timeout:25000},async()=>{
 await high04DeliveryProof('high04-close-missing',high04_close_missing,'b3adfe57a104c9e0b2debe78d4bf36559cdf1dbbae05dfa909c38e217ad2f696');
});
