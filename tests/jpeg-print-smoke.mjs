import assert from "node:assert/strict";
import { parseJpegInfo } from "../js/io/jpeg-info.js";
import {
  DEFAULT_PRINT_SETTINGS,
  normalizePrintSettings,
  pageSizeMm,
  resolvedOrientation,
  printCss
} from "../js/io/print.js";

const luma = [
  16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,
  14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,
  18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,
  49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99
];

const dqt = new Uint8Array([0xff,0xdb,0x00,0x43,0x00,...luma]);
const sof2 = new Uint8Array([
  0xff,0xc2,0x00,0x11,
  0x08,
  0x01,0xe0,
  0x02,0x80,
  0x03,
  0x01,0x22,0x00,
  0x02,0x11,0x00,
  0x03,0x11,0x00
]);
const jpeg = new Blob([
  new Uint8Array([0xff,0xd8]),
  dqt,
  sof2,
  new Uint8Array([0xff,0xd9])
], { type: "image/jpeg" });

const info = await parseJpegInfo(jpeg);
assert.ok(info);
assert.equal(info.width, 640);
assert.equal(info.height, 480);
assert.equal(info.progressive, true);
assert.equal(info.sampling, "4:2:0");
assert.equal(info.estimatedQuality, 50);
assert.equal(info.componentCount, 3);

const portrait = normalizePrintSettings(DEFAULT_PRINT_SETTINGS);
assert.equal(resolvedOrientation(portrait, 600, 900), "portrait");
assert.equal(resolvedOrientation(portrait, 1200, 800), "landscape");

const a4Landscape = pageSizeMm({ ...portrait, orientation: "landscape" }, 1, 1);
assert.equal(a4Landscape.width, 297);
assert.equal(a4Landscape.height, 210);

const css = printCss({ ...portrait, borderless: true }, 1000, 500);
assert.match(css, /@page/);
assert.match(css, /margin: 0/);
assert.match(css, /landscape/);

console.log("JPEG and print smoke tests passed");
