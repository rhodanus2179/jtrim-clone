# P4 | HEIC licensing, source provenance and release decision

Date: 2026-10-20. Built atop PR #5. **Decision: HOLD — no public WASM vendoring or main deployment.**

## Verified source correspondence (build inputs, not legal certification)

| Component | Version/commit | Evidence |
|---|---|---|
| libheif-js npm | 1.23.5, ESM bundle SHA-256 `095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9` | P2 Chromium test, npm package |
| libheif-js packaging source | `d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d` | repository master snapshot; **package/source equivalence not proved** |
| libheif-emscripten | tag v1.23.5 at `5c8968a44e9c68ae677e24790d77d001ed7fe7cc` | upstream tagged release workflow |
| libheif C library | `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00` | pinned submodule and v1.23.5 tag |
| libde265 | tag v1.0.15 at `17bb8d9fcea62db8cdeb0fc7ef8d15dbd19a22e4` | `libheif/build-emscripten.sh` default `LIBDE265_VERSION=1.0.15` |
| Emscripten | 3.1.61 | `libheif-emscripten/.github/workflows/emscripten.yml` |

The `libheif-js` packaging script fetches the `libheif-emscripten` tagged release, then bundles JavaScript/WASM into a standalone ESM file. The npm artifact SHA is verified; exact source-to-binary reproducibility **has not** been independently proven.

## Development/verification path

- Run `node tests/heic-release-gate-smoke.mjs`: confirms fail-closed release policy.
- Run `bash tools/heic/stage-review.sh /tmp/heic-review` in a networked checkout.
- This fetches npm `libheif-js 1.23.5`, validates bundle SHA-256, and checks out each of four source projects at its exact commit SHA.
- Files remain in an **unpublished local review directory**, with license texts and build scripts. GitHub Actions uses runner-only temporary files and **does not publish** source/binary/photo artifacts.
- `node tools/heic/release-gate.mjs --assert-release` must fail until independent review flags, approver, and source/install evidence are recorded.

## LGPL-3.0 gates (unresolved)

GNU LGPL-3.0 §4 can impose requirements concerning LGPL/GPL texts, Minimal Corresponding Source, Corresponding Application Code, and how a user can relink against a modified library. This app uses a separate static ESM file, **not** an operating-system installed shared library; do not automatically assume LGPL §4(d)(1) shared-library exemption. It needs legal review of whether the proposed source and replaceability model satisfies §4(d)(0). HEVC patents/royalties require separate advice.

Before release, document and test:
1. Source-to-NPM-binary correspondence, version-matched full source, build tools, build flags, and licenses for all compiled dependencies.
2. Locally replace `third_party/libheif-js/libheif-bundle.mjs` with a modified compatible library and run Chromium decoding with it. Record installation/overrides steps and source downloads available with the deployed app.
3. Real 24.5MP image **full UI** (not just isolated Canvas), Edge, peak-memory behavior and ICC/P3 handling.
4. Copyright/license signoff and HEVC patent/commercial licensing assessment with named reviewer.
5. Update `docs/heic-release-manifest.json` evidence only after each check actually passes; never merely set approval booleans to satisfy CI.

## PR merging and release decision

PR #1 → #2 → #3 → #4 → #5 → P4 remain drafts. P4 source-provenance work does not itself unlock production. The original public app remains unaffected. Do not commit personal HEIC originals or EXIF to this repository.

Compliance checklist is a technical control, **not legal advice**. Relevant primary license: https://www.gnu.org/licenses/lgpl-3.0.html
