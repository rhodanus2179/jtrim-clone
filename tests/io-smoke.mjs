import assert from "node:assert/strict";
import {
  extractExifSegment,
  prepareExifSegment,
  injectExif
} from "../js/io/jpeg-exif.js";
import { createZip } from "../js/io/zip.js";

function makeExifSegment() {
  const payloadLength = 6 + 8 + 2 + 12 * 2 + 4;
  const segment = new Uint8Array(2 + 2 + payloadLength);
  segment[0] = 0xff; segment[1] = 0xe1;
  const jpegLength = payloadLength + 2;
  segment[2] = jpegLength >> 8; segment[3] = jpegLength & 0xff;
  segment.set([0x45,0x78,0x69,0x66,0,0], 4); // Exif\0\0
  const tiff = 10;
  const view = new DataView(segment.buffer);
  segment[tiff] = 0x49; segment[tiff + 1] = 0x49;
  view.setUint16(tiff + 2, 42, true);
  view.setUint32(tiff + 4, 8, true);
  const ifd = tiff + 8;
  view.setUint16(ifd, 2, true);

  let entry = ifd + 2;
  view.setUint16(entry, 0x0112, true); // orientation
  view.setUint16(entry + 2, 3, true);
  view.setUint32(entry + 4, 1, true);
  view.setUint16(entry + 8, 6, true);

  entry += 12;
  view.setUint16(entry, 0x0100, true); // width
  view.setUint16(entry + 2, 4, true);
  view.setUint32(entry + 4, 1, true);
  view.setUint32(entry + 8, 100, true);

  view.setUint32(ifd + 2 + 24, 0, true);
  return segment;
}

const exif = makeExifSegment();
const app0 = new Uint8Array([0xff,0xe0,0x00,0x04,0x00,0x00]);
const jpeg = new Blob([
  new Uint8Array([0xff,0xd8]),
  app0,
  exif,
  new Uint8Array([0xff,0xd9])
], { type: "image/jpeg" });

const extracted = await extractExifSegment(jpeg);
assert.ok(extracted, "Exif should be extracted");
assert.equal(extracted.length, exif.length);

const prepared = prepareExifSegment(extracted, 640, 480);
const preparedView = new DataView(prepared.buffer, prepared.byteOffset, prepared.byteLength);
const tiff = 10;
const ifd = tiff + 8;
assert.equal(preparedView.getUint16(ifd + 2 + 8, true), 1, "Orientation should be normalized");
assert.equal(preparedView.getUint32(ifd + 2 + 12 + 8, true), 640, "Width should be updated");

const baseJpeg = new Blob([
  new Uint8Array([0xff,0xd8]),
  app0,
  new Uint8Array([0xff,0xd9])
], { type: "image/jpeg" });
const injected = await injectExif(baseJpeg, exif, 320, 240);
const reinjected = await extractExifSegment(injected);
assert.ok(reinjected, "Injected Exif should be readable");

const zip = await createZip([
  { name: "a.txt", blob: new Blob(["alpha"]) },
  { name: "日本語.txt", blob: new Blob(["beta"]) }
]);
const zipBytes = new Uint8Array(await zip.arrayBuffer());
assert.deepEqual([...zipBytes.slice(0, 4)], [0x50,0x4b,0x03,0x04], "ZIP local header");
assert.deepEqual([...zipBytes.slice(-22, -18)], [0x50,0x4b,0x05,0x06], "ZIP end record");

console.log("IO smoke tests passed");
