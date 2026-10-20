import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolveHeifModule } from "../js/codecs/resolve-heif-module.js";
import { decodeHeifWithApi } from "../js/codecs/heif-decode-core.js";
const decoded = await resolveHeifModule(
  await import("../third_party/libheif-js/libheif-bundle.mjs")
);
assert.equal(decoded.p6BuildProof, "jtrim-p6-rebuilt-libheif",
  "P6 marker must originate from rebuilt modified libheif post.js");
const path = process.env.HEIC_TEST_FILE;
assert.ok(path, "HEIC_TEST_FILE is required");
const img = new Uint8Array(await fs.readFile(path));
const frame = await decodeHeifWithApi(decoded,img);
assert.ok(frame.width > 0 && frame.height > 0 && frame.width * frame.height > 1000);
assert.equal(frame.buffer.byteLength,frame.width*frame.height*4);
console.log("Recompiled modified LGPL libheif HEIC decode PASS:",frame.width,frame.height);
