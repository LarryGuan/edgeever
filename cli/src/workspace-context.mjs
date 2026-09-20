import { dirname, resolve } from 'node:path';
import { read } from './file-workspace/files.mjs';

export async function discoverWorkspace(start = '.') {
  let directory=resolve(start);
  for(;;){
    const raw=await read(directory,'.edgeever/state.json');
    if(raw) {const state=JSON.parse(raw);if(!state.url||!state.entries)throw Error('Invalid workspace index');return {directory,url:state.url,version:state.version};}
    const parent=dirname(directory);if(parent===directory)throw Error('No linked workspace found; run workspace link first');directory=parent;
  }
}
export function matchingProfile(config, url) {
  const normalize=value=>String(value||'').replace(/\/+$/,'');
  const candidates=Object.entries(config.profiles||{}).filter(([,p])=>p.token&&normalize(p.url)===normalize(url)).map(([name])=>name);
  if(candidates.length!==1)throw Error(candidates.length ? `Multiple profiles match this workspace: ${candidates.join(', ')}; pass --profile` : 'No authenticated profile matches this workspace; configure one or pass --profile');
  return candidates[0];
}
export function summarizeSync(result) {
  const counts={};for(const item of result.results)counts[item.status]=(counts[item.status]||0)+1;
  const quiet=new Set(['clean','modified','untracked','pulled','pushed','moved','merged-local','directory-removed','would-pull','would-push','would-move','would-merge-local','would-merge-push','would-remove-directory']);
  return {counts,issues:result.results.filter(r=>!quiet.has(r.status))};
}
