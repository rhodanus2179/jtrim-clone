# HEIC/HEIF distribution gate — release hold

Date: 2026-10-20. This is a **release checklist**, not a legal opinion or an approval.

## Status / decision

- Chromium with an upstream public HEIC fixture: PASS (worker, editable canvas, JPEG/PNG).
- Two user-supplied 24.47MP HEIC files: Chromium Worker+WASM on an `about:blank` test page: PASS, with correct dimensions and visual orientation. See P3 report for timings.
- Complete image-editor UI: public-fixture gallery/slideshow/batch/Save-As E2E is required in CI; real private HEIC complete-UI acceptance remains pending.
- Shipping `libheif-js@1.23.5` as static assets: **HOLD — not approved**.
- No user original images or image metadata may be committed to any public GitHub repository or uploaded to GitHub Actions.

## LGPL-3.0 distribution conditions requiring review

The pinned `libheif-js` package says LGPL-3.0. Its standalone Emscripten bundle includes further libraries, whose exact source versions and licensing must be verified against the actual release build. Under LGPL-3.0 §4, a Combined Work generally needs at least:

1. Prominent use attribution, exact license notices, and GNU GPLv3 plus LGPLv3 terms.
2. A complete, version-matched Minimal Corresponding Source for the LGPL components, including relevant build/rebuild scripts and modifications (if any).
3. Corresponding Application Code and a documented mechanism for the user to relink the application against a modified library; assess whether the separate ESM file and user browser overrides meet the particular requirements (do not presume §4(d)(1) applies).
4. A reproducible reconstruction/replacement procedure, with tested build or suitable equivalent artifacts. Work out source delivery and replacement access in the shipped application.
5. Review libde265/libheif license and notice terms, any bundled transitive components, and applicable HEVC patent licensing before public deployment.
6. Record final reviewer/decision, date, artifact SHA-256 and source package SHA-256.

Source of statutory text: https://www.gnu.org/licenses/lgpl-3.0.html (notices and §4 Combined Works).

## Artifact lock

- Package: `libheif-js 1.23.5`.
- Tested unmodified ESM file: `libheif-wasm/libheif-bundle.mjs`.
- SHA-256: `095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9`.
- `tools/vendor-libheif-js.sh` verifies digest before local copy. CI browser tests verify digest in the isolated runner.
- Application uses lazy Worker import from a dedicated standalone file, but this alone is not proof of LGPL compliance.

## Release guard policy

- Keep vendor bundle absent from this draft PR until its exact matching source and replacement process are audited.
- Do not quietly change GitHub Pages to load it from any third-party CDN.
- Do not merge all HEIC feature drafts to `main` under a claim of ready-for-production until review and end-to-end tests are complete.
- When ready, add a specific release approval document recording compliance evidence, not a generic checkbox or an unverified claim.

## Security and patent review update (2026-10-20)

**New independent blockers:** the pinned HEIC WASM contains `libde265 1.0.15`
and `libheif 1.23.5`, superseded by security releases. Do not deploy this
binary as-is. See [HEIC WASM licensing, patent and security assessment](heic-wasm-risk-assessment-20261020.md).

The LGPL-3.0 obligations are not a patent license. Access Advance's own FAQ
states that freely downloaded HEVC software generally requires a license,
with possible exceptions assessed per deployment. No assumption of automatic
royalty-free status for a free browser application is supported. Obtain a
documented determination; source-code license conformity alone cannot clear
the `HEVCPatentAssessment` gate.

The release manifest now also requires an independent `decoderSecurityAudit`
for a verified security-updated **actual** WASM before production.
