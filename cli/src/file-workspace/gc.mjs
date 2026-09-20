import { readdir, stat, unlink, rmdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { safePath, read } from './files.mjs';

export async function collectGarbage(root, state, {dryRun=false, now=Date.now(), days=30, keep=5, maxBytes=null}={}) {
  if(!Number.isFinite(days)||days<1||!Number.isInteger(keep)||keep<1|| (maxBytes!==null&&(!Number.isFinite(maxBytes)||maxBytes<0))) throw Error('GC needs days >= 1, keep >= 1 and a nonnegative byte budget');
  for(const file of ['pending-move.json','migration-v3.json']) if(await read(root,`.edgeever/${file}`)) return {status:'gc-deferred',reason:'pending recovery',removed:[],bytes:0};
  const files=[];
  async function walk(path) {
    let entries;try{entries=await readdir(await safePath(root,path),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const entry of entries){
      const child=posix.join(path,entry.name);if(entry.isSymbolicLink())throw Error('GC refuses symlinks');
      if(entry.isDirectory())await walk(child);else if(entry.isFile()){const info=await stat(await safePath(root,child));files.push({path:child,size:info.size,mtime:info.mtimeMs});}
    }
  }
  for(const dir of ['baselines','history','conflicts','migrations'])await walk(`.edgeever/${dir}`);
  const refs=new Set(),protectedPaths=new Set();
  function mark(value){if(!value||typeof value!=='object')return;for(const [k,v] of Object.entries(value)){if(typeof v==='string'&&v.startsWith('.edgeever/'))protectedPaths.add(v);if(k.endsWith('Ref')&&typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))refs.add(v);else if(typeof v==='object')mark(v);}}
  mark(state); // Lazy baseline getters are nonenumerable: no full-library body reads.
  // Backups retained by policy must remain independently restorable. Mark all
  // backup indexes conservatively; newly unreachable blobs are reclaimed next run.
  for(const f of files.filter(f=>f.path.endsWith('.json'))) {
    let value;try{value=JSON.parse(await read(root,f.path));}catch{ return {status:'gc-deferred',reason:`unreadable recovery metadata: ${f.path}`,removed:[],bytes:0}; }
    mark(value);
  }
  const active=new Set(Object.values(state.conflicts||{}).map(c=>posix.dirname(c.draft)));
  const cutoff=now-days*86400000, eligible=new Set();
  const historyGroups=new Map();
  for(const f of files){
    if(f.path.startsWith('.edgeever/baselines/')){
      const name=posix.basename(f.path);if(/^[a-f0-9]{64}\.md$/.test(name)&&!refs.has(name.slice(0,-3))&&f.mtime<cutoff)eligible.add(f.path);
    }else if(f.path.startsWith('.edgeever/history/') && posix.dirname(f.path)!=='.edgeever/history/moves'){
      const group=posix.dirname(f.path);historyGroups.set(group,[...(historyGroups.get(group)||[]),f]);
    }
  }
  for(const group of historyGroups.values())for(const f of group.sort((a,b)=>b.mtime-a.mtime||a.path.localeCompare(b.path)).slice(keep))if(f.mtime<cutoff)eligible.add(f.path);
  // Never split a migration backup or a conflict snapshot set by file age.
  const groups=new Map();
  for(const f of files){
    const parts=f.path.split('/');
    if(parts[1]==='migrations'&&parts.length>=4 || parts[1]==='conflicts'&&parts.length>=5){
      const group=parts.slice(0,parts[1]==='migrations'?3:4).join('/');
      groups.set(group,[...(groups.get(group)||[]),f]);
    }
  }
  for(const [group,members] of groups)if(!active.has(group)&&members.every(f=>f.mtime<cutoff))for(const f of members)eligible.add(f.path);
  const removed=[];let bytes=0;
  for(const f of files.filter(f=>eligible.has(f.path)&&!protectedPaths.has(f.path))){
    if(!dryRun){const current=await stat(await safePath(root,f.path));if(current.mtimeMs!==f.mtime||current.size!==f.size)continue;await unlink(await safePath(root,f.path));}
    removed.push(f.path);bytes+=f.size;
  }
  if(!dryRun)for(const path of removed){let dir=posix.dirname(path);while(dir.split('/').length>2){try{await rmdir(await safePath(root,dir));}catch{break;}dir=posix.dirname(dir);}}
  const totalBytes=files.reduce((sum,f)=>sum+f.size,0),remainingBytes=totalBytes-bytes;
  return {status:dryRun?'gc-preview':'gc-complete',removed,bytes,totalBytes,remainingBytes,overBudget:maxBytes!==null&&remainingBytes>maxBytes,policy:{days,keep,maxBytes}};
}
