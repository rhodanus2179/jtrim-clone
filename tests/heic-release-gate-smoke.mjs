import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateHeicRelease, readHeicReleaseManifest } from "../tools/heic/release-gate.mjs";

const manifest = readHeicReleaseManifest();
const status = evaluateHeicRelease(manifest);
assert.equal(status.ready, false);
assert.ok(status.blockers.includes("named distribution approval absent"));
assert.ok(status.blockers.some(x => x.includes("HEVCPatentAssessment")));
assert.ok(status.blockers.includes("decoder binary is not present for final release verification"));
const clone = structuredClone(manifest);
clone.sources[0].sha = "bad";
assert.ok(evaluateHeicRelease(clone).blockers.includes("missing version-pinned corresponding source references"));
const clone2 = structuredClone(manifest);
clone2.distribution.approved = true;
clone2.distribution.reviewedBy = "x";
clone2.distribution.reviewedOn = "2026-10-20";
clone2.distribution.approvalRecord = "file:///not-accepted";
assert.equal(evaluateHeicRelease(clone2).ready,false, "an approval flag cannot bypass missing evidence");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"jtrim-heic-gate-"));
try {
  const bundle=path.join(dir,"bundle.mjs");
  fs.writeFileSync(bundle,"corrupt");
  assert.ok(evaluateHeicRelease(manifest,{vendorFile:bundle}).blockers.includes("decoder bundle checksum mismatch"));
} finally {fs.rmSync(dir,{recursive:true,force:true});}
console.log("HEIC release gate smoke tests passed; distribution remains on HOLD");
