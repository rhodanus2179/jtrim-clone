import assert from "node:assert/strict";
import fs from "node:fs";
const read = p => fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const license=read("LICENSE"),third=read("docs/third-party-notices.md");
const html=read("index.html");
assert.match(license,/Proprietary Application License Notice/);
assert.match(license,/All rights reserved/);
assert.match(license,/NOT to separately licensed third-party materials/);
assert.match(license,/Corresponding Application Code/);
assert.match(license,/reverse engineering for debugging/);
for(const p of ["third_party/libjpeg-turbo/LICENSE.md","third_party/libjpeg-turbo/README.ijg",
 "third_party/libspng/LICENSE","third_party/zlib/LICENSE"])
 assert.ok(read(p).length>100,p+" license missing");
for(const term of ["Independent JPEG Group","libjpeg-turbo","libspng","zlib"])
 assert.ok(third.includes(term),"third-party attribution missing "+term);
assert.match(html,/href="\.\/LICENSE"/);
assert.match(html,/href="\.\/docs\/third-party-notices\.md"/);
assert.doesNotMatch(html,/\.heic,\.heif/,"HEIC must not be enabled by this safe license release");
console.log("Proprietary app / third-party license smoke tests passed");
