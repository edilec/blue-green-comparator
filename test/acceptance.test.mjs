import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {compareSlots,TOOL_ID,LIMITS} from '../src/index.mjs';
const policy=()=>({schemaVersion:'1',expectedDifferences:['/slotId']});
const snapshot=(slotId='blue')=>({schemaVersion:'1',complete:true,slotId,artifactVersion:'1.2.3',configSchema:'v2',databaseSchema:'schema-1',dependencies:[{name:'cache',version:'1.0.0'},{name:'queue',version:'2.0.0'}],migrations:[{id:'001',checksum:'abc'},{id:'002',checksum:'def'}]});
test('identical parity with explicitly excluded slot IDs passes',()=>{
  const r=compareSlots(policy(),snapshot('blue'),snapshot('green'),{now:()=>0});assert.equal(TOOL_ID,'blue-green-comparator');assert.equal(r.status,'pass');assert.equal(r.summary.checked,1);assert.deepEqual(r.excluded,['/slotId']);assert.deepEqual(r.findings,[]);
});
test('database schema mismatch fails and cannot be policy-excluded',()=>{
  const g=snapshot('green');g.databaseSchema='schema-2';let r=compareSlots(policy(),snapshot(),g,{now:()=>0});assert.equal(r.status,'fail');assert.equal(r.findings[0].ruleId,'database-schema-mismatch');assert.doesNotMatch(JSON.stringify(r),/schema-2/);
  const p=policy();p.expectedDifferences.push('/databaseSchema');r=compareSlots(p,snapshot(),g,{now:()=>0});assert.equal(r.status,'incomplete');assert.equal(r.findings[0].ruleId,'policy-invalid');
});
test('artifact, config, dependency, and migration drift fail',()=>{
  for(const [mutate,rule] of [
    [x=>{x.artifactVersion='2.0.0';},'artifact-mismatch'],[x=>{x.configSchema='v3';},'config-schema-mismatch'],[x=>{x.dependencies[0].version='2.0.0';},'dependency-mismatch'],[x=>{x.migrations[0].checksum='changed';},'migration-mismatch']]){
    const g=snapshot('green');mutate(g);const r=compareSlots(policy(),snapshot(),g,{now:()=>0});assert.equal(r.status,'fail');assert.ok(r.findings.some(x=>x.ruleId===rule),rule);
  }
});
test('partial or missing evidence on either side is incomplete, not assumed absent',()=>{
  for(const side of ['blue','green']){
    let b=snapshot(),g=snapshot('green');(side==='blue'?b:g).complete=false;assert.equal(compareSlots(policy(),b,g,{now:()=>0}).status,'incomplete');
    b=snapshot();g=snapshot('green');delete (side==='blue'?b:g).databaseSchema;assert.equal(compareSlots(policy(),b,g,{now:()=>0}).status,'incomplete');
  }
});
test('array ordering is irrelevant; duplicate semantic records and unknown fields are incomplete',()=>{
  const g=snapshot('green');g.dependencies.reverse();g.migrations.reverse();assert.equal(compareSlots(policy(),snapshot(),g,{now:()=>0}).status,'pass');g.dependencies.push({...g.dependencies[0]});assert.equal(compareSlots(policy(),snapshot(),g,{now:()=>0}).status,'incomplete');g.dependencies.pop();g.effectiveSchema='private-mode';const r=compareSlots(policy(),snapshot(),g,{now:()=>0});assert.equal(r.status,'incomplete');assert.doesNotMatch(JSON.stringify(r),/private-mode/);
});
test('record and depth bounds accept N and refuse N+1; deadline is enforced',()=>{
  for(const [key,create] of [['dependencies',i=>({name:`d${i}`,version:'1'})],['migrations',i=>({id:`m${i}`,checksum:'a'})]]){
    const b=snapshot(),g=snapshot('green');b[key]=Array.from({length:LIMITS.records},(_,i)=>create(i));g[key]=structuredClone(b[key]);assert.equal(compareSlots(policy(),b,g,{now:()=>0}).status,'pass');g[key].push(create(LIMITS.records));assert.equal(compareSlots(policy(),b,g,{now:()=>0}).findings[0].ruleId,'record-limit');
  }
  const b=snapshot(),g=snapshot('green');b.metadata={};let x=b.metadata;for(let i=1;i<LIMITS.depth;i++){x.next={};x=x.next;}assert.equal(compareSlots(policy(),b,g,{now:()=>0}).status,'pass');x.next={};assert.equal(compareSlots(policy(),b,g,{now:()=>0}).findings[0].ruleId,'depth-limit');
  const clock=n=>{let first=true;return()=>{if(first){first=false;return 0;}return n;};};assert.equal(compareSlots(policy(),snapshot(),snapshot('green'),{now:clock(5000)}).status,'pass');assert.equal(compareSlots(policy(),snapshot(),snapshot('green'),{now:clock(5001)}).findings[0].ruleId,'time-limit');
});
test('policy depth accepts N and rejects N+1',()=>{
  const p=policy();p.metadata={};let x=p.metadata;for(let i=1;i<LIMITS.depth;i++){x.next={};x=x.next;}assert.equal(compareSlots(p,snapshot(),snapshot('green'),{now:()=>0}).status,'pass');x.next={};assert.equal(compareSlots(p,snapshot(),snapshot('green'),{now:()=>0}).findings[0].ruleId,'depth-limit');
});
const cli=args=>spawnSync(process.execPath,['bin/blue-green-comparator.mjs',...args],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8'});
const fixture=run=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'slots-'));try{return run(root);}finally{fs.rmSync(root,{recursive:true,force:true});}};
test('CLI good, duplicate decoded keys, invalid UTF-8, and confinement',()=>fixture(root=>{
  fs.writeFileSync(path.join(root,'policy.json'),JSON.stringify(policy()));fs.writeFileSync(path.join(root,'blue.json'),JSON.stringify(snapshot()));fs.writeFileSync(path.join(root,'green.json'),JSON.stringify(snapshot('green')));
  let r=cli(['--root',root,'--policy','policy.json','--blue','blue.json','--green','green.json']);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).status,'pass');
  fs.writeFileSync(path.join(root,'green.json'),'{"schemaVersion":"1","complete":false,"compl\\u0065te":true}');r=cli(['--root',root,'--policy','policy.json','--blue','blue.json','--green','green.json']);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).status,'incomplete');
  fs.writeFileSync(path.join(root,'policy.json'),'{"schemaVersion":"1","expectedDifferences":[],"expectedDifferences":["/slotId"]}');r=cli(['--root',root,'--policy','policy.json','--blue','blue.json','--green','green.json']);assert.equal(r.status,2);assert.equal(r.stdout,'');fs.writeFileSync(path.join(root,'policy.json'),JSON.stringify(policy()));
  fs.writeFileSync(path.join(root,'green.json'),Buffer.from([0xff]));r=cli(['--root',root,'--policy','policy.json','--blue','blue.json','--green','green.json']);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).status,'incomplete');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'slots-out-'));try{fs.writeFileSync(path.join(out,'g.json'),JSON.stringify(snapshot('green')));fs.symlinkSync(path.join(out,'g.json'),path.join(root,'escape.json'));r=cli(['--root',root,'--policy','policy.json','--blue','blue.json','--green','escape.json']);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).status,'incomplete');}finally{fs.rmSync(out,{recursive:true,force:true});}
}));
test('CLI policy and both snapshots accept exact byte limit and reject N+1',()=>fixture(root=>{
  for(const [name,value] of [['policy.json',policy()],['blue.json',snapshot()],['green.json',snapshot('green')]])fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  for(const [name,limit,value] of [['policy.json',LIMITS.policyBytes,policy()],['blue.json',LIMITS.blueBytes,snapshot()],['green.json',LIMITS.greenBytes,snapshot('green')]]){
    const raw=JSON.stringify(value);fs.writeFileSync(path.join(root,name),raw+' '.repeat(limit-Buffer.byteLength(raw)));
    let r=cli(['--root',root,'--policy','policy.json','--blue','blue.json','--green','green.json']);assert.equal(r.status,0,name);
    fs.appendFileSync(path.join(root,name),' ');r=cli(['--root',root,'--policy','policy.json','--blue','blue.json','--green','green.json']);assert.equal(r.status,2);assert.equal(name==='policy.json'?r.stdout:JSON.parse(r.stdout).findings[0].ruleId,name==='policy.json'?'':'byte-limit');fs.writeFileSync(path.join(root,name),raw);
  }
  const r=cli(['--root',path.join(root,'missing'),'--policy','policy.json','--blue','blue.json','--green','green.json']);assert.equal(r.status,2);assert.equal(r.stdout,'');
}));
