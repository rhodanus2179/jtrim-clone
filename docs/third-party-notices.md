# Third-party notices

This document records separately licensed third-party components. The original
application is proprietary under [../LICENSE](../LICENSE). The app license
does not replace or restrict upstream license rights; see
[license scope](proprietary-and-third-party-license-policy.md).


## libjpeg-turbo

The advanced JPEG codec uses **libjpeg-turbo 3.2.0**, compiled to WebAssembly for browser execution.

- Project: https://github.com/libjpeg-turbo/libjpeg-turbo
- Version: 3.2.0
- License expression: IJG AND BSD-3-Clause AND Zlib

The complete upstream license text and IJG notice are stored under:

- `third_party/libjpeg-turbo/LICENSE.md`
- `third_party/libjpeg-turbo/README.ijg`

This software is based in part on the work of the Independent JPEG Group.

The generated browser module is produced reproducibly by `.github/workflows/rebuild-codecs.yml` from the pinned upstream source archive and checksum in `tools/wasm/versions.json`.


## libspng

The Adam7 PNG codec uses the **libspng 0.7.4** source bundled in the pinned libjpeg-turbo 3.2.0 source tree, compiled to WebAssembly together with the browser PNG wrapper.

- License: BSD-2-Clause
- License text: `third_party/libspng/LICENSE`

## zlib

The browser PNG codec also uses the zlib source bundled with libspng in the same pinned source tree.

- License text: `third_party/zlib/LICENSE`

Both PNG dependencies are copied by `.github/workflows/rebuild-codecs.yml` from the same verified libjpeg-turbo source archive used for the JPEG codec build.


## HEIC/HEIF decoder (planned, NOT YET DISTRIBUTED)

The HEIC input code optionally loads `libheif-js 1.23.5` (LGPL-3.0) using a locally deployed ES module. **This repository does not yet include that binary in the default branch or current draft changes.** The test workflow downloads an unmodified copy for testing only and deletes it after the isolated job.

- Upstream package: https://github.com/catdad-experiments/libheif-js
- Emscripten build source: https://github.com/catdad-experiments/libheif-emscripten
- Underlying source projects: https://github.com/strukturag/libheif and https://github.com/strukturag/libde265
- Binary evaluated: `libheif-wasm/libheif-bundle.mjs`, SHA-256 `095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9`
- Local evaluation vendor script: `tools/vendor-libheif-js.sh`
- Distribution approval checklist: `docs/heic-heif-distribution-gate.md`

A notice and upstream links alone do **not** establish compliance with LGPL-3.0. Do not publicly deploy the WASM module until the corresponding source, license documents, replacement/relinking method and HEVC patent review are completed.

開発者向けの対応ソースと審査用パッケージ生成手順は [P7ガイド](heic-p7-developer-source-guide.md) を参照してください。これは技術的な審査候補であり、LGPLの遵守やWASMの公開を承認したものではありません。本体の独自ライセンスはルート `LICENSE` に記載していますが、第三者コードの原ライセンスを変更するものではありません。
