// Refuse to package an unapproved HEIC WASM as a production asset.
// CI calls this on every PR/push. It never uploads or deploys anything.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateHeicRelease, readHeicReleaseManifest } from "./release-gate.mjs";

export function checkHeicDeployment(repoRoot, {
  manifest = readHeicReleaseManifest(),
  gate = evaluateHeicRelease
} = {}) {
  const bundle = path.join(repoRoot, "third_party/libheif-js/libheif-bundle.mjs");
  if (!fs.statSync(bundle, { throwIfNoEntry: false })?.isFile()) {
    return { allowed: true, reason: "HEIC WASM not included (feature not publicly active)" };
  }
  const r = gate(manifest, {
    vendorFile: bundle,
    sourceDirectory: path.join(repoRoot, "third_party/libheif-source"),
    applicationLicenseFile: path.join(repoRoot, "LICENSE")
  });
  return { allowed: r.ready, reason: r.ready ? "HEIC release evidence approved"
    : "HEIC WASM is present but release review is incomplete: " + r.blockers.join("; ") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const result = checkHeicDeployment(root);
  console.log(result.reason);
  if (!result.allowed) process.exitCode = 1;
}
