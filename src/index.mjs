export const TOOL_ID='blue-green-comparator';
export const LIMITS=Object.freeze({policyBytes:65536,blueBytes:524288,greenBytes:524288,records:1000,depth:16,milliseconds:5000});
const SEVERITY=Object.freeze({'input-unreadable':'warning','input-invalid':'warning','export-incomplete':'warning','byte-limit':'warning','record-limit':'warning','depth-limit':'warning','time-limit':'warning','policy-invalid':'warning','snapshot-invalid':'warning','duplicate-record':'warning','slot-mismatch':'error','artifact-mismatch':'error','config-schema-mismatch':'error','database-schema-mismatch':'error','dependency-mismatch':'error','migration-mismatch':'error'});
const MESSAGE=Object.freeze({'input-unreadable':'Input could not be read, decoded, or parsed.','input-invalid':'Policy or snapshot structure is invalid.','export-incomplete':'Snapshot does not assert complete coverage.','byte-limit':'Input exceeds its declared byte limit.','record-limit':'Dependency or migration count exceeds its limit.','depth-limit':'JSON nesting exceeds depth 16.','time-limit':'Evaluation exceeded 5000 milliseconds.','policy-invalid':'Expected difference is not in the allowed scope.','snapshot-invalid':'Required snapshot field or record is unusable.','duplicate-record':'Dependency or migration identity is duplicated.','slot-mismatch':'Slot IDs differ without an explicit exclusion.','artifact-mismatch':'Artifact versions differ.','config-schema-mismatch':'Configuration schemas differ.','database-schema-mismatch':'Database schemas differ.','dependency-mismatch':'Dependency names or versions differ.','migration-mismatch':'Migration identities or checksums differ.'});
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safe=(x,max=128)=>typeof x==='string'&&x.length>0&&x.length<=max&&x.trim().length>0&&!/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\p{Cf}]/u.test(x);
const keysOnly=(x,keys)=>Object.keys(x).every(k=>keys.includes(k));
function finding(ruleId,file,pointer=''){return {ruleId,severity:SEVERITY[ruleId],message:MESSAGE[ruleId],location:{file,pointer}};}
function report(findings,excluded=[],checked=0){findings.sort((a,b)=>cmp(a.location.file,b.location.file)||cmp(a.location.pointer,b.location.pointer)||cmp(a.ruleId,b.ruleId));const status=findings.some(x=>x.severity==='warning')?'incomplete':findings.some(x=>x.severity==='error')?'fail':'pass';return {schemaVersion:'1',tool:TOOL_ID,status,summary:{checked,errors:findings.filter(x=>x.severity==='error').length,warnings:findings.filter(x=>x.severity==='warning').length},excluded,findings};}
export function incomplete(ruleId,file){return report([finding(ruleId,file)]);}
function tooDeep(value){const stack=[[value,0]];while(stack.length){const [item,depth]=stack.pop();if(depth>LIMITS.depth)return true;if(item&&typeof item==='object')for(const child of Object.values(item))stack.push([child,depth+1]);}return false;}
function index(records,field,file,findings,timed){const result=new Map();for(const [i,item] of records.entries()){if(timed()){findings.push(finding('time-limit',file));return null;}const pointer=`/${field}/${i}`;if(!object(item)||!keysOnly(item,field==='dependencies'?['name','version']:['id','checksum'])||!safe(field==='dependencies'?item.name:item.id)||!safe(field==='dependencies'?item.version:item.checksum)){findings.push(finding('snapshot-invalid',file,pointer));continue;}const key=field==='dependencies'?item.name:item.id;if(result.has(key)){findings.push(finding('duplicate-record',file,pointer));continue;}result.set(key,field==='dependencies'?item.version:item.checksum);}return result;}
export function compareSlots(policy,blue,green,{now=()=>performance.now()}={}){
  const start=now(),timed=()=>now()-start>LIMITS.milliseconds,findings=[];
  for(const [file,value] of [['@policy',policy],['@blue',blue],['@green',green]])if(tooDeep(value))findings.push(finding('depth-limit',file));
  if(findings.length)return report(findings);
  if(!object(policy)||!keysOnly(policy,['schemaVersion','expectedDifferences','metadata'])||policy.schemaVersion!=='1'||!Array.isArray(policy.expectedDifferences)){findings.push(finding('policy-invalid','@policy'));return report(findings);}
  if(policy.expectedDifferences.length>1||policy.expectedDifferences.some(x=>x!=='/slotId')){findings.push(finding('policy-invalid','@policy','/expectedDifferences'));return report(findings);}
  const excluded=[...policy.expectedDifferences];
  for(const [file,value] of [['@blue',blue],['@green',green]]){
    if(!object(value)||!keysOnly(value,['schemaVersion','complete','slotId','artifactVersion','configSchema','databaseSchema','dependencies','migrations','metadata'])||value.schemaVersion!=='1'||!Array.isArray(value.dependencies)||!Array.isArray(value.migrations)){findings.push(finding('input-invalid',file));continue;}
    if(value.complete!==true)findings.push(finding('export-incomplete',file,'/complete'));
    for(const key of ['slotId','artifactVersion','configSchema','databaseSchema'])if(!safe(value[key]))findings.push(finding('snapshot-invalid',file,`/${key}`));
    for(const key of ['dependencies','migrations'])if(value[key].length>LIMITS.records)findings.push(finding('record-limit',file,`/${key}`));
  }
  if(findings.length)return report(findings,excluded);
  const bdep=index(blue.dependencies,'dependencies','@blue',findings,timed),gdep=index(green.dependencies,'dependencies','@green',findings,timed),bmig=index(blue.migrations,'migrations','@blue',findings,timed),gmig=index(green.migrations,'migrations','@green',findings,timed);
  if(findings.length)return report(findings,excluded);
  if(!excluded.includes('/slotId')&&blue.slotId!==green.slotId)findings.push(finding('slot-mismatch','@green','/slotId'));
  for(const [key,rule] of [['artifactVersion','artifact-mismatch'],['configSchema','config-schema-mismatch'],['databaseSchema','database-schema-mismatch']])if(blue[key]!==green[key])findings.push(finding(rule,'@green',`/${key}`));
  for(const [field,a,b,rule] of [['dependencies',bdep,gdep,'dependency-mismatch'],['migrations',bmig,gmig,'migration-mismatch']]){
    const keys=new Set([...a.keys(),...b.keys()]);
    for(const key of [...keys].sort(cmp)){
      if(timed())return incomplete('time-limit','@green');
      if(!a.has(key)||!b.has(key)||a.get(key)!==b.get(key)){findings.push(finding(rule,'@green',`/${field}`));break;}
    }
  }
  if(timed())return incomplete('time-limit','@green');
  return report(findings,excluded,1);
}
