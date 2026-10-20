# P2 — HEIC WASM browser verification and release gate

Date: 2026-10-20. P2 test workflow is separate from the existing fast CI and does **not** commit or upload third-party code or personal photos.

## Reproducible browser test

`.github/workflows/heic-wasm-validation.yml` installs `libheif-js@1.23.5` in runner-only storage, copies the upstream ESM WASM bundle temporarily to `third_party/libheif-js/libheif-bundle.mjs` (the path referenced by the Worker), records its SHA-256 to CI logs, and launches Playwright Chromium. All images remain inside the runner. The public fixture comes from `strukturag/libheif` pinned commit `364905fc9841bdda229e0ae2c5fda13b5fc98d1a`, `examples/example.heic` (718114 bytes); no user photos are used.

The test must prove: Worker-loaded real HEIC -> Canvas dimensions -> actual JPEG and PNG blobs -> file-input/editor UI. Core contract/unit tests run again. A successful test proves **only** the public fixture under the GitHub Actions Chromium version. It does not prove iPhone 24.5MP correctness, HEIF rotation, Display P3, or Edge/Safari compatibility.

## Source, legal and distribution caveats

- `libheif-js@1.23.5` is advertised under LGPL-3.0. Its native components include libheif and libde265; independent code and license requirements must be reviewed.
- Deploying the single-file Emscripten bundle can count as conveying an LGPL-covered combined library; do not mark release-ready before providing complete corresponding sources, applicable attribution, modification/replacement route and required license texts. The `tools/vendor-libheif-js.sh` currently copies only the bundle and top-level LICENSE: **insufficient by itself as a distribution compliance procedure.**
- HEVC patent/licensing review is separate from software copyright licenses; no legal clearance is asserted.
- Package tarball integrity and output SHA-256 should be fixed in `tools/wasm/versions.json` after obtaining verifiable checksums, before vendoring for production.
- Existing PRs #1 → #2 → #3 are unmerged drafts. This PR builds upon #3 and must not be merged to main before them.
- Private user HEIC originals are only tested locally/in protected environment; they must never be uploaded to GitHub or a public CDN.

## Acceptance to leave draft

1. CI: public HEIC browser test success in Chromium with matching pinned vendor hash.
2. Local private HEIC: portrait 4284×5712 and landscape 5712×4284, confirm visual rotation (one contains a 270° transform), compare to original iPhone display.
3. 24.47MP memory and time, thumbnail, slideshow, batch and export regression.
4. Replacement/source documentation and license review completed.
