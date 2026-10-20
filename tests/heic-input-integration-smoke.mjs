import assert from "node:assert/strict";
import fs from "node:fs";
import { decodeFileToCanvas } from "../js/io/files.js";
import { isLikelyImageName } from "../js/io/file-system-access.js";

assert.equal(isLikelyImageName("photo.HEIC"), true);
assert.equal(isLikelyImageName("photo.HEIF"), true);
assert.equal(isLikelyImageName("notes.txt"), false);
let drawn = 0;
globalThis.createImageBitmap = async () => ({ width: 3, height: 2, close() {} });
const c = {width:0,height:0,getContext(){return {clearRect(){},drawImage(){drawn++},putImageData(){}}}};
const meta = await decodeFileToCanvas({name:"photo.HEIC",type:"image/heif"},c);
assert.equal(drawn, 1);assert.deepEqual([meta.width,meta.height],[3,2]);
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
assert.equal((html.match(/accept="image\/\*,\.heic,\.heif"/g)||[]).length,6);
console.log("HEIC input integration smoke tests passed");


function ftyp(brand) {
  const data = new Uint8Array(20);
  new DataView(data.buffer).setUint32(0, 20);
  data.set([102,116,121,112], 4);
  data.set([...brand].map(c => c.charCodeAt(0)), 8);
  data.set([0,0,0,0], 12);
  data.set([109,105,102,49], 16);
  return data;
}
const header = new Blob([ftyp("heic")], { type: "image/heic" });
Object.defineProperty(header, "name", { value: "fixture.HEIC" });
let pixels;
globalThis.createImageBitmap = async () => { throw new Error("native HEIC unsupported"); };
globalThis.ImageData = class {
  constructor(data, width, height) {
    this.data=data; this.width=width; this.height=height;
  }
};
globalThis.Worker = class {
  constructor() { this.listeners = {}; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  postMessage(request) {
    assert.equal(request.operation, "heif-decode");
    const buffer = new Uint8Array([10, 20, 30, 255]).buffer;
    this.listeners.message({ data: { id: request.id, ok: true,
      payload: { width: 1, height: 1, buffer } } });
  }
  terminate() {}
};
const fallbackCanvas = { width:0, height:0,
  getContext() { return { putImageData(data) { pixels = [...data.data]; } }; } };
const fallbackMeta = await decodeFileToCanvas(header, fallbackCanvas);
assert.deepEqual([fallbackMeta.width,fallbackMeta.height], [1,1]);
assert.deepEqual(pixels, [10,20,30,255]);
const avif = new Blob([ftyp("avif")], {type:"image/heif"});
Object.defineProperty(avif,"name",{value:"ambiguous.heic"});
await assert.rejects(decodeFileToCanvas(avif, fallbackCanvas), /AVIF/);
console.log("HEIC fallback Worker plumbing smoke tests passed");
