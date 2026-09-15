import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
export const FIX = dirname(fileURLToPath(import.meta.url));
export const fixture = () => JSON.parse(readFileSync(join(FIX,'fixture.json'),'utf8'));
export const workspace = host => join(FIX,'workspaces',host);
export function childEnv(host, extra={}) {
  const f = fixture();
  if (!Object.hasOwn(f.sessions,host)) throw new Error('Unknown fixture host');
  const env = {...process.env, MY_FLOW_HOME:f.homes.myFlow, CODEX_HOME:f.homes.codex,
    CLAUDE_CONFIG_DIR:f.homes.claude, MY_FLOW_SCHTASKS:join(FIX,'scheduler-recorder.mjs'),
    MY_FLOW_SESSION_ID:f.sessions[host], ...extra};
  for (const key of ['MY_FLOW_HOME','CODEX_HOME','CLAUDE_CONFIG_DIR','MY_FLOW_SCHTASKS']) {
    const rel=relative(FIX,resolve(env[key]));
    if(!rel||rel.startsWith('..')||isAbsolute(rel)) throw new Error(`${key} escapes fixture`);
  }
  for(const key of Object.keys(env)) if(key.startsWith('NODE_TEST_')) delete env[key];
  return env;
}
export function run(host,label,cmd,args,{input,cwd=workspace(host),expected=0,extra={}}={}) {
  const env=childEnv(host,extra);
  const result=spawnSync(cmd,args,{cwd,env,input,encoding:'utf8',windowsHide:true,timeout:120000});
  const dir=join(FIX,'observations');mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,label+'.stdout.txt'),result.stdout??'');
  writeFileSync(join(dir,label+'.stderr.txt'),result.stderr??'');
  appendFileSync(join(dir,'commands.jsonl'),JSON.stringify({at:new Date().toISOString(),host,label,cmd,args,cwd,status:result.status,
    isolation:Object.fromEntries(['MY_FLOW_HOME','CODEX_HOME','CLAUDE_CONFIG_DIR','MY_FLOW_SCHTASKS','MY_FLOW_SESSION_ID'].map(key=>[key,env[key]]))})+'\n');
  if(result.status!==expected) throw new Error(`${label}: expected ${expected}, got ${result.status}: ${result.stderr}`);
  return result;
}
