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
