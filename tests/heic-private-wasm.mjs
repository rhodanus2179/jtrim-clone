// Run locally with real HEIC originals; neither images nor decoded pixels are uploaded.
// Usage: node tests/heic-private-wasm.mjs image1.HEIC [image2.HEIC ...]
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { decodeHeifWithApi } from "../js/codecs/heif-decode-core.js";
import { resolveHeifModule } from "../js/codecs/resolve-heif-module.js";

const names = process.argv.slice(2);
if (!names.length) {
  console.error("Usage: node tests/heic-private-wasm.mjs file.HEIC [file2.HEIC ...]");
  process.exit(2);
}
const moduleUrl = new URL("../third_party/libheif-js/libheif-bundle.mjs", import.meta.url);
const data = await fs.readFile(fileURLToPath(moduleUrl));
const versions = JSON.parse(await fs.readFile(new URL("../tools/wasm/versions.json", import.meta.url), "utf8"));
const checksum = crypto.createHash("sha256").update(data).digest("hex");
if (checksum !== versions.libheifJs.bundleSha256) throw Error("HEIC bundle SHA-256 mismatch");
const start = performance.now();
const api = await resolveHeifModule(await import(moduleUrl.href));
for (const name of names) {
  const bytes = new Uint8Array(await fs.readFile(name));
  const decoded = await decodeHeifWithApi(api, bytes);
  if (decoded.buffer.byteLength !== decoded.width * decoded.height * 4) throw Error("Unexpected pixel buffer size");
  console.log(JSON.stringify({
    input: name.split(/[\\/]/).at(-1),
    width: decoded.width,
    height: decoded.height,
    pixels: decoded.width * decoded.height,
    frames: decoded.numberOfImages,
    elapsed_ms: Math.round(performance.now() - start)
  }));
}
