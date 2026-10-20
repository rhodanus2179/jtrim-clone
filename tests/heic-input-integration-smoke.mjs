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
