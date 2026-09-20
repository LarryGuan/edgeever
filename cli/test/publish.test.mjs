import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateMemo } from '../src/publish.mjs';
import { validateRemoteBody } from '../src/file-workspace/metadata.mjs';
test('reject reserved metadata variants while preserving ordinary YAML and code examples',()=>{
 for(const body of ['---\nedgeever:\n  memo_id: PENDING\n---\nbody','\uFEFF---\r\n"edgeever": {memo_id: memo_real}\r\n---\r\nbody','---\nedgeever: null\n---\n','---\nedgeever:\nedgeever:\n---\n'])assert.throws(()=>validateRemoteBody(body));
 for(const body of ['---\ntitle: Keep me\n---\ntext','```yaml\nedgeever:\n  memo_id: PENDING\n```','plain edgeever: prose'])assert.doesNotThrow(()=>validateRemoteBody(body));
});
test('invalid update body causes zero network calls; guarded update preserves exact body',async()=>{
 const calls=[];const client={request:async(path,init)=>{calls.push({path,init});if(path.endsWith('edit-sessions'))return {editSession:{id:'session',baseRevision:2,baseContentHash:'hash'}};if(!init)return {memo:{revision:2,contentHash:'hash'}};return {ok:true};}};
 await assert.rejects(updateMemo(client,'memo_a',{contentMarkdown:'---\nedgeever: PENDING\n---\n'}),/workspace import/);assert.equal(calls.length,0);
 const body='---\ntitle: untouched\n---\nbody\r\n';await updateMemo(client,'memo_a',{contentMarkdown:body,title:'title'});
 assert.deepEqual(calls[2].init.body,{contentMarkdown:body,title:'title',expectedRevision:2,expectedContentHash:'hash',editSessionId:'session'});
});
test('session race and PATCH conflict do not retry or bypass protection',async()=>{
 let patches=0;
 const client={request:async(path,init)=>{if(path.endsWith('edit-sessions'))return {editSession:{id:'s',baseRevision:3,baseContentHash:'new'}};if(!init)return {memo:{revision:2,contentHash:'old'}};patches++;}};
 await assert.rejects(updateMemo(client,'memo',{contentMarkdown:'body'}),/Remote changed/);assert.equal(patches,0);
 const conflicting={request:async(path,init)=>{if(path.endsWith('edit-sessions'))return {editSession:{id:'s',baseRevision:2,baseContentHash:'old'}};if(!init)return {memo:{revision:2,contentHash:'old'}};patches++;throw Object.assign(Error('Conflict'),{status:409});}};
 await assert.rejects(updateMemo(conflicting,'memo',{contentMarkdown:'body'}),/Conflict/);assert.equal(patches,1);
});
