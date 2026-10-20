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

## P2 actual results (2026-10-20)

- GitHub Actions Chromium with a public upstream HEIC sample: **PASS**. Native HEIC via browser is not assumed; real `libheif-js` WASM Worker -> Canvas -> JPEG+PNG -> editor file picker tested.
- `libheif-js@1.23.5` unmodified `libheif-bundle.mjs` SHA-256: `095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9` (2,043,959 bytes).
- Private originals, processed in **local Node.js/WASM** without uploading or committing: 4284×5712 and 5712×4284, single frame each. End-to-end runtimes ~1964 ms and ~1817 ms in this environment (including bundle load and decoding per process). Orientation visibly matches the JPEG previews, including source with 270° HEIF rotation.
- Downsampled image comparison vs the chat JPEG previews: average absolute RGB differences ~[3.08, 2.66, 2.85] and [1.60, 1.50, 1.56] per 8-bit channel. This is a rough regression indicator, **not** proof of full ICC/P3/HDR fidelity.
- Container Chromium failed with `ERR_BLOCKED_BY_ADMINISTRATOR` for both localhost and file:// before loading the app. Therefore **private high-resolution browser UI E2E is not verified**. The GitHub Actions browser pass is on the public fixture only.
- User photos, metadata and decoded RGBA remain outside the public GitHub repository. Run `bash tools/vendor-libheif-js.sh` and `node tests/heic-private-wasm.mjs /path/to/photo1.HEIC /path/to/photo2.HEIC` for reproducible local testing. These are development commands; vendoring alone does not satisfy LGPL/HEVC release obligations.
- This remains a draft: no third-party binary committed and no production deployment clearance.
