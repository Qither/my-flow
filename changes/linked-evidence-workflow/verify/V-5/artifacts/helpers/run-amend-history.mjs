import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fixture,workspace,childEnv} from './candidate-env.mjs';
const f=fixture(), normal=p=>resolve(p).toLowerCase();
const host=['claude','codex'].find(h=>normal(workspace(h))===normal(process.cwd()));
if(!host || process.env.MY_FLOW_SESSION_ID!==f.sessions[host]) throw new Error('Run this only in the original native candidate session/workspace');
const info=JSON.parse(readFileSync(join(process.cwd(),'.my-flow/amend-history-setup.json'),'utf8'));
if(normal(info.original)!==normal(process.cwd())||normal(info.cwd)!==normal(join(process.cwd(),'.my-flow/amend-history'))) throw new Error('History setup escapes this original workspace');
if(info.phase!=='baseline-recorded') throw new Error('A real independent baseline must be recorded first');
if(f.candidateDigest!==info.candidateBuild) throw new Error('Candidate changed after history fixture preparation');
const root=info.cwd, change=join(root,'changes/amend'), log=join(root,'.my-flow/history-run');mkdirSync(log,{recursive:true});
const env=childEnv(host), sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const optional=p=>existsSync(p)?read(p):null;
const put=(name,value)=>{const p=join(log,name);writeFileSync(p,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');return p;};
function spec(label,args,allowed=[0]){
 const r=spawnSync(process.execPath,[join(f.runtimePlugin,'scripts/spec.mjs'),...args],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:120000});
 put(label+'.stdout.txt',r.stdout??'');put(label+'.stderr.txt',r.stderr??'');
 appendFileSync(join(log,'commands.jsonl'),JSON.stringify({at:new Date().toISOString(),label,args,cwd:root,session:env.MY_FLOW_SESSION_ID,status:r.status,error:r.error?.message??null})+'\n');
 if(!allowed.includes(r.status)) throw new Error(label+': '+(r.stderr||r.error?.message||r.stdout));
 return r;
}
const packet=label=>JSON.parse(spec(label,['context','amend','--json']).stdout).packet;
function evidenceUnchanged(){for(const e of info.evidenceFiles) if(sha(readFileSync(join(root,e.path)))!==e.hash) throw new Error('Old V-1 changed: '+e.path);}
function taskBlocks(){return readFileSync(join(change,'tasks.md'),'utf8').split(/(?=^- \[)/m);}
function capture(label){
 const p=packet(label+'-context');
 const value={at:new Date().toISOString(),contractDigest:p.inputs.contractDigest,tasks:readFileSync(join(change,'tasks.md'),'utf8'),acceptance:readFileSync(join(change,'acceptance.md'),'utf8'),state:optional(join(change,'amendments/A-1/state.json'))};
 evidenceUnchanged();put(label+'.json',value);return value;
}
const existingState=optional(join(change,'amendments/A-1/state.json'));
if(existingState&&!['pending','applied'].includes(existingState.state)) throw new Error('History amendment cannot resume from '+existingState.state);
if(existingState?.state!=='applied'){
 if(packet('precheck').inputs.contractDigest!==info.oldDigest) throw new Error('Old contract drift');
 if(!existingState){
 let blocks=taskBlocks();
 blocks=blocks.map(block=>{
  if(!/  - id: T-0[13](?:\n|$)/.test(block)) return block;
  if(block.includes('  - id: T-03')) block=block.replace(/^- \[ \]/,'- [x]');
  if(!block.includes('  - evidence: V-1')) block=block.replace(/(  - id: T-0[13]\n)/,'$1  - evidence: V-1\n');
  return block;
 });
 writeFileSync(join(change,'tasks.md'),blocks.join(''));
 if(capture('before').contractDigest!==info.oldDigest) throw new Error('Bookkeeping moved contract digest');
 } else {
  const pendingBlocks=taskBlocks();
  const heldA=pendingBlocks.find(b=>b.includes('  - id: T-01'));
  const heldB=pendingBlocks.find(b=>b.includes('  - id: T-02'));
  const unaffected=pendingBlocks.find(b=>b.includes('  - id: T-03'));
  if(!heldA?.startsWith('- [ ]')||!heldB?.startsWith('- [ ]')||!heldA.includes('amendment A-1 pending')||!heldB.includes('amendment A-1 pending')) throw new Error('Pending hold state changed');
  // Propose keeps the old contract/link while held; apply removes affected evidence links.
  if(!heldA.includes('  - evidence: V-1')||heldB.includes('  - evidence:')||!unaffected?.startsWith('- [x]')||!unaffected.includes('  - evidence: V-1')) throw new Error('Pending old evidence or unaffected C changed');
 }
 const originalFinding=read(join(info.original,'changes/amend/findings/F-1.json'));
 for(let i=0;i<originalFinding.attempts.length;i++){
  const a=originalFinding.attempts[i], now=optional(join(change,'findings/F-1.json'));
  if(now?.attempts.some(t=>t.approach===a.approach)) continue;
  const file=put('finding-'+i+'.json',{id:'F-1',cause:originalFinding.cause,tasks:originalFinding.tasks,trustBoundaryChanged:originalFinding.trustBoundaryChanged,attempt:{approach:a.approach,outcome:a.outcome,evidenceRef:a.evidenceRef}});
  spec('finding-'+i,['finding','record','amend','--file',file],[0,1]);
  if(optional(join(change,'findings/F-1.json'))?.attempts.length!==i+1) throw new Error('Finding was not recorded');
 }
 const originalReviews=readdirSync(join(info.original,'changes/amend/reviews')).map(id=>read(join(info.original,'changes/amend/reviews',id,'review.json')));
 const design=originalReviews.find(r=>r.id===originalFinding.resolvedBy);
 const critic=originalReviews.find(r=>r.role==='critic'&&r.amendment==='A-1'&&r.contractDigest===info.candidateDigest);
 if(!design||!critic) throw new Error('Exact original independent reviews are unavailable');
 put('reused-review-provenance.json',{note:'Existing judgments reused against identical contract and candidate; no new role call is claimed.',design,critic});
 function reuseReview(review,amendment=false){
  const existing=optional(join(change,'reviews',review.id,'review.json'));
  if(existing){if(existing.actorId!==review.actorId||existing.sourceRef!==review.sourceRef||existing.contractDigest!==review.contractDigest) throw new Error('Review identity changed');return;}
  const file=put('reuse-'+review.id+'.json',review);
  spec('review-'+review.id,['review','record','amend',...(amendment?['--amend','A-1']:[]),'--file',file]);
 }
 reuseReview(design);
 if(!read(join(change,'findings/F-1.json')).resolvedBy) spec('resolve',['finding','resolve','amend','--id','F-1','--review',design.id,'--remedy',originalFinding.remedy]);
 if(!existsSync(join(change,'amendments/A-1/state.json'))){
  const original=read(join(info.original,'changes/amend/amendments/A-1/candidate.json'));
  if(original.files.length!==1||original.files[0]!=='changes/amend/acceptance.md') throw new Error('Supplement must only change the originally reviewed acceptance file');
  const files=Object.fromEntries(original.files.map(path=>[path,readFileSync(join(info.original,'changes/amend/amendments/A-1/candidate',path.slice('changes/amend/'.length).replaceAll('/','__')),'utf8')]));
  const file=put('candidate-input.json',{id:'A-1',type:original.type,cause:original.cause,findingId:'F-1',oldDigest:info.oldDigest,changed:original.changed,files,authority:original.authority});
  spec('propose',['amend','propose','amend','--file',file]);
 }
 const staged=read(join(change,'amendments/A-1/candidate.json'));
 if(staged.candidateDigest!==info.candidateDigest) throw new Error('Original equivalence review does not cover this candidate');
 const pending=capture('pending');
 if(pending.contractDigest!==info.oldDigest) throw new Error('Pending candidate replaced canonical contract');
 for(const name of ['source/a.mjs','test/amend-a.test.mjs','scripts/check-a.mjs']) if(sha(readFileSync(join(root,name)))!==sha(readFileSync(join(info.original,name)))) throw new Error('Reviewed input changed: '+name);
 reuseReview(critic,true);
 spec('apply',['amend','apply','amend','--id','A-1']);
}
const after=capture('after');
if(after.contractDigest!==info.candidateDigest) throw new Error('Applied contract digest differs');
const blocks=taskBlocks(), a=blocks.find(b=>b.includes('  - id: T-01')), b=blocks.find(b=>b.includes('  - id: T-02')), c=blocks.find(b=>b.includes('  - id: T-03'));
if(!a?.startsWith('- [ ]')||!b?.startsWith('- [ ]')||a.includes('  - evidence:')||b.includes('  - evidence:')) throw new Error('Affected tasks or evidence links not reopened');
if(!c?.startsWith('- [x]')||!c.includes('  - evidence: V-1')) throw new Error('Unaffected C evidence was lost');
const {archivePreflight}=await import(pathToFileURL(join(f.runtimePlugin,'scripts/lib/archive.mjs')));
const {withIntentSnapshot}=await import(pathToFileURL(join(f.runtimePlugin,'scripts/lib/intent-io.mjs')));
const archive=withIntentSnapshot(root,()=>archivePreflight(root,{dir:change,rel:'changes/amend',slug:'amend',schemaVersion:2}));
put('archive-preflight.json',archive);
if(!archive.blockers?.some(x=>x.code==='contract-drift')) throw new Error('Old PASS was not rejected for the changed contract');
const old=readFileSync(join(change,'verify/V-1/contract/changes__amend__acceptance.md'),'utf8');
if(!old.includes('node --test test/amend-a.test.mjs')||!after.acceptance.includes('node scripts/check-a.mjs')) throw new Error('Historical/current checks are not distinct');
evidenceUnchanged();
const result={verdict:'HISTORY_INVALIDATION_VERIFIED',host,oldDigest:info.oldDigest,currentDigest:after.contractDigest,oldEvidenceFilesPreserved:info.evidenceFiles.length,affectedEvidenceRemoved:['T-01'],affectedWithoutPriorEvidence:['T-02'],unaffectedEvidenceRetained:'T-03 -> V-1',archiveBlockers:archive.blockers.map(x=>x.code),scope:'Only missing history condition; original native runs prove role ordering and pending-C behavior.',logs:log};
put('result.json',result);console.log(JSON.stringify(result,null,2));
