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
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
