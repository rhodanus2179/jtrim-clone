# HEIC security-updated WASM — experimental rebuild

2026-10-20. Separate draft built on PR #11. Never release on this branch.

Build candidate: libheif 1.23.6 commit f81f28ac014b1c28dee483ac45b72c6b05bc421a,
libde265 1.1.3 commit ba62bf4cfb3242f3bf0a45617ff09e35236e4d82,
previous libheif-js 1.23.5 ESM packaging scripts only.

The old upstream libheif Emscripten build script assumes libde265 Autotools.
This experiment first creates CMake-built static libde265 with SIMD disabled,
links it to libheif 1.23.6 through a patched *local staged copy* of the
upstream build script, and repackages the result to a compatible ESM bundle.
The built-in source marker distinguishes this binary from the old WASM.

GitHub CI validates public HEIC decode and Chromium/Edge editor E2E. Binary and
user's original photos are not committed or publicly uploaded. All output is
deleted with the CI runner.

Security-updated version numbers do not establish absence of vulnerabilities.
Source-to-binary reproducibility, malformed HEIC robustness, color/ICC, 24.5MP
full UI, LGPL corresponding source/replacement documentation, and HEVC patent
licensing determination all remain release blockers. The approved deployment
manifest is intentionally left pinned to its old (blocked) binary until a
new build is verified.

## Verified CI run (2026-10-20)

[GitHub Actions run 39379779684](https://github.com/rhodanus2179/jtrim-clone/actions/runs/39379779684) completed **successfully**.

- Updated pinned CMake `libde265 1.1.3` static library built successfully.
- Updated pinned `libheif 1.23.6` compiled under Emscripten 3.1.61 with the new static HEVC decoder and TypeScript 5.4.5. The staging-only compiled LGPL source marker was detected in the resulting JavaScript API.
- Temporary ESM file `libheif-bundle.mjs`: SHA-256 `fb6dfd39bd09bd7c8dbeed5cc4b46b144b95ffb138deee56b96320956173adb4`. This hash records **one successful runner build**, NOT a published production artifact or independently reproduced source-to-binary attestation.
- Public upstream HEIC sample decoded at **1280 × 854**.
- Chromium browser E2E passed: HEIC -> Canvas -> valid PNG/JPEG, two 480×320 thumbnails, slideshow from first HEIC to second, HEIC-to-JPEG batch ZIP and Save As routing.
- Microsoft Edge browser E2E passed the same cases. Chromium/Edge decoded identical sample pixel `[66,73,116,255]` at the probed coordinate.
- Each tested public sample decoded to Canvas in ~0.23 seconds in the CI browser; NOT a performance claim for 24.5MP iPhone HEIC originals.
- Intentionally, the **current production release gate still reported 18 blockers** because it references the old, disallowed WASM and incomplete legal/testing evidence. That is the correct fail-closed result.
- No user-provided photographs, original EXIF, rebuilt WASM or converted outputs were added to the public GitHub repository or published as CI artifacts.

### What this result does NOT establish

This new version of the decoder is **technically functional on the tested public HEIC sample**. It does not prove the compiled binary has no vulnerabilities, reproduces identically across two builds, or preserves Display P3, HDR and 270° orientation for the private originals. Low-memory real-device tests, LGPL release terms, and HEVC patent-pool coverage remain open. Publishing this standalone browser ESM still requires a separate patent and legal determination; the fact that the source is LGPL licensed or that the application is free does not by itself authorize HEVC patent practice.
