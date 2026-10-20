#!/usr/bin/env bash
# This assembles a LOCAL review candidate only. Do not publish vendor files
# as a website asset or commit to GitHub until legal/release sign-off.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/.heic-review-staging}"
NODE="${NODE:-node}"
read_field() { "$NODE" -p "const m=require('$ROOT/docs/heic-release-manifest.json'); $1"; }
VERSION="$(read_field 'm.npmVersion')"
EXPECTED="$(read_field 'm.bundle.sha256')"
if [[ -e "$OUT" ]]; then echo "Staging directory already exists: $OUT" >&2; exit 2; fi
mkdir -p "$OUT/vendor" "$OUT/sources" "$OUT/licenses" "$OUT/report"
SOURCE_ROOT="$OUT/sources"
cleanup() {
  if [[ "$?" != 0 ]]; then echo "Staging incomplete; remove $OUT before retrying" >&2; fi
}
trap cleanup EXIT
npm install --prefix "$OUT/npm" --ignore-scripts --no-save --no-package-lock "libheif-js@$VERSION"
PKG="$OUT/npm/node_modules/libheif-js"
test "$(node -p "require('$PKG/package.json').version")" = "$VERSION"
printf '%s  %s\n' "$EXPECTED" "$PKG/libheif-wasm/libheif-bundle.mjs" | sha256sum --check
cp "$PKG/libheif-wasm/libheif-bundle.mjs" "$OUT/vendor/"
cp "$PKG/LICENSE" "$OUT/licenses/LGPL-3.0.txt"
cp "$PKG/package.json" "$OUT/report/libheif-js-npm-package.json"
# Source branches are checked out at immutable commit IDs from the reviewed manifest.
"$NODE" - "$ROOT/docs/heic-release-manifest.json" > "$OUT/report/sources.tsv" <<'NODE'
const fs=require('fs');
for (const src of JSON.parse(fs.readFileSync(process.argv[2])).sources)
  console.log([src.name,src.repo,src.sha].join('\t'));
NODE
while IFS=$'\t' read -r name repo sha; do
  mkdir -p "$SOURCE_ROOT/$name"
  git -C "$SOURCE_ROOT/$name" init -q
  git -C "$SOURCE_ROOT/$name" remote add origin "https://github.com/$repo.git"
  git -C "$SOURCE_ROOT/$name" -c protocol.version=2 fetch --depth=1 origin "$sha"
  git -C "$SOURCE_ROOT/$name" checkout -q --detach FETCH_HEAD
  ACTUAL="$(git -C "$SOURCE_ROOT/$name" rev-parse HEAD)"
  test "$ACTUAL" = "$sha"
  rm -rf "$SOURCE_ROOT/$name/.git"
done < "$OUT/report/sources.tsv"
# Keep original upstream COPYING files intact; libheif and libde265 each
# include multi-license explanations and full license texts.
test -s "$SOURCE_ROOT/libheif/COPYING"
test -s "$SOURCE_ROOT/libde265/COPYING"
cp "$SOURCE_ROOT/libheif/COPYING" "$OUT/licenses/libheif-COPYING"
cp "$SOURCE_ROOT/libde265/COPYING" "$OUT/licenses/libde265-COPYING"
cp "$SOURCE_ROOT/libheif-js/LICENSE" "$OUT/licenses/libheif-js-LICENSE"
cat > "$OUT/report/README.md" <<'EOF'
# HEIC LGPL candidate — NOT approved for production
This staged directory includes the unmodified tested upstream bundle and
four pinned upstream source trees, build scripts, npm metadata, and LGPL
license notices. It is an evidence bundle, not a legal or patent clearance.
Test the reconstruction and replacement process before public deployment.
The user must retain the ability to replace an interface-compatible library.
EOF
printf '%s  %s\n' "$EXPECTED" "libheif-bundle.mjs" > "$OUT/report/EXPECTED_SHA256"
sha256sum "$OUT/vendor/libheif-bundle.mjs" > "$OUT/report/ACTUAL_SHA256"
du -sh "$OUT" "$OUT/sources" "$OUT/vendor"
echo "HEIC audit staging complete. Do NOT deploy without sign-off."
