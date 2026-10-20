import assert from "node:assert/strict";
import {shouldWarnHeicMemory, shouldWarnHeicMemoryBeforeOpen,
  inspectHeicSpatialExtents, heicMemoryWarningMessage,
  HEIC_COMPRESSED_WARNING_BYTES, HEIC_PIXEL_WARNING_THRESHOLD}
  from "../js/io/heic-memory-policy.js";

const box=(type,payload)=>{
  const b=new Uint8Array(payload.length+8);
  new DataView(b.buffer).setUint32(0,b.length);
  for(let i=0;i<4;i++) b[i+4]=type.charCodeAt(i);
  b.set(payload,8);return b;
};
const join=(...parts)=>{
  const b=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));
  let offset=0;for(const p of parts){b.set(p,offset);offset+=p.length;}return b;
};
const letters=s=>Uint8Array.from([...s].map(c=>c.charCodeAt(0)));
const dimensions=(w,h)=>{
  const p=new Uint8Array(12),v=new DataView(p.buffer);
  v.setUint32(4,w);v.setUint32(8,h);
  return box("ispe",p);
};
const synthetic=(width,height)=>join(
  box("ftyp",join(letters("heic"),new Uint8Array(4),letters("mif1"))),
  box("meta",join(new Uint8Array(4),box("iprp",box("ipco",
    join(dimensions(320,240),dimensions(width,height)))))));

assert.equal(HEIC_COMPRESSED_WARNING_BYTES,2097152);
assert.equal(HEIC_PIXEL_WARNING_THRESHOLD,12000000);
assert.equal(shouldWarnHeicMemory({name:"IMG.HEIC",type:"",size:2889173}),true);
assert.equal(shouldWarnHeicMemory({name:"IMG.HEIF",type:"",size:2097151}),false);
assert.equal(shouldWarnHeicMemory({name:"IMG.JPG",type:"image/jpeg",size:1e8}),false);

const big=synthetic(4284,5712);
assert.ok(big.byteLength<HEIC_COMPRESSED_WARNING_BYTES);
assert.deepEqual(inspectHeicSpatialExtents(big),{width:4284,height:5712,pixels:24470208});
assert.equal(await shouldWarnHeicMemoryBeforeOpen(new File([big],"tiny.HEIC")),true,
  "24.47MP HEIC can be only a few kilobytes compressed");
const small=synthetic(1280,854);
assert.equal(await shouldWarnHeicMemoryBeforeOpen(new File([small],"tiny.heif")),false);
assert.equal(await shouldWarnHeicMemoryBeforeOpen(new File([small],"normal.png")),false);
assert.equal(await shouldWarnHeicMemoryBeforeOpen(new File([new Uint8Array(20)],"unknown.HEIC")),true);
const invalid=synthetic(1,1);invalid[4]=0; // corrupt first 'f' in mandatory 'ftyp' box
assert.equal(inspectHeicSpatialExtents(invalid),null);
assert.equal(await shouldWarnHeicMemoryBeforeOpen({name:"bad.HEIC",size:10,slice(){throw Error("I/O")}}),true);
assert.match(heicMemoryWarningMessage(),/圧縮ファイルが小さくても/);
console.log("HEIC header ispe high-resolution preflight and memory warning tests passed");
