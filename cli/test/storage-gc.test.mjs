import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, utimes, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash} from '../src/file-workspace/files.mjs';
import {loadState,saveState,migrateStorage} from '../src/file-workspace/state.mjs';
import {collectGarbage} from '../src/file-workspace/gc.mjs';
import {discoverWorkspace,matchingProfile} from '../src/workspace-context.mjs';
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'edgeever-v4-'));await mkdir(join(root,'.edgeever'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
const legacy=body=>({version:3,url:'https://example.test',scope:{all:true,include:[],exclude:[],recursive:true},entries:{memo:{path:'note.md',base:body,serverBase:body,hash:hash(body),serverHash:hash(body)}}});
test('v3 migration keeps original index, deduplicates large baselines and loads only on access',()=>fixture(async root=>{
 const body='large document\n'.repeat(100000),old=legacy(body);const raw=JSON.stringify(old);await writeFile(join(root,'.edgeever/state.json'),raw);
 assert.equal((await migrateStorage(root,old,true)).status,'would-migrate');assert.equal(await readFile(join(root,'.edgeever/state.json'),'utf8'),raw);
 const result=await migrateStorage(root,old);assert.equal(await readFile(join(root,result.backup),'utf8'),raw);
 const index=await readFile(join(root,'.edgeever/state.json'),'utf8');assert.ok(index.length<1000);assert.ok(!index.includes('large document'));
 let loaded=await loadState(root);assert.equal(loaded.entries.memo.base,body);assert.equal(loaded.entries.memo.baseRef,loaded.entries.memo.serverBaseRef);
 await rm(join(root,'.edgeever/baselines',hash(body)+'.md'));loaded=await loadState(root);assert.throws(()=>loaded.entries.memo.base,/ENOENT/);
}));
test('corrupt baseline prevents migration commit; retry after repair preserves the old state',()=>fixture(async root=>{
 const old=legacy('baseline');await writeFile(join(root,'.edgeever/state.json'),JSON.stringify(old));await mkdir(join(root,'.edgeever/baselines'));await writeFile(join(root,'.edgeever/baselines',hash('baseline')+'.md'),'corrupt');
 await assert.rejects(migrateStorage(root,old),/corrupted/);assert.equal(JSON.parse(await readFile(join(root,'.edgeever/state.json'),'utf8')).version,3);
 await rm(join(root,'.edgeever/baselines',hash('baseline')+'.md'));await migrateStorage(root,await loadState(root));assert.equal((await loadState(root)).entries.memo.base,'baseline');
}));
test('GC preserves references, active conflicts, recent files and five histories; dry-run matches deletion',()=>fixture(async root=>{
 const s=legacy('needed');await writeFile(join(root,'.edgeever/state.json'),JSON.stringify(s));await migrateStorage(root,s);
 const now=Date.now(),old=new Date(now-40*86400000);
 async function put(path,text){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);await utimes(join(root,path),old,old);}
 const unused=`.edgeever/baselines/${hash('unused')}.md`;await put(unused,'unused');
 for(let i=0;i<7;i++)await put(`.edgeever/history/memo/${i}.md`,'backup');
 await put('.edgeever/conflicts/memo/active/merge.md','human work');await put('.edgeever/conflicts/memo/solved/merge.md','solved');
 s.conflicts={memo:{draft:'.edgeever/conflicts/memo/active/merge.md'}};
 const preview=await collectGarbage(root,s,{dryRun:true,now,maxBytes:1});assert.ok(preview.removed.includes(unused));assert.equal(preview.removed.filter(p=>p.includes('/history/')).length,2);assert.ok(!preview.removed.some(p=>p.includes('/active/')));assert.ok(preview.overBudget);
 assert.equal(await readFile(join(root,unused),'utf8'),'unused');const actual=await collectGarbage(root,s,{now});assert.deepEqual(actual.removed,preview.removed);assert.equal(s.entries.memo.base,'needed');
 await writeFile(join(root,'.edgeever/pending-move.json'),'{}');assert.equal((await collectGarbage(root,s)).status,'gc-deferred');
}));
test('workspace discovery ascends and profile matching rejects ambiguity without exposing credentials',()=>fixture(async root=>{
 await writeFile(join(root,'.edgeever/state.json'),JSON.stringify(legacy('x')));await mkdir(join(root,'sub/deep'),{recursive:true});assert.equal((await discoverWorkspace(join(root,'sub/deep'))).directory,root);
 const p={url:'https://example.test/',token:'hidden'};assert.equal(matchingProfile({profiles:{cloud:p}},'https://example.test'),'cloud');assert.throws(()=>matchingProfile({profiles:{a:p,b:p}},'https://example.test'),/Multiple profiles/);assert.throws(()=>matchingProfile({profiles:{}},'https://example.test'),/No authenticated/);
}));

test('GC refuses symlinks and protects history files referenced by active state',()=>fixture(async root=>{
 const s=legacy('body');await writeFile(join(root,'.edgeever/state.json'),JSON.stringify(s));await migrateStorage(root,s);
 await mkdir(join(root,'.edgeever/history/memo'),{recursive:true});const old=new Date(Date.now()-50*86400000);
 for(let i=0;i<7;i++){const path=join(root,`.edgeever/history/memo/${i}.md`);await writeFile(path,'x');await utimes(path,old,old);}
 s.resources={linked:{path:'.edgeever/history/memo/6.md'}};
 const preview=await collectGarbage(root,s,{dryRun:true,keep:1});assert.ok(!preview.removed.includes('.edgeever/history/memo/6.md'));
 await symlink(join(root,'.edgeever/state.json'),join(root,'.edgeever/history/link'));
 await assert.rejects(collectGarbage(root,s),/symlinks/);
}));
