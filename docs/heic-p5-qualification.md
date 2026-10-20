# P5: browser cross-check, runtime memory and LGPL replacement evidence

Date: 2026-10-20. This branch is built on PR #6. The HEIC decoder binary is **not distributed**.

## Evidence: private originals, local Chromium (outside full JTrim UI)

Two actual iPhone HEVC HEIC originals were held locally, never copied into GitHub Actions:

| Item | Portrait | Landscape |
|---|---:|---:|
| Dimensions | 4284 × 5712 | 5712 × 4284 |
| Pixel count | 24,470,208 | 24,470,208 |
| WASM to Canvas runs | 3/3 | 3/3 |
| Wall time per run | 2.253 / 2.222 / 2.048 seconds | 2.051 / 1.932 / 1.989 seconds |
| Pixel consistency | Identical sampled RGBA values | Identical sampled RGBA values |

At 40ms sampling, the **sum of RSS across Chromium subprocesses** started near 387 MiB and reached up to 1,027 MiB; the largest single process RSS reached 674 MiB. This is **not unique memory consumption**: shared pages are counted repeatedly, and it is not a reproducible memory upper bound. Sampling includes browser initialisation and runs. The test did not crash on six sequential images, but low-memory devices are not accepted yet.

User photos, metadata, and decoded raw pixels are not in this repository or any public CI artifact. The measured route is an isolated Chromium Worker+Canvas on a blank page (full app UI with the private fixtures remains pending).

## Edge end-to-end + replacement test

`.github/workflows/heic-p5-qualification.yml` downloads the exact SHA-256-pinned libheif-js 1.23.5 bundle only into the runner. It executes the existing *real image* editor E2E test (file open; gallery thumbnails; slideshow; 2-image JPEG ZIP batch; Save As routing) in **Microsoft Edge**.

Then `tools/heic/replacement-probe.mjs --install` renames the original verified ESM to `libheif-original.mjs`, places a separately authored compatibility ESM adapter at the original import path, and executes the exact E2E again, verifying its unique export marker. The file is then restored and checked for unchanged checksum.

**Scope limitation:** this verifies the application loader can load a substitute ESM module, not that a modified or rebuilt LGPL-covered `libheif` or `libde265` binary can be relinked. It does not alone meet LGPL-3.0 §4, so `libraryReplacementTest` remains `pending` in `docs/heic-release-manifest.json`.

## Rebuild and release hold

- The source audit in P4 identifies `libheif-emscripten`, `libheif`, `libde265`, and `libheif-js` at immutable commits.
- Rebuilding a modified native library using Emscripten 3.1.61, creating the bundled ESM, and proving that the app loads **that rebuilt LGPL library** have not yet been carried out.
- Formal evaluation of source delivery method, LGPL licensing, HEVC patents/royalties, browser compatibility and color management also remains open. The automated release gate must continue to reject production.
- Memory measurements indicate that even single 24.5MP photographs can induce high peak RSS; consider enforcing resolution limits / user-facing warning and test on RAM-constrained devices before broad release.

## CI pass/fail interpretation

- Edge E2E pass means functionality on the CI runner with *one public 1280x854 HEIC fixture*, not private 24.5MP images or low-RAM acceptance.
- Substitute-ESM pass only validates the browser module load path, not library binary replacement or compliance.
- No unapproved WASM is committed; `main` is unchanged. PR #1→#2→#3→#4→#5→#6→P5 must be reviewed in order.
