// Security floor reviewed against upstream security releases on 2026-10-20.
// This is a *minimum screening threshold*, not a guarantee of safety.
// Any production build still needs its own advisory and feature/configuration audit.
export const HEIC_SECURITY_REVIEW = Object.freeze({
  reviewedOn: "2026-10-20",
  libheif: "1.23.6",
  libde265: "1.1.3",
  references: Object.freeze([
    "https://github.com/strukturag/libheif/releases/tag/v1.23.6",
    "https://github.com/strukturag/libde265/releases/tag/v1.1.3",
    "https://github.com/strukturag/libde265/security/advisories/GHSA-653q-9f73-8hvg",
  ])
});

function parseVersion(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) return null;
  return value.split(".").map(Number);
}

export function isVersionAtLeast(actual, minimum) {
  const left = parseVersion(actual), right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return true;
}

export function getCodecSecurityBlockers(manifest) {
  const issues = [];
  for (const library of ["libheif", "libde265"]) {
    const current = manifest?.build?.[library];
    const minimum = HEIC_SECURITY_REVIEW[library];
    if (!isVersionAtLeast(current, minimum)) {
      issues.push("outdated HEIC codec " + library + " " + (current ?? "unknown")
        + " (security review baseline " + minimum + " as of "
        + HEIC_SECURITY_REVIEW.reviewedOn + ")");
    }
  }
  // A version match is only a necessary preflight: the versions must be
  // confirmed in the actual embedded WASM, not merely typed in this manifest.
  return issues;
}
