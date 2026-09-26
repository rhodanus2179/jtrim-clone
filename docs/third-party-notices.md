# Third-party notices

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
