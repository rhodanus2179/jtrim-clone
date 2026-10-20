import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareReviewPacket} from '../tools/heic/prepare-review-packet.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'heic-p7-'));
const stage = path.join(tmp,'stage');
const repo = path.join(tmp,'app');
const out = path.join(tmp,'out');
const sha = crypto.createHash('sha256').update('test-wasm').digest('hex');
const m = {distribution:{approved:false},npmVersion:'1.23.5',bundle:{sha256:sha}, sources:[
  ['libheif-js','catdad-experiments/libheif-js'],
  ['libheif-emscripten','catdad-experiments/libheif-emscripten'],
  ['libheif','strukturag/libheif'],
  ['libde265','strukturag/libde265']
].map(([name,repo])=>({name,repo,sha:'a'.repeat(40)}))};
function write(base, rel, txt='x') {const file=path.join(base,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,txt)}
try {
  write(stage,'vendor/libheif-bundle.mjs','test-wasm');
  write(stage,'report/sources.tsv',m.sources.map(s=>[s.name,s.repo,s.sha].join('\t')).join('\n')+'\n');
  for(const f of ['sources/libheif-js/scripts/install.js','sources/libheif-js/scripts/bundle.js',
    'sources/libheif-emscripten/.github/workflows/emscripten.yml','sources/libheif/build-emscripten.sh',
    'sources/libheif/COPYING','sources/libde265/COPYING',
    'licenses/LGPL-3.0.txt','licenses/libheif-COPYING','licenses/libde265-COPYING','licenses/libheif-js-LICENSE']) write(stage,f);
  for(const f of ['index.html','README.md','js/main.js','css/app.css','docs/third-party-notices.md',
    'docs/heic-release-manifest.json','tools/heic/rebuild-modified.sh','tools/heic/stage-review.sh',
    'tools/heic/prepare-review-packet.mjs']) write(repo,f);
  const info=prepareReviewPacket(stage,out,{repoRoot:repo,manifest:m});
  assert.equal(info.status,'REVIEW_ONLY_NOT_AUTHORIZED_FOR_DISTRIBUTION');
  assert.equal(info.vendorSha256,sha);
  assert.ok(fs.existsSync(path.join(out,'application-source/js/main.js')));
  assert.ok(fs.existsSync(path.join(out,'sources/libde265/COPYING')));
  assert.throws(()=>prepareReviewPacket(stage,out,{repoRoot:repo,manifest:m}),/already exists/);
  fs.rmSync(out,{recursive:true});
  const bad=structuredClone(m);bad.bundle.sha256='0'.repeat(64);
  assert.throws(()=>prepareReviewPacket(stage,out,{repoRoot:repo,manifest:bad}),/SHA-256/);
  assert.throws(()=>prepareReviewPacket(stage,path.join(repo,'wrong'),{repoRoot:repo,manifest:m}),/outside repository/);
  console.log('HEIC P7 review-packet smoke tests passed');
} finally {fs.rmSync(tmp,{recursive:true,force:true})}
