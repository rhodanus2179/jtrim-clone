import assert from 'node:assert/strict';
import {createHeifWorkQueue} from '../js/worker/heif-work-queue.js';
const waits=[],output=[];
let active=0,maxActive=0;
function defer(){let done;return {promise:new Promise(r=>done=r),done:()=>done()};}
const queue=createHeifWorkQueue({
  decode:async buffer=>{
    active++;maxActive=Math.max(maxActive,active);
    const d=defer(); waits.push(d);
    try{
      await d.promise;
      if(new Uint8Array(buffer)[0]===2) throw Object.assign(Error('bad image'),{code:'HEIF_DECODE_FAILED'});
      return {buffer:new Uint8Array([0,1,2,3]).buffer,width:1,height:1};
    } finally{active--;}
  },
  post:(value,transfers=[])=>output.push({value,transfers})
});
const input=n=>({id:n,operation:'heif-decode',buffer:new Uint8Array([n]).buffer});
const jobs=[1,2,3].map(n=>queue.enqueue(input(n)));
assert.equal(queue.queuedCount,3);
await Promise.resolve();
assert.equal(waits.length,1);
assert.equal(active,1);
waits[0].done();await jobs[0];await Promise.resolve();
assert.equal(waits.length,2);
waits[1].done();await jobs[1];await Promise.resolve();
assert.equal(waits.length,3);
waits[2].done();await jobs[2];
assert.deepEqual(output.map(x=>x.value.id),[1,2,3]);
assert.deepEqual(output.map(x=>x.value.ok),[true,false,true]);
assert.equal(output[0].transfers[0].byteLength,4);
assert.equal(output[1].value.error.code,'HEIF_DECODE_FAILED');
assert.equal(queue.queuedCount,0);
assert.equal(maxActive,1,'WASM decodes must be serialized');
await queue.enqueue({id:4,operation:'heif-decode',buffer:null});
assert.equal(output[3].value.error.code,'HEIF_INVALID_INPUT');
assert.equal(await queue.enqueue({id:5,operation:'other'}),false);
assert.equal(output.length,4);

let emits=0;
const resilient=createHeifWorkQueue({
  decode:async()=>({buffer:new ArrayBuffer(4)}),
  post:()=>{if(++emits===1)throw Error('postMessage failure');}
});
await assert.rejects(resilient.enqueue(input(6)),/postMessage failure/);
await resilient.enqueue(input(7));
assert.equal(emits,2,'Queue continues after one failed post');
assert.equal(resilient.queuedCount,0);
console.log('HEIC serialized worker queue tests passed');
