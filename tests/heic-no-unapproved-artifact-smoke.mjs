import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const workflows=[
  ".github/workflows/heic-wasm-validation.yml",
  ".github/workflows/heic-security-rebuild.yml",
  ".github/workflows/heic-source-audit.yml",
  ".github/workflows/heic-p5-qualification.yml",
  ".github/workflows/heic-p6-rebuild.yml"
];
for(const workflow of workflows){
  const content=fs.readFileSync(path.resolve(workflow),"utf8");
  assert.doesNotMatch(content,/actions\/upload-artifact\s*@/i,
    workflow+" must not upload unapproved HEIC codecs/artifacts");
  assert.doesNotMatch(content,/gh\s+release\s+(create|upload)/i,
    workflow+" must not publish an unapproved codec release");
}
console.log("No HEIC test workflow is configured to upload unapproved WASM artifacts");
