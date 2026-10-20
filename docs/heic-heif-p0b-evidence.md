# HEIC/HEIF P0b — real input validation and Worker adapter

Date: 2026-10-20. This PR is built on `feature/heic-p0-format-probe`.

## Two real HEIC originals, retrieved privately from Google Drive

The user supplied two raw iPhone photographs. **Original bytes, EXIF, location data and thumbnails must never be checked into this public repository.**

| Characteristic | Sample A | Sample B |
| --- | --- | --- |
| HEIF ftyp main brand | heic | heic |
| Codec | HEVC, 8 bit, YCbCr 4:2:0 | HEVC, 8 bit, YCbCr 4:2:0 |
| Dimensions | 4284 × 5712 (portrait) | 5712 × 4284 (landscape) |
| Pixels | 24,470,208 | 24,470,208 |
| Bytes | 2,889,173 | 2,376,162 |
| HEIF transform | 270° counterclockwise | 0° |
| Embedded thumbnail | 312 × 416 | 416 × 312 |
| Color profile and Exif | Present | Present |
| Local native libheif decode | PASS | PASS |
| `heif-convert` wall time | 5.86 s | 5.74 s |
| Native process peak RSS | 114,516 KiB | 114,168 KiB |

These are Linux **native** libheif measurements, not browser WASM results. Native conversion produced valid portrait/landscape PNGs. The compressed size is small relative to a ~98 MB uncompressed RGBA frame; browser peak memory may be significantly higher.

## Implementation in this PR

- `js/codecs/heif-decode-core.js`: decoder API adapter, 100 MiB compressed / 50 MP / 16384 px provisional guards, RGBA transfer, error model.
- `js/codecs/heif-client.js`: lazily created independent Worker, request IDs and disposal.
- `js/worker/heif-worker.js`: on-demand ESM vendor import and transferable RGBA result.
- `tests/heif-decoder-contract-smoke.mjs`: fake-decoder and fake-Worker contract test. **This is not a real HEVC or browser test.**
- CI checks import/syntax and runs the new test.

## Next gate: real browser WASM test

Candidate: `libheif-js@1.23.5`, ESM artifact `libheif-wasm/libheif-bundle.mjs`. The Worker currently imports a local `third_party/libheif-js/libheif-bundle.mjs` **which has not been vendored**. The app does not instantiate this Worker and existing UI is unmodified. A missing library is not silently replaced with a third-party CDN.

Before distributing the vendor asset: pin/check SHA-256, inspect LGPL-3.0 and transitives (including libde265), provide required source notices and library replacement procedure, review patent obligations. Test both originals on Chrome/Edge/Safari, especially 270° item rotation, primary image selection, ICC/P3, first-run latency, memory and 2-file batch; do not publicly upload those test images.

| Gate | Outcome |
| --- | --- |
| P0a format recognition | PASS |
| P0b raw HEIC provenance, native decode | PASS |
| P0b contract / Worker adapter with mocks | PASS |
| P0b real browser WASM / color / rotation | NOT TESTED |
| P1 app integration | NOT STARTED |

No claim of end-user HEIC functionality is made by this PR.
