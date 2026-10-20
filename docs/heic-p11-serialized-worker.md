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
