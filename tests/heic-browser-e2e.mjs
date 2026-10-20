import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const required = ["PLAYWRIGHT_MODULE", "HEIC_TEST_FILE"];
for (const key of required) if (!process.env[key]) throw Error(key + " required");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = process.cwd();
const types = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".wasm", "application/wasm"], [".heic", "image/heic"]
]);
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await fs.readFile(file);
    res.setHeader("Content-Type", types.get(path.extname(file).toLowerCase()) || "application/octet-stream");
    res.writeHead(200).end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.on("pageerror", error => console.error("Page error:", error.message));
  await page.goto(base, { waitUntil: "load" });
  const info = await page.evaluate(async () => {
    const vendor = await import("./third_party/libheif-js/libheif-bundle.mjs");
    return { exports: Object.keys(vendor), kind: typeof vendor.default,
      keys: typeof vendor.default === "object" ? Object.keys(vendor.default || {}).slice(0, 16) : [],
      hasDecoder: typeof vendor.default?.HeifDecoder,
      thenable: typeof vendor.default?.then };
  });
  console.log("WASM module shape:", JSON.stringify(info));
  const bytes = [...new Uint8Array(await fs.readFile(process.env.HEIC_TEST_FILE))];
  const result = await page.evaluate(async array => {
    const file = new File([new Uint8Array(array)], "upstream-example.heic", { type: "image/heic" });
    const { decodeFileToCanvas } = await import("./js/io/files.js");
    const canvas = document.createElement("canvas");
    const started = performance.now();
    const meta = await decodeFileToCanvas(file, canvas);
    const elapsedMs = Math.round(performance.now() - started);
    const pixel = canvas.getContext("2d").getImageData(
      Math.min(5, canvas.width - 1), Math.min(5, canvas.height - 1), 1, 1).data;
    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .8));
    const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const jpegHeader = [...new Uint8Array(await jpeg.slice(0, 3).arrayBuffer())];
    const pngHeader = [...new Uint8Array(await png.slice(0, 4).arrayBuffer())];
    return {
      width: meta.width, height: meta.height, source: meta.sourceFormat,
      elapsedMs, pixel: [...pixel], jpegLength: jpeg.size, pngLength: png.size,
      jpegHeader, pngHeader
    };
  }, bytes);
  assert.ok(result.width > 0 && result.height > 0 && result.width * result.height > 1000);
  assert.deepEqual(result.jpegHeader, [0xff, 0xd8, 0xff]);
  assert.deepEqual(result.pngHeader, [137, 80, 78, 71]);
  console.log("Real HEIC browser decode and PNG/JPEG export PASS:", JSON.stringify(result));
  await page.locator("#fileInput").setInputFiles(process.env.HEIC_TEST_FILE);
  await page.waitForFunction(() => {
    const status = document.querySelector("#statusMessage")?.textContent || "";
    return status.includes("開きました") || status.includes("読み込めませんでした");
  }, { timeout: 120000 });
  const status = await page.locator("#statusMessage").textContent();
  assert.match(status, /開きました/, "UI open failed: " + status);
  console.log("File picker to edit canvas PASS:", status);

  // Two public HEIC copies with distinct names exercise lazy previews, slideshow
  // and ZIP batch output. Never use private iPhone photos in GitHub Actions.
  const fixtureBytes = await fs.readFile(process.env.HEIC_TEST_FILE);
  const galleryFiles = [
    { name: "first.HEIC", mimeType: "image/heic", buffer: fixtureBytes },
    { name: "second.heic", mimeType: "image/heic", buffer: fixtureBytes }
  ];
  await page.locator("#galleryFileInput").setInputFiles(galleryFiles);
  await page.waitForSelector("#thumbnailDialog[open]");
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll("#thumbnailGrid .thumbnail-item img")];
    return imgs.length >= 2 && imgs.every(img => img.complete && img.naturalWidth > 0);
  }, null, { timeout: 120000 });
  const thumbnails = await page.locator("#thumbnailGrid .thumbnail-item img").evaluateAll(
    imgs => imgs.map(img => [img.naturalWidth, img.naturalHeight]));
  assert.equal(thumbnails.length, 2);
  console.log("HEIC gallery thumbnail PASS:", JSON.stringify(thumbnails));

  // Open slideshow from existing gallery state after closing the thumbnails modal.
  await page.evaluate(() => {
    document.querySelector("#thumbnailDialog").close();
    document.querySelector('[data-command="file.slideshow"]').click();
  });
  await page.waitForSelector("#slideshowDialog[open]");
  await page.waitForFunction(() => {
    const img = document.querySelector("#slideshowImage");
    return img && !img.hidden && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 120000 });
  const firstName = await page.locator("#slideshowName").textContent();
  await page.locator("#slideshowNext").click();
  await page.waitForFunction(before => {
    const img = document.querySelector("#slideshowImage");
    return document.querySelector("#slideshowName")?.textContent !== before &&
      img && !img.hidden && img.complete && img.naturalWidth > 0;
  }, firstName, { timeout: 120000 });
  console.log("HEIC slideshow PASS:", firstName, "→", await page.locator("#slideshowName").textContent());
  await page.locator("#slideshowClose").click();

  // Batch conversion produces a ZIP with correctly named JPEGs.
  await page.evaluate(() => document.querySelector('[data-command="file.batch"]').click());
  await page.waitForSelector("#batchDialog[open]");
  await page.locator("#batchFileInput").setInputFiles(galleryFiles);
  await page.locator("#batchType").selectOption("image/jpeg");
  const downloaded = page.waitForEvent("download", { timeout: 120000 });
  await page.locator("#batchStart").click();
  const download = await downloaded;
  const archive = await fs.readFile(await download.path());
  assert.deepEqual([...archive.subarray(0, 4)], [80, 75, 3, 4]);
  for (const name of ["first.jpg", "second.jpg"]) {
    assert.ok(archive.includes(Buffer.from(name, "utf8")), "ZIP missing " + name);
  }
  assert.match(await page.locator("#batchStatus").textContent(), /2ファイルの変換が完了/);
  console.log("HEIC batch conversion JPEG ZIP PASS:", archive.byteLength);

  // Ctrl+S on HEIC must open Save As, never silently write to the source.
  await page.evaluate(() => document.querySelector('[data-command="file.overwrite"]').click());
  await page.waitForSelector("#saveDialog[open]");
  console.log("HEIC Save As routing PASS");

} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
