#!/usr/bin/env bash
# Manual vendoring only. Do not commit or publish until LGPL/HEVC review.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VERSION="$(node -p "require('$ROOT/tools/wasm/versions.json').libheifJs.version")"
EXPECTED="$(node -p "require('$ROOT/tools/wasm/versions.json').libheifJs.bundleSha256")"
npm install --prefix "$TMP" --no-save --no-package-lock --ignore-scripts "libheif-js@$VERSION"
SRC="$TMP/node_modules/libheif-js"
test -s "$SRC/libheif-wasm/libheif-bundle.mjs"
test -s "$SRC/LICENSE"
test "$(node -p "require('$SRC/package.json').version")" = "$VERSION"
printf '%s  %s\n' "$EXPECTED" "$SRC/libheif-wasm/libheif-bundle.mjs" | sha256sum -c -
mkdir -p "$ROOT/third_party/libheif-js"
cp "$SRC/libheif-wasm/libheif-bundle.mjs" "$ROOT/third_party/libheif-js/libheif-bundle.mjs"
cp "$SRC/LICENSE" "$ROOT/third_party/libheif-js/LICENSE"
cat > "$ROOT/third_party/libheif-js/UPSTREAM.md" <<EOT
Unmodified libheif-js $VERSION WASM ESM bundle (LGPL-3.0).
Wrapper and build scripts: https://github.com/catdad-experiments/libheif-js/tree/v$VERSION
Emscripten release source: https://github.com/catdad-experiments/libheif-emscripten/releases/tag/v$VERSION
Native upstream dependencies: https://github.com/strukturag/libheif and https://github.com/strukturag/libde265
Verify matching build sources and fulfill LGPL-3.0 and source/relinking requirements before distribution.
HEVC patents may impose separate obligations.
EOT
printf '%s  %s\n' "$EXPECTED" "libheif-bundle.mjs" > "$ROOT/third_party/libheif-js/SHA256SUMS"
echo "Pinned upstream WASM copied locally for testing; NOT cleared for deployment."
