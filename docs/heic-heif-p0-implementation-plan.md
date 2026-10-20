# HEIC/HEIF — P0 technical validation and implementation tasks

Date: 2026-10-20. Baseline: jtrim-clone main at `8d9cb946` (v0.11.6).
Status: **P0a parser-only prototype. HEIC image decoding is NOT implemented yet.**

## Scope and gating decisions

- Input-only HEIC/HEIF, export to existing JPEG/PNG/WebP. Never overwrite original HEIC.
- P0a checks MIME/filename hints and `ftyp` HEVC-versus-AVIF brands without fetching full image bytes. Strings such as `mif1` are not enough to claim HEVC.
- P0b must verify `libheif-js@1.23.5`'s browser ESM/WASM variant in a Worker with real iPhone HEIC. Measure first/second load, orientation, primary image selection, pixel dimensions, color, and memory. Do **not** claim decoder support before this test.
- Pin vendor version/checksum for an offline GitHub Pages build. Review LGPL-3.0, transitive libheif/libde265 obligations, complete corresponding sources, replacement/relinking and HEVC patent concerns **before distributing the codec**.
- The two provided signboard images are JPEG (useful for regression/quality tests) and cannot substitute for raw HEIC decoding tests.

## File-by-file implementation map

| Stage | Files/functions | Required behavior |
|---|---|---|
| P0a | `js/io/image-format.js` (new) | `isHeicCandidate`, `isSupportedInputImage`, `inspectHeifFtyp`, `inspectHeifFile` |
| P0a | `tests/heic-format-smoke.mjs` (new), `.github/workflows/ci.yml` | Node tests for empty MIME, uppercase HEIC, brands `heic/heix/mif1/avif`, malformed header |
| P0b | `js/codecs/heic-client.js` (new) | Request IDs, Promise/error mapping, transferable RGBA, cancellation and worker disposal |
| P0b | `js/worker/heic-worker.js` (new), version-pinned vendor assets | Lazy import; HEIF header and dimensions/size checks; RGBA8 decode; memory freeing |
| P1 | `js/io/files.js:decodeFileToCanvas` | Native `createImageBitmap` first; WASM fallback for HEIC only. Decode to shared Canvas and normalized metadata |
| P1 | `js/io/file-system-access.js:isLikelyImageName` | Add `heic`/`heif` to folder and recursive enumeration |
| P1 | `index.html` | Add `.heic,.heif` to six `accept` attributes; do not expose HEIC as a save format |
| P1 | `js/main.js:loadFile`, `handleDroppedDataTransfer`, `setGalleryFiles` | Use shared `isSupportedInputImage` to keep HEIC with missing MIME |
| P1 | `js/main.js:fileToCanvas` | Route join/composite/texture imports through common decode too |
| P2 | `js/main.js:ensureGalleryUrl`, `loadThumbnail` | HEIC preview must be decoded and downscaled to JPEG/WebP Blob before `<img>`. Add load error handling, URL release, one decode at a time |
| P2 | `js/main.js:getSlideshowItems`, `showSlide` | Use display URLs and generation counters; preload next at most one |
| P3 | `js/main.js:processBatchFile` and `setupBatchDialog` | Include MIME-empty HEIC in batch. Preserve output naming and conflict policy |
| P3 | `js/main.js:writableImageType` and save handlers | Keep HEIC excluded from overwritable formats; Ctrl+S must open Save As |
| P4 | `tests/...`, `README.md`, `docs/third-party-notices.md` | Regression/browser fixtures and license/source/relinking notices |

## Test matrix / acceptance

1. `node tests/heic-format-smoke.mjs` succeeds. Existing test jobs continue passing.
2. Windows Chrome/Edge opens 12 MP real HEVC iPhone HEIC in the browser without uploading; Safari displays the same orientation.
3. Decode works for typical portrait and landscape originals, and produces expected width/height/color. Test Display P3 and 48 MP separately; full fidelity is not promised.
4. HEIC thumbnail, slideshow, drag/drop, folder-recursive batch, reload, save-as and export work. Unsupported HEIF variants fail with a useful error.
5. Original HEIC `FileSystemHandle` is never written (even via Ctrl+S).
6. 100 MiB compressed, 50 megapixels, 16384 px long side are provisional limits; adjust after peak-memory measurements. Preview resizing **after** full decode does not lower peak decode memory.
7. No runtime CDN; real HEIC fixture with redistribution rights in CI; no private user photos published.
8. LGPL obligations and patent considerations reviewed before any shipping code.

## Work and CI policy

Every pushed commit must remain internally consistent and pass CI. P0a is independent, and **does not alter image-loading UI**, so users will not mistakenly see working HEIC support. Subsequent stages should have implementation + tests in the same logical PR. Do not add codec build auto-commits to the push-triggered CI; the current `rebuild-codecs.yml` already does that for another codec.

## Current status

- **PASS**: Static MIME/filename/HEIF `ftyp` unit tests, including AVIF distinction.
- **NOT TESTED**: Real HEIC WASM decoding, browsers, orientation, ICC/HDR, primary image, performance, licensing compliance.
- **BLOCKER for P0b**: Distributable real HEVC HEIC test fixture and approved codec build. The current local `heif-enc` lacks an HEVC encoder.
