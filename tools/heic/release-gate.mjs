import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultManifest = new URL("../../docs/heic-release-manifest.json", import.meta.url);
const goodSha = value => /^[0-9a-f]{40}$/.test(value || "");
const goodHash = value => /^[0-9a-f]{64}$/.test(value || "");
const APPROVAL_ITEMS = [
  "versionMatchedSource", "fullCorrespondingSource", "LGPLandGPLTexts",
  "libraryReplacementTest", "HEVCPatentAssessment", "EdgeBrowserAcceptance",
  "highResolutionUiAcceptance", "peakMemoryAcceptance", "applicationLicenseDecision"
];

export function evaluateHeicRelease(manifest, { vendorFile = null, sourceDirectory = null, applicationLicenseFile = null } = {}) {
  const blockers = [];
  if (manifest?.schemaVersion !== 1 || manifest?.package !== "libheif-js" ||
    manifest?.npmVersion !== "1.23.5" || !goodHash(manifest?.bundle?.sha256)) {
    blockers.push("invalid pinned manifest or bundle digest");
  }
  const sources = manifest?.sources || [];
  const required = ["libheif-js", "libheif-emscripten", "libheif", "libde265"];
  if (sources.length !== 4 || required.some(name =>
    !sources.some(src => src.name === name && goodSha(src.sha) && /^[\w-]+\/[\w-]+$/.test(src.repo)))) {
    blockers.push("missing version-pinned corresponding source references");
  }
  if (manifest?.build?.emscripten !== "3.1.61" || manifest?.build?.libde265 !== "1.0.15")
    blockers.push("unverified native build toolchain");
  if (vendorFile) {
    if (!fs.existsSync(vendorFile)) blockers.push("decoder bundle is missing");
    else {
      const hash = crypto.createHash("sha256").update(fs.readFileSync(vendorFile)).digest("hex");
      if (hash !== manifest.bundle.sha256) blockers.push("decoder bundle checksum mismatch");
    }
  } else blockers.push("decoder binary is not present for final release verification");
  if (sourceDirectory) {
    for (const src of required) {
      const folder = path.join(sourceDirectory,src);
      if (!fs.existsSync(folder) || !fs.readdirSync(folder).length)
        blockers.push("missing source directory: "+src);
    }
  } else blockers.push("complete source bundle not supplied for final release verification");
  if (!applicationLicenseFile || !fs.statSync(applicationLicenseFile, { throwIfNoEntry: false })?.isFile() || !fs.readFileSync(applicationLicenseFile, 'utf8').trim())
    blockers.push('application license is not documented');
  const distribution = manifest?.distribution || {};
  for (const item of APPROVAL_ITEMS) {
    if (distribution.evidence?.[item] !== "approved")
      blockers.push("review pending: "+item);
  }
  if (!distribution.approved || !distribution.reviewedBy?.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(distribution.reviewedOn || "") ||
      !distribution.approvalRecord?.trim())
    blockers.push("named distribution approval absent");
  return { ready: blockers.length === 0, blockers };
}

export function readHeicReleaseManifest(file = defaultManifest) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = readHeicReleaseManifest();
  const mode = process.argv[2] || "--review-status";
  if (!["--review-status", "--assert-release"].includes(mode))
    throw Error("Usage: node tools/heic/release-gate.mjs [--review-status|--assert-release]");
  const { ready, blockers } = evaluateHeicRelease(manifest, {
    vendorFile: fileURLToPath(new URL("../../third_party/libheif-js/libheif-bundle.mjs", import.meta.url)),
    sourceDirectory: fileURLToPath(new URL("../../third_party/libheif-source", import.meta.url)),
    applicationLicenseFile: fileURLToPath(new URL("../../LICENSE", import.meta.url))
  });
  console.log(ready ? "HEIC RELEASE READY" : "HEIC RELEASE HOLD — " + blockers.length + " blockers");
  for (const reason of blockers) console.log("  - " + reason);
  if (mode === "--assert-release" && !ready) process.exitCode = 1;
}
