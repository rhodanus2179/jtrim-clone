import assert from "node:assert/strict";
import {
  isHeicCandidate, isSupportedInputImage, inspectHeifFtyp, inspectHeifFile
} from "../js/io/image-format.js";

function ftyp(major, compatible = []) {
  const b = new Uint8Array(16 + compatible.length * 4);
  const view = new DataView(b.buffer);
  view.setUint32(0, b.byteLength);
  b.set([0x66, 0x74, 0x79, 0x70], 4);
  const write = (offset, code) => b.set([...code].map(x => x.charCodeAt(0)), offset);
  write(8, major);
  compatible.forEach((code, i) => write(16 + i * 4, code));
  return b;
}

assert.equal(isHeicCandidate({ name: "IMG_0001.HEIC", type: "" }), true);
assert.equal(isHeicCandidate({ name: "photo.heif", type: "application/octet-stream" }), true);
assert.equal(isHeicCandidate({ name: "mystery", type: "IMAGE/HEIC" }), true);
assert.equal(isHeicCandidate({ name: "photo.jpg", type: "image/jpeg" }), false);
assert.equal(isHeicCandidate({ name: "notes.heic.txt", type: "" }), false);
assert.equal(isSupportedInputImage({ name: "photo.heic", type: "" }), true);
assert.equal(isSupportedInputImage({ name: "photo.jpg", type: "image/jpeg" }), true);
assert.equal(isSupportedInputImage({ name: "notes.txt", type: "text/plain" }), false);
assert.equal(inspectHeifFtyp(ftyp("heic", ["mif1"])).family, "hevc");
assert.equal(inspectHeifFtyp(ftyp("mif1", ["heix"])).family, "hevc");
assert.equal(inspectHeifFtyp(ftyp("mif1", ["avif"])).family, "avif");
assert.equal(inspectHeifFtyp(ftyp("mif1")).family, "heif-unknown");
assert.equal(inspectHeifFtyp(ftyp("avif")).family, "avif");
assert.equal(inspectHeifFtyp(new Uint8Array([0,1,2,3])).family, "not-heif");
const blob = new Blob([ftyp("heic", ["mif1"])]);
assert.equal((await inspectHeifFile(blob)).family, "hevc");
console.log("HEIC format smoke tests passed");
