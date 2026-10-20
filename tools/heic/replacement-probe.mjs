import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = fileURLToPath(new URL("../../third_party/libheif-js/", import.meta.url));
const entry = path.join(directory, "libheif-bundle.mjs");
const original = path.join(directory, "libheif-original.mjs");
const manifest = JSON.parse(fs.readFileSync(new URL("../../docs/heic-release-manifest.json", import.meta.url), "utf8"));
const mode = process.argv[2];
const checksum = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (mode === "--install") {
  if (!fs.existsSync(entry) || fs.existsSync(original)) throw Error("A pristine bundle is required");
  if (checksum(entry) !== manifest.bundle.sha256) throw Error("Bundle SHA mismatch");
  fs.renameSync(entry, original);
  // This is an independent, compatible ESM adapter. It does NOT modify,
  // recompile, or replace LGPL-covered C/WASM internals.
  const shim = [
    'import createHeif from "./libheif-original.mjs";',
    'export const replacementProbe = "p5-wrapper-v1";',
    'export default function createReplacement(...args) {',
    '  return createHeif(...args);',
    '}',
    ''
  ].join("\n");
  fs.writeFileSync(entry, shim, "utf8");
  console.log("HEIC ESM endpoint substituted with a local adapter");
} else if (mode === "--restore") {
  if (!fs.existsSync(original)) throw Error("Original bundle not found");
  if (checksum(original) !== manifest.bundle.sha256) throw Error("Original bundle checksum changed");
  fs.renameSync(original, entry);
  console.log("HEIC ESM endpoint restored");
} else throw Error("Usage: node tools/heic/replacement-probe.mjs --install|--restore");
