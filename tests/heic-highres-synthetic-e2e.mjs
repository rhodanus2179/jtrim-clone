import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const fixture=process.env.HEIC_HIGHRES_TEST_FILE;
const playwrightModule=process.env.PLAYWRIGHT_MODULE;
if(!fixture||!playwrightModule) throw Error("HEIC_HIGHRES_TEST_FILE and PLAYWRIGHT_MODULE required");
const {chromium}=await import(pathToFileURL(playwrightModule).href);
const repo=process.cwd();
const image=await fs.readFile(fixture);
const dimensions={width:4284,height:5712};
const expectedPixels=dimensions.width*dimensions.height;
const types=new Map([[".html","text/html"],[".mjs","text/javascript"],[".js","text/javascript"],[".css","text/css"]]);
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/__highres.heic") {
    res.writeHead(200,{"Content-Type":"image/heic","Content-Length":image.byteLength}).end(image);
    return;
  }
  const requested=decodeURIComponent(url.pathname);
  const actual=path.resolve(repo,"."+ (requested==="/" ? "/index.html":requested));
  if(!actual.startsWith(repo+path.sep)) {res.writeHead(403).end();return;}
  try {
    const bytes=await fs.readFile(actual);
    res.writeHead(200,{"Content-Type":types.get(path.extname(actual))??"application/octet-stream"}).end(bytes);
  } catch {res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const origin="http://127.0.0.1:"+server.address().port;
function chromiumRssKiB() {
  try {
    const p=execFileSync("ps",["-e","-o","comm=,rss="],{encoding:"utf8",timeout:4000});
    return p.split("\n").reduce((sum,line)=>{
      const m=line.trim().match(/^(\S+)\s+(\d+)$/);
      return m && /^(chrome|chromium|msedge|headless_shell|chrome-headless)$/.test(m[1])?sum+Number(m[2]):sum;
    },0);
  } catch {return 0;}
}
let browser, sampler;
let maxRssKiB=0, baselineKiB=0, samples=0;
try {
  browser=await chromium.launch({headless:true,args:["--no-sandbox","--enable-precise-memory-info"]});
  const page=await browser.newPage({acceptDownloads:true});
  page.on("dialog",d=>d.accept());
  page.on("pageerror",e=>console.error("Page error:",e.message));
  baselineKiB=chromiumRssKiB();
  sampler=setInterval(()=>{
    maxRssKiB=Math.max(maxRssKiB,chromiumRssKiB());
    samples++;
  },250);
  await page.goto(origin,{waitUntil:"load"});
  const metrics=await page.evaluate(async()=>{
    const response=await fetch("/__highres.heic");
    const file=new File([await response.arrayBuffer()],"synthetic-24mp.HEIC",{type:"image/heic"});
    const {decodeFileToCanvas}=await import("./js/io/files.js");
    const results=[];
    for(let i=0;i<2;i++){
      const canvas=document.createElement("canvas");
      const start=performance.now();
      const meta=await decodeFileToCanvas(file,canvas);
      const decodeMs=Math.round(performance.now()-start);
      const ctx=canvas.getContext("2d");
      const points=[
        [100,100],[canvas.width-100,100],
        [100,canvas.height-100],[canvas.width-100,canvas.height-100]
      ].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);
      const jpg=await new Promise(ok=>canvas.toBlob(ok,"image/jpeg",0.8));
      const jpegPrefix=[...new Uint8Array(await jpg.slice(0,3).arrayBuffer())];
      results.push({width:meta.width,height:meta.height,decodeMs,points,jpgBytes:jpg.size,jpegPrefix});
      canvas.width=canvas.height=0;
    }
    return results;
  });
  for(const result of metrics){
    assert.equal(result.width,dimensions.width);
    assert.equal(result.height,dimensions.height);
    assert.deepEqual(result.jpegPrefix,[255,216,255]);
    assert.ok(result.jpgBytes>1000);
    // Quadrant colors need to remain distinguishable after HEVC compression.
    const [tl,tr,bl,br]=result.points;
    assert.ok(tl[0]>tl[2],"Top-left red quadrant missing");
    assert.ok(tr[1]>tr[2],"Top-right green quadrant missing");
    assert.ok(bl[2]>bl[0],"Bottom-left blue quadrant missing");
    assert.ok(br[0]>br[2] && br[1]>br[2],"Bottom-right yellow quadrant missing");
  }
  await page.locator("#fileInput").setInputFiles(fixture);
  await page.waitForFunction(()=>{
    const s=document.querySelector("#statusMessage")?.textContent||"";
    return s.includes("開きました")||s.includes("読み込めませんでした");
  },null,{timeout:150000});
  const message=await page.locator("#statusMessage").textContent();
  assert.match(message,/開きました/,message);
  console.log("HEIC 24.47MP synthetic Chromium E2E PASS",
    JSON.stringify({expectedPixels,dimensions,fixtureBytes:image.byteLength,metrics,
      baselineChromiumRssKiB:baselineKiB,maxChromiumRssKiB:maxRssKiB,samples,
      rssMetric:"sum of process RSS, double-counts shared memory; not peak unique physical memory"}));
} finally {
  if(sampler) clearInterval(sampler);
  if(browser) await browser.close();
  await new Promise(done=>server.close(done));
}
