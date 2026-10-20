# HEIC P1 — app-side integration (WASM vendor pending)

2026-10-20. Implements the common HEIC decode path and image UI support, **but does not ship the decoder**.

## Integration

- Native `createImageBitmap` first; on HEIC native failure detect HEVC `ftyp` then use the P0b Worker.
- Accept HEIC/HEIF across file input, drag/drop, folder browsing, preview/slide, batch conversion, and auxiliary image composition. Handle empty HEIC MIME.
- One HEIC thumbnail decode at a time. Generate 480px thumbs and 2048px slideshow previews, with object URL cleanup. JPEG/PNG/WebP retain their original lightweight path.
- A HEIC source is never an allowed Ctrl+S overwrite format; users must Save As JPEG/PNG/WebP.
- No user Drive originals or EXIF were committed to this public repo.

## CRITICAL — outstanding release gate

The Worker references `third_party/libheif-js/libheif-bundle.mjs`, which is intentionally absent. `tools/vendor-libheif-js.sh` installs the version-pinned upstream ESM asset **manually**; review license and LGPL source/replacement obligations before committing/distributing. There is no runtime CDN.

The new Node tests validate native decoding and plumbing, **not** HEIC WASM decoding. A successful CI does not mean Chrome can decode HEIC. Real browser tests with the private 24.5MP user files are still required, including 270-degree transform/Exif orientation, embedded ICC, memory, Save As/overwrite behavior, and the two-file gallery/batch. Peak memory may exceed the ~93 MiB RGBA frame size due to worker and canvas copies.

## Next release steps

1. Install the upstream bundle on an internet-enabled developer machine and record SHA-256.
2. Audit exact upstream sources, transitive licenses, and LGPL-3.0 replacement instructions; copy notices.
3. Run headless Chromium/Edge browser tests with **private fixture files only**.
4. Verify visible orientation, color and batch results, then review/merge PRs in order.
