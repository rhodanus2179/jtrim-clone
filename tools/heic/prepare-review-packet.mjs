import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sourceFiles = [
  'sources/libheif-js/scripts/install.js',
  'sources/libheif-js/scripts/bundle.js',
  'sources/libheif-emscripten/.github/workflows/emscripten.yml',
  'sources/libheif/build-emscripten.sh',
  'sources/libheif/COPYING', 'sources/libde265/COPYING'
];
const licenseFiles = [
  'LGPL-3.0.txt','libheif-COPYING', 'libde265-COPYING', 'libheif-js-LICENSE'
];
const applicationFiles = [
  'index.html', 'README.md', 'js', 'css',
  'docs/third-party-notices.md', 'docs/heic-release-manifest.json',
  'tools/heic/rebuild-modified.sh', 'tools/heic/stage-review.sh',
  'tools/heic/prepare-review-packet.mjs'
];
const isInside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

export function prepareReviewPacket(stagePath, outputPath, {
  repoRoot = fileURLToPath(new URL('../../', import.meta.url)),
  manifest = JSON.parse(fs.readFileSync(new URL('../../docs/heic-release-manifest.json', import.meta.url), 'utf8'))
} = {}) {
  const root = fs.realpathSync(repoRoot);
  const stage = fs.realpathSync(stagePath);
  const output = path.resolve(outputPath);
  if (isInside(root, output) || isInside(stage, output) || isInside(output, stage) || isInside(output, root))
    throw Error('Review destination must be outside repository and input stage');
  if (fs.existsSync(output)) throw Error('Review destination already exists');
  if (manifest.distribution?.approved !== false) throw Error('Only unapproved review packets are permitted');
  const vendor = path.join(stage, 'vendor/libheif-bundle.mjs');
  for (const f of [...sourceFiles, ...licenseFiles.map(x => 'licenses/' + x), 'report/sources.tsv', 'vendor/libheif-bundle.mjs']) {
    if (!fs.statSync(path.join(stage, f), {throwIfNoEntry: false})?.isFile()) throw Error('Missing stage file: ' + f);
  }
  for (const f of applicationFiles) {
    if (!fs.existsSync(path.join(root, f))) throw Error('Missing application source: ' + f);
  }
  const expected = manifest.sources.map(s => [s.name, s.repo, s.sha].join('\t')).join('\n').trim();
  if (manifest.sources.length !== 4 || fs.readFileSync(path.join(stage, 'report/sources.tsv'), 'utf8').trim() !== expected)
    throw Error('Source pin list mismatch');
  for (const s of manifest.sources) {
    if (!/^[a-f0-9]{40}$/.test(s.sha) || !fs.statSync(path.join(stage,'sources',s.name),{throwIfNoEntry:false})?.isDirectory())
      throw Error('Missing or unpinned source tree: ' + s.name);
  }
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(vendor)).digest('hex');
  if (checksum !== manifest.bundle.sha256) throw Error('Vendor SHA-256 mismatch');

  fs.mkdirSync(output);
  fs.cpSync(path.join(stage, 'sources'), path.join(output, 'sources'), {recursive:true});
  fs.cpSync(path.join(stage, 'licenses'), path.join(output, 'licenses'), {recursive:true});
  fs.mkdirSync(path.join(output, 'vendor'));
  fs.copyFileSync(vendor, path.join(output, 'vendor/libheif-bundle.mjs'));
  fs.mkdirSync(path.join(output, 'provenance'));
  fs.copyFileSync(path.join(stage, 'report/sources.tsv'), path.join(output, 'provenance/sources.tsv'));
  for (const f of applicationFiles) fs.cpSync(path.join(root, f), path.join(output, 'application-source', f), {recursive:true});
  const index = {
    status: 'REVIEW_ONLY_NOT_AUTHORIZED_FOR_DISTRIBUTION', codec: 'libheif-js',
    version: manifest.npmVersion, vendorSha256: checksum, sources: manifest.sources,
    note: 'Technical evidence only. LGPL, HEVC patent, app license and real deployment review are pending.'
  };
  fs.writeFileSync(path.join(output, 'REVIEW-INDEX.json'), JSON.stringify(index, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'README.md'), '# Private HEIC review candidate\n\nNOT APPROVED FOR DISTRIBUTION. Do not upload or deploy. No personal photos are included. See REVIEW-INDEX.json.\n');
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw Error('Usage: node prepare-review-packet.mjs STAGED_DIR OUTSIDE_REPO_OUTPUT_DIR');
  const r = prepareReviewPacket(process.argv[2], process.argv[3]);
  console.log('Prepared PRIVATE HEIC review candidate:', r.status);
}
