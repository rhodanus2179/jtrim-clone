#!/usr/bin/env bash
# Experimental secure-codec build, NOT AUTHORIZED for public deployment.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$1"
CANDIDATE="$ROOT/docs/heic-security-build-candidate.json"
BUILD="$STAGE/secure-rebuild"
HEIF="$STAGE/sources/libheif"
DE265="$STAGE/sources/libde265"
PACKAGER="$STAGE/sources/libheif-js"
test -s "$PACKAGER/scripts/install.js"
test -s "$PACKAGER/scripts/bundle.js"
test "$(tsc --version)" = "Version 5.4.5"
emcc --version | head -1 | grep -Fq '3.1.61'
node - "$CANDIDATE" <<'NODE'
const fs=require('fs'),m=JSON.parse(fs.readFileSync(process.argv[2]));
if(m.status!=='EXPERIMENTAL_NOT_FOR_DISTRIBUTION'||m.legalDistributionApproved||
   m.sourcePins.find(x=>x.name==='libheif').version!=='1.23.6'||
   m.sourcePins.find(x=>x.name==='libde265').version!=='1.1.3') process.exit(1);
NODE
mkdir -p "$BUILD"
for component in libheif libde265; do
  pin="$(node -p "require('$CANDIDATE').sourcePins.find(x=>x.name==='$component').sha")"
  url="$(node -p "require('$CANDIDATE').sourcePins.find(x=>x.name==='$component').repo")"
  target="$STAGE/sources/$component"
  rm -rf "$target"
  git clone --quiet --no-checkout --filter=blob:none "https://github.com/$url.git" "$target"
  git -C "$target" fetch --quiet --depth=1 origin "$pin"
  git -C "$target" -c advice.detachedHead=false checkout --quiet --detach "$pin"
  test "$(git -C "$target" rev-parse HEAD)" = "$pin"
  echo "Updated source: $component $pin"
done
grep -q 'VERSION 1.1.3' "$DE265/CMakeLists.txt"
grep -q 'VERSION 1.23.6' "$HEIF/CMakeLists.txt"
emcmake cmake -S "$DE265" -B "$BUILD/de265" \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DENABLE_SIMD=OFF -DENABLE_SDL=OFF -DENABLE_DECODER=OFF \
  -DENABLE_ENCODER=OFF -DENABLE_SHERLOCK265=OFF \
  -DFORCE_FULL_VISIBILITY=ON
cmake --build "$BUILD/de265" --target de265 --parallel 2
DE265_STATIC="$BUILD/de265/libde265/libde265.a"
test -s "$DE265_STATIC"
python3 - "$HEIF/build-emscripten.sh" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1])
s=p.read_text()
start=s.index('CONFIGURE_ARGS_LIBDE265=""')
end=s.index('CONFIGURE_ARGS_AOM=""',start)
patched="""CONFIGURE_ARGS_LIBDE265=""
if [ "$ENABLE_LIBDE265" = "1" ]; then
    LIBDE265_DIR="$(pwd)/libde265-1.1.3"
    test -s "$LIBDE265_DIR/libde265/.libs/libde265.a"
    CONFIGURE_ARGS_LIBDE265="-DLIBDE265_INCLUDE_DIR=$LIBDE265_DIR -DLIBDE265_LIBRARY=-L$LIBDE265_DIR/libde265/.libs"
    LIBRARY_LINKER_FLAGS="$LIBRARY_LINKER_FLAGS -L$LIBDE265_DIR/libde265/.libs -lde265"
fi

"""
p.write_text(s[:start]+patched+s[end:])
PY
printf '\n// JTrim P9 source-build diagnostic marker.\nModule.securityBuildProof="jtrim-secure-libheif-1.23.6-de265-1.1.3";\n' >> "$HEIF/post.js"
mkdir -p "$BUILD/libde265-1.1.3/libde265/.libs"
cp -a "$DE265/." "$BUILD/libde265-1.1.3/"
cp "$DE265_STATIC" "$BUILD/libde265-1.1.3/libde265/.libs/libde265.a"
cp "$BUILD/de265/libde265/de265-version.h" "$BUILD/libde265-1.1.3/libde265/de265-version.h"
cd "$BUILD"
CORES=2 ENABLE_LIBDE265=1 LIBDE265_VERSION=1.1.3 USE_WASM=1 USE_TYPESCRIPT=1 USE_UNSAFE_EVAL=0 \
  "$HEIF/build-emscripten.sh" "$HEIF"
for item in libheif.js libheif.wasm libheif.d.ts; do test -s "$BUILD/$item"; done
mkdir -p "$STAGE/package/libheif" "$STAGE/package/libheif-wasm"
cp "$BUILD/libheif.js" "$BUILD/libheif.d.ts" "$STAGE/package/libheif/"
cp "$BUILD/libheif.js" "$BUILD/libheif.d.ts" "$BUILD/libheif.wasm" "$STAGE/package/libheif-wasm/"
tar -czf "$STAGE/updated-build.tar.gz" -C "$STAGE/package" libheif libheif-wasm
cd "$PACKAGER"
npm install --no-package-lock --ignore-scripts --no-audit --no-fund
node scripts/install.js "$STAGE/updated-build.tar.gz"
test -s "$PACKAGER/libheif-wasm/libheif-bundle.mjs"
mkdir -p "$ROOT/third_party/libheif-js"
cp "$PACKAGER/libheif-wasm/libheif-bundle.mjs" "$ROOT/third_party/libheif-js/libheif-bundle.mjs"
sha256sum "$ROOT/third_party/libheif-js/libheif-bundle.mjs"
echo "P9 private secure-version candidate rebuilt, NOT authorized for deployment."
