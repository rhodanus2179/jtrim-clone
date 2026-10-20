# HEIC P3 — high-resolution Chromium and UI qualification

2026-10-20. P3 branch targets P2, itself a draft dependent on PRs #1–#3.

## Private high-resolution Chrome/Chromium proof (outside the app shell)

Using the exact SHA-256-pinned upstream unmodified WASM ESM module loaded via Blob URL in an isolated Chromium Worker, two originals from Google Drive were **decoded inside Chromium** and drawn to HTML Canvas. The image bytes remained local; neither GitHub nor external servers received the photos.

| Item | HEIC sample 1 | HEIC sample 2 |
|---|---:|---:|
| Width × height | 4284 × 5712 | 5712 × 4284 |
| Pixels | 24,470,208 | 24,470,208 |
| WASM decoder timing | 2212 ms | 2005 ms |
| Canvas `putImageData` timing | 256 ms | 148 ms |
| Decode-to-preview wall time | 2530 ms | 2201 ms |
| Orientation | portrait as expected | landscape as expected |
| Output | valid 1000px JPEG preview | valid 1000px JPEG preview |

The work occurs on a `about:blank` browser page, because this execution environment blocks navigation to localhost and data: URLs. It **is a genuine browser-WASM test**, but not a test through the full JTrim Web UI. Downsampled reference-JPEG absolute RGB differences cannot establish ICC/P3/HDR fidelity.

RGBA uncompressed size for either original is exactly `4284 × 5712 × 4 = 97,880,832 bytes` (about 93.35 MiB). Worker-side temporary buffers and Canvas surfaces add memory. No numeric peak RSS limit is claimed: resource monitoring and low-memory-device tests are pending.

## P3 code changes

- Cross-format guard ensures a file named `.HEIC/.HEIF` or carrying a HEIC MIME type is **never writable in place**, even if the browser reports an incorrect JPEG/PNG MIME type.
- Thumbnail queue skips items whose gallery was closed/replaced before queued decode started.
- Large temporary Canvas is released in `finally`, including failed thumbnail renders.
- GitHub Actions real-Chromium test uses only public upstream fixture, now covers gallery thumbnail, slideshow, ZIP batch (two HEIC entries), and Save-As routing, in addition to existing decode/export.
- LGPL delivery gate and notice file clarify **not shipped** until legal + technical review.

## Remaining release blockers

1. Binary distribution requirements: LGPL source/replaceability/provenance + HEVC patent review (see `docs/heic-heif-distribution-gate.md`).
2. Full JTrim UI testing with actual 24.47MP HEIC in at least Chromium and Edge on representative hardware; private images must stay private.
3. Peak memory instrumentation under sequential gallery/batch stress; edge cases (ICC/P3/HDR, multiple images).
4. PR review/merge sequence #1→#2→#3→#4→P3. **Do not deploy as finished until gates clear.**
