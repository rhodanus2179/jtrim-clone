import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCodecSecurityBlockers, isVersionAtLeast } from "../tools/heic/security-policy.mjs";
import { readHeicReleaseManifest, evaluateHeicRelease } from "../tools/heic/release-gate.mjs";
import { checkHeicDeployment } from "../tools/heic/block-unapproved-deployment.mjs";

const manifest = readHeicReleaseManifest();
assert.equal(manifest.build.libheif, "1.23.5");
assert.equal(manifest.build.libde265, "1.0.15");
assert.equal(isVersionAtLeast("1.0.15", "1.1.3"), false);
assert.equal(isVersionAtLeast("1.1.3", "1.1.3"), true);
assert.equal(isVersionAtLeast("1.23.6", "1.23.5"), true);
assert.equal(isVersionAtLeast("invalid", "1.1.3"), false);
assert.equal(getCodecSecurityBlockers(manifest).length, 2);
const blocked = evaluateHeicRelease(manifest);
assert.equal(blocked.ready, false);
assert.ok(blocked.blockers.some(x => x.includes("outdated HEIC codec libheif")));
assert.ok(blocked.blockers.some(x => x.includes("outdated HEIC codec libde265")));
assert.ok(blocked.blockers.some(x => x.includes("decoderSecurityAudit")));
const updatedVersionOnly = structuredClone(manifest);
updatedVersionOnly.build.libheif = "1.23.6";
updatedVersionOnly.build.libde265 = "1.1.3";
assert.deepEqual(getCodecSecurityBlockers(updatedVersionOnly), []);
assert.equal(evaluateHeicRelease(updatedVersionOnly).ready, false,
  "Updating version strings alone must never authorize release");
const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heic-no-unsafe-wasm-"));
try {
  assert.equal(checkHeicDeployment(fakeRoot, {manifest}).allowed, true);
  const dir = path.join(fakeRoot, "third_party/libheif-js");
  fs.mkdirSync(dir, {recursive:true});
  fs.writeFileSync(path.join(dir,"libheif-bundle.mjs"),"unapproved decoder");
  const flagged = checkHeicDeployment(fakeRoot, {manifest});
  assert.equal(flagged.allowed, false);
  assert.match(flagged.reason, /release review is incomplete/);
} finally {
  fs.rmSync(fakeRoot, {recursive:true,force:true});
}
console.log("HEIC copyright/patent/security deployment gate tests passed; unsafe vendor remains blocked");
