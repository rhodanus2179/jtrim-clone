# P11 — serial HEIC decodes under memory pressure

Date: 2026-10-20. Draft PR dependent on P10 (#13). No WASM deployment.

## Problem

24,470,208-pixel HEIC uses 97,880,832 bytes (93.35MiB) for one decoded
RGBA buffer, in addition to the Emscripten heap, Web Worker source buffers
and Canvas surfaces. On the CI runner, synthetic HEIC decoding caused the
sum of Chromium subprocess RSS to reach 967,320KiB (shared pages are
double-counted). This is an observed regression signal, not a unique-memory
measure or a minimum RAM requirement.

Previously, the Worker message handler was `async` and could execute
several concurrent `decodeHeifWithApi` calls. Gallery preview decoding was
queued in main.js, but batch jobs and editor opens could overlap with it.

## Mitigation

- `js/worker/heif-work-queue.js`: serialize all decode requests in the
  dedicated HEIC Worker, retaining request identifiers and transferable
  ArrayBuffer responses. A failed decode does not stop subsequent jobs.
- `js/worker/heif-worker.js`: lazy codec initialization now happens inside
  the per-Worker queue. No network upload or CDN fallback is used.
- `js/codecs/heif-client.js`: reject all pending requests and terminate the
  Worker on the browser's `messageerror` event, avoiding stuck promises.
- `tests/heif-work-queue-smoke.mjs`: simultaneous fake 3-job requests
  must never overlap, and rejected jobs must not poison later requests.
  The existing HEIF adapter test now covers malformed Worker messages.
- Real-WASM CI already runs full editor, gallery, slide show and batch against
  the 1.23.6/1.1.3 experimental codec. The same suite is rerun with queue.

## Unresolved

Serializing a single Worker's decode calls does **not** cap memory retained
by the browser outside the worker, cap every Canvas, cancel decoding, or
validate ICC/P3/HDR, tiled primary-image semantics and EXIF rotation.
The production decoder remains unshipped. LGPL release review, independent
security analysis and HEVC patents are separate HOLD blockers.

No user photo, EXIF or private metadata is committed.

## Protected private-original metadata preflight (not a WASM decode)

Using the original private iPhone HEICs **locally only**, the first 256KiB
of each ISO-BMFF header was traversed with the same nested-box rules as
`inspectHeicSpatialExtents`. Each reported largest `ispe` dimensions of
**5712×4284 = 24,470,208 pixels** (the first also contains a separate
4284×5712 spatial extent consistent with a rotated image). Both satisfy
the >=12MP pre-decode memory warning threshold.

These files contain multiple properties and thumbnails; selecting the first
`ispe` would give misleading dimensions. Selecting the largest is a warning
heuristic, NOT a primary-image selection algorithm. This check does not prove
full UI/WASM color fidelity, nor metadata location for all possible HEIFs.
Unknown extents trigger a warning. No original image bytes, EXIF, or
derived previews have been uploaded to GitHub.
