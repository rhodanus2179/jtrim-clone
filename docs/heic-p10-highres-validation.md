# P10: Verified experimental WASM digest and synthetic 24.47MP browser qualification

Date 2026-10-20. HEIC decoder remains NOT RELEASED.

## Reproducible wasm

The same pinned updated source + toolchain produced **identical SHA-256** in
two independent GitHub Actions runs:

- https://github.com/rhodanus2179/jtrim-clone/actions/runs/39379779684
- https://github.com/rhodanus2179/jtrim-clone/actions/runs/39381223772

Artifact `libheif-bundle.mjs` SHA-256:
`fb6dfd39bd09bd7c8dbeed5cc4b46b144b95ffb138deee56b96320956173adb4`

P10 pins this digest in `docs/heic-security-build-candidate.json` (an
**experimental** manifest separate from the unapproved deployment manifest)
and verifies it during every updated-WASM CI build. Build hash equality is
evidence of repeatability under those two runners, not cryptographic proof
that every dependency/source license has been audited.

## Synthetic high-resolution acceptance

The CI workflow generates a **synthetic**, public-safe RGB PNG at 4284x5712
(24,470,208 pixels) from quadrants and encodes it to HEIC using the runner's
native HEVC encoder. No user's original photographs, metadata, or previews
are uploaded to GitHub.

`tests/heic-highres-synthetic-e2e.mjs` then uses the rebuilt HEIC WASM in
Chromium, converts twice to Canvas and JPEG, validates the four quadrant
colors/orientation and opens the file through the actual editor UI. It reports
decode durations and Chromium RSS (sum of RSS for browser subprocesses, which
double-counts shared memory and is not uniquely attributed physical memory).
Release does not automatically pass on one CI run.

## Still open

Synthetic quadrant data cannot prove rotation handling, Display P3/ICC/HDR,
embedded thumbnail metadata, or camera-specific grid/tile features in the
two private iPhone HEICs. Their updated-WASM evaluation must be performed in
a protected local environment or with direct user-provided private testing.
Low-memory hardware and long-running gallery/batch workloads also require
acceptance thresholds.

The current production manifest stays on HOLD for LGPL obligations,
HEVC patent licensing, security audit, actual vendor artifact and rights
holder release approval. No binary or image is committed or published.
