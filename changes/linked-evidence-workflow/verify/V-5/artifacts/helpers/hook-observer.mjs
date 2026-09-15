import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, FIX } from './candidate-env.mjs';
import { readStdin } from './candidate-plugin/hooks/lib/stdin.mjs';
export async function observe(host,kind) {
  if(!['claude','codex'].includes(host)||!['session-context','completion-guard'].includes(kind)) throw new Error('Unknown hook');
  const raw=await readStdin();
  let payload={};try {payload=JSON.parse(raw);} catch {}
  const script=join(fixture().plugin,'hooks',kind+'.mjs');
  const result=spawnSync(process.execPath,[script],{cwd:process.cwd(),env:process.env,input:raw,encoding:'utf8',windowsHide:true});
  try {
    appendFileSync(join(FIX,'observations','hook-events.jsonl'),JSON.stringify({at:new Date().toISOString(),host,kind,
      source:process.env.MY_FLOW_OBSERVATION_SOURCE??'unattested',cwd:payload.cwd??null,session_id:payload.session_id??null,
      guardOutput:result.stdout??'',exitCode:result.status})+'\n');
  } catch { process.stderr.write('Fixture hook observer could not save evidence.\n'); }
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
  process.exitCode=result.status??1;
}
