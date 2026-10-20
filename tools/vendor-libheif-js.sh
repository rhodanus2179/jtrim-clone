#!/usr/bin/env bash
# One-time manual step on a networked workstation, never on routine push CI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
npm install --prefix "$TMP" --no-save --no-package-lock --ignore-scripts "libheif-js@1.23.5"
SRC="$TMP/node_modules/libheif-js"
test -s "$SRC/libheif-wasm/libheif-bundle.mjs"
test -s "$SRC/LICENSE"
mkdir -p "$ROOT/third_party/libheif-js"
cp "$SRC/libheif-wasm/libheif-bundle.mjs" "$ROOT/third_party/libheif-js/libheif-bundle.mjs"
cp "$SRC/LICENSE" "$ROOT/third_party/libheif-js/LICENSE"
sha256sum "$ROOT/third_party/libheif-js/libheif-bundle.mjs"
echo "Before public deployment: verify LGPL-3.0, full corresponding source, relinking, and libde265/HEVC obligations."
