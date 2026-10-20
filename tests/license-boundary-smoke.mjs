import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateHeicRelease, readHeicReleaseManifest } from "../tools/heic/release-gate.mjs";
const read = p => fs.readFileSync(new URL("../"+p, import.meta.url), "utf8");
const license=read("LICENSE"), notices=read("docs/third-party-notices.md"),html=read("index.html");
assert.match(license,/Proprietary Application License Notice/);
assert.match(license,/All rights reserved/);
assert.match(license,/NOT to separately licensed third-party materials/);
assert.match(license,/reverse engineering for debugging/);
for(const p of ["third_party/libjpeg-turbo/LICENSE.md",
  "third_party/libjpeg-turbo/README.ijg","third_party/libspng/LICENSE","third_party/zlib/LICENSE"])
  assert.ok(read(p).length>100, p+" license missing");
for(const text of ["Independent JPEG Group","libjpeg-turbo","libspng","zlib","LGPL-3.0"])
  assert.ok(notices.includes(text),"missing notice "+text);
assert.match(html,/href="\.\/LICENSE"/);
assert.match(html,/href="\.\/docs\/third-party-notices\.md"/);
const m=readHeicReleaseManifest();
assert.equal(m.distribution.applicationLicense,"proprietary");
assert.equal(m.distribution.evidence.applicationLicenseDecision,"documented");
const result=evaluateHeicRelease(m,{applicationLicenseFile:new URL("../LICENSE",import.meta.url)});
assert.equal(result.ready,false);
assert.ok(result.blockers.includes("review pending: applicationLicenseDecision"));
console.log("App proprietary / inherited third-party license smoke tests passed");
