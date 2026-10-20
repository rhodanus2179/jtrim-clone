#!/usr/bin/env bash
# P6: independently rebuild a MODIFIED LGPL-covered libheif (post.js)
# to prove browser replacement of the compiled library, not just ESM wrapping.
# This is a technical experiment ONLY. It does not authorize public distribution.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="${1:?Usage: rebuild-modified.sh <staged-source-dir>}"
LIBHEIF="$STAGE/sources/libheif"
PKG="$STAGE/sources/libheif-js"
BUILD="$STAGE/rebuild"
test -s "$LIBHEIF/post.js"
test -s "$LIBHEIF/build-emscripten.sh"
test -s "$PKG/scripts/install.js"
test -s "$PKG/scripts/bundle.js"
if [[ ! -f "$STAGE/sources/libheif-emscripten/.github/workflows/emscripten.yml" ]]; then
  echo "Missing pinned Emscripten build instructions" >&2; exit 2
fi
# Stop if an existing patch marker would risk an accidental double replacement.
if grep -q 'jtrim-p6-rebuilt-libheif' "$LIBHEIF/post.js"; then
  echo "Already modified; use a fresh staged source tree" >&2; exit 2
fi
printf '\n// Local P6 rebuild proof. Not part of the upstream source.\nModule.p6BuildProof = "jtrim-p6-rebuilt-libheif";\n' >> "$LIBHEIF/post.js"
mkdir -p "$BUILD"
cd "$BUILD"
# Required: activate Emscripten 3.1.61 in the caller's environment.
test "$(emcc --version | head -1 | grep -F '3.1.61' | wc -l)" -ge 1 || {
  echo "Emscripten 3.1.61 is required" >&2; exit 3;
}
CORES=2 USE_WASM=1 USE_TYPESCRIPT=1 USE_UNSAFE_EVAL=0 \
  "$LIBHEIF/build-emscripten.sh" "$LIBHEIF"
test -s "$BUILD/libheif.js"
test -s "$BUILD/libheif.wasm"
test -s "$BUILD/libheif.d.ts"
mkdir -p "$STAGE/package/libheif" "$STAGE/package/libheif-wasm"
cp "$BUILD/libheif.js" "$BUILD/libheif.d.ts" "$STAGE/package/libheif/"
cp "$BUILD/libheif.js" "$BUILD/libheif.d.ts" "$BUILD/libheif.wasm" "$STAGE/package/libheif-wasm/"
tar -czf "$STAGE/rebuilt-libheif.tar.gz" -C "$STAGE/package" libheif libheif-wasm
# Upstream libheif-js/scripts/install.js expects to rebuild its distribution
# from this exact tar layout, installing esbuild and its pinned build dependencies.
cd "$PKG"
npm install --no-package-lock --ignore-scripts
node scripts/install.js "$STAGE/rebuilt-libheif.tar.gz"
test -s "$PKG/libheif-wasm/libheif-bundle.mjs"
mkdir -p "$ROOT/third_party/libheif-js"
cp "$PKG/libheif-wasm/libheif-bundle.mjs" "$ROOT/third_party/libheif-js/libheif-bundle.mjs"
sha256sum "$ROOT/third_party/libheif-js/libheif-bundle.mjs"
echo "Modified LGPL-covered libheif Emscripten source compiled & rebundled."
