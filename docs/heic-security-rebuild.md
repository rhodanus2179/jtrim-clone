# HEIC security-updated WASM — experimental rebuild

2026-10-20. Separate draft built on PR #11. Never release on this branch.

Build candidate: libheif 1.23.6 commit f81f28ac014b1c28dee483ac45b72c6b05bc421a,
libde265 1.1.3 commit ba62bf4cfb3242f3bf0a45617ff09e35236e4d82,
previous libheif-js 1.23.5 ESM packaging scripts only.

The old upstream libheif Emscripten build script assumes libde265 Autotools.
This experiment first creates CMake-built static libde265 with SIMD disabled,
links it to libheif 1.23.6 through a patched *local staged copy* of the
upstream build script, and repackages the result to a compatible ESM bundle.
The built-in source marker distinguishes this binary from the old WASM.

GitHub CI validates public HEIC decode and Chromium/Edge editor E2E. Binary and
user's original photos are not committed or publicly uploaded. All output is
deleted with the CI runner.

Security-updated version numbers do not establish absence of vulnerabilities.
Source-to-binary reproducibility, malformed HEIC robustness, color/ICC, 24.5MP
full UI, LGPL corresponding source/replacement documentation, and HEVC patent
licensing determination all remain release blockers. The approved deployment
manifest is intentionally left pinned to its old (blocked) binary until a
new build is verified.
