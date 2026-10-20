# HEIC P6 — modified libheif rebuild and memory warning

Date: 2026-10-20. Branch based on P5 PR #7; main remains untouched.

## What P6 attempts to demonstrate

Unlike P5's ESM-adapter swap, P6 modifies `libheif/post.js` *in the pinned LGPL-covered upstream source tree*, introducing `Module.p6BuildProof = "jtrim-p6-rebuilt-libheif"`. This is not a codec change; it is an unambiguous build marker in LGPL-covered source.

The dedicated GitHub Actions job fetches the four pinned source trees in temporary directories, activates Emscripten 3.1.61, recompiles libheif plus libde265 (1.0.15) with the modified post.js, repackages the generated Emscripten artefacts using the upstream libheif-js packaging script, then runs an actual HEIC decode and the full public-fixture JTrim Chromium E2E. It confirms the marker is exported from the **rebuilt** library, instead of from an unrelated ESM wrapper. No rebuilt binary is committed or deployed, and no user's Drive photos are uploaded.

**This is a build and replacement prototype, not final LGPL-3.0 compliance approval.** The modified library must still be demonstrably user-replaceable under the actual shipped format; corresponding source/install instructions must be delivered, legal review completed, and HEVC patent licensing addressed.

## Memory safety

The desktop Chrome stress trial of the two private 24.5 MP files took about 2 seconds per HEIC; peak RSS sum across Chromium subprocesses about 1,027 MiB (not unique memory). P6 adds a confirm-before-open notice for HEIC files >=2 MiB of compressed bytes. Compressed bytes are only a *heuristic*: a small file can have enormous pixel dimensions. This is not a hard cap or proof of safe memory usage. Existing decoder hard cap remains 50 MP / 16384px per side.

The warning is shown before opening the editor, not on every thumbnail. Background gallery and batch can still consume significant memory. Those paths require further stress tests and policies before release.

## Acceptance / release

- Run `node tests/heic-memory-warning-smoke.mjs` and existing CI.
- P6 rebuilt-WASM job **must complete successfully before claiming this proof**.
- Edge/Chromium existing HEIC tests remain in place; real 24.5MP full UI, low-memory devices, P3/HDR fidelity and legal review remain pending.
- `docs/heic-release-manifest.json` flags remain **pending**, especially LGPL replacement and patent approval; `node tools/heic/release-gate.mjs --assert-release` must still fail.
