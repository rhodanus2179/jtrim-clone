import assert from 'node:assert/strict';
import fs from 'node:fs';
const c=JSON.parse(fs.readFileSync(new URL('../docs/heic-security-build-candidate.json',import.meta.url)));
assert.equal(c.status,'EXPERIMENTAL_NOT_FOR_DISTRIBUTION');
assert.equal(c.wasmSha256,null);assert.equal(c.runtimeVerified,false);
assert.equal(c.legalDistributionApproved,false);
for(const name of ['libheif','libde265']) {
 const s=c.sourcePins.find(x=>x.name===name);
 assert.match(s.sha,/^[a-f0-9]{40}$/);
}
assert.equal(c.sourcePins.find(x=>x.name==='libheif').version,'1.23.6');
assert.equal(c.sourcePins.find(x=>x.name==='libde265').version,'1.1.3');
const bash=fs.readFileSync(new URL('../tools/heic/build-updated-wasm.sh',import.meta.url),'utf8');
assert.match(bash,/emcmake cmake/);assert.match(bash,/libde265\.a/);
console.log('Candidate version pins and release hold verified');
