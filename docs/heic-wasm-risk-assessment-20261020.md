# HEIC WASM — licensing, patents, security: release assessment (2026-10-20)

**Decision: DO NOT ship the currently pinned WASM.** This is a primary-source
technical risk review, *not* a legal clearance or an assertion that a royalty
is definitely owed. Keep the app's `main` and GitHub Pages version unchanged.

## Reproducibly identified component versions

| Component | Current embedded version / evidence | License source |
| --- | --- | --- |
| `libheif-js 1.23.5` | npm ESM SHA-256 `095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9` | LGPL-3.0 in package `LICENSE` |
| `libheif 1.23.5` | pinned repository commit `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00` | LGPL-3.0 in upstream `COPYING` |
| `libde265 1.0.15` | pinned upstream tag and compiler script default, `build-emscripten.sh` | LGPL-3.0 in upstream `COPYING` |

P6 proved that a **modified LGPL source** can be compiled into a WASM decoder
and used by Chromium. That establishes technical feasibility, not legal or
patent authorization. The three libraries' licenses are separate from the
JTrim proprietary app notice. Under LGPL-3.0 section 4 a combined work may use
other application terms if its copyright license obligations are actually met.
Full license text: https://www.gnu.org/licenses/lgpl-3.0.html

## BLOCKER A: obsolete decoder/security advisories

- The current embedded `libde265 1.0.15` is vulnerable to later-documented
  memory-corruption bugs. Upstream advisory
  https://github.com/strukturag/libde265/security/advisories/GHSA-653q-9f73-8hvg
  identifies versions <= 1.0.16 as affected and >= 1.0.17 as patched for **that**
  issue. Further security fixes arrived in v1.0.19 and v1.1.x.
- As of 2026-10-20 the latest upstream `libde265` release is
  [v1.1.3](https://github.com/strukturag/libde265/releases/tag/v1.1.3),
  released 2026-09-14. A new build should evaluate this baseline or later
  security-supported versions; minimum version alone is **not** a vulnerability audit.
- `libheif 1.23.6` is the newer security release (2026-10-05) replacing
  the embedded 1.23.5. Upstream lists multiple fixes, with four rated high:
  https://github.com/strukturag/libheif/releases/tag/v1.23.6 .
  Not every fix is reachable in the JTrim build (the current Emscripten
  configuration disables some non-HEVC plugins). Confirm the actual reachable
  components and binary build; do not assume the release is immune.
- The current upstream `libheif` Emscripten script defaults to **libde265 1.0.15**
  and downloads its release tarball. **Version pinning alone is not integrity
  verification**; the tarball needs a pinned SHA-256 and source-to-build audit.
- From `libde265 v1.0.17`, its upstream release removed autotools from
  tarballs; the existing `build-emscripten.sh` is autotools-based, so simply
  changing the version number can fail. Plan and test an adapted CMake-based
  build; do not change the manifest version without rebuilding the actual WASM.

Before shipment: rebuild and test a newer library combination in Chromium,
Edge, the private HEIC originals, malformed inputs, 24.5MP memory, and
the complete JTrim UI. The source, build flags and WASM hash must identify
**the binaries actually distributed**.

## BLOCKER B: independent HEVC patent licensing (including free web apps)

Access Advance explicitly describes HEVC decoders in devices, **software and
cloud services** within its licensing scope:
https://accessadvance.com/topic-what-do-we-license/

Its FAQ says HEVC software downloaded for free **generally requires a license**
although exceptions are possible; it recommends contacting the administrator
about the specific service:
https://accessadvance.com/faq/

This does NOT establish that JTrim's particular free client-side, fully
local-in-browser HEIC still-image reader requires payment or that every country
has relevant unexpired patent claims. It means **we cannot treat 'free',
'open source', 'static GitHub Pages', or 'browser-side' as automatic exemptions.**

Also examine the separate **VCL Advance** HEVC/VVC licensing program. Via LA's
program was acquired by Access Advance effective 2025-12-15:
https://accessadvance.com/licensing-programs/vcl-advance/
The pool programs and their grants are not presumed identical.

Before authorizing CDN/static deployment, get a documented specialist or
patent-pool determination for the specific service, distribution territories
(including Japan), planned use and payment model. Suggested questions to the
appropriate licensors / Japanese patent professional:

1. Does a publicly accessible, free GitHub Pages app that delivers a 2MiB
   HEVC decoding WASM into the browser, decoding only user-selected HEIC still
   images locally (no upload, video streaming or encoding) fall within your
   pool's software-distribution or cloud-service licensing scope?
2. Is a license required if all processing occurs locally and there is no
   paid product, advertisement revenue, user account or on-server decoding?
   What changes if monetization is added later?
3. Do any royalty-free thresholds, developer exemptions, jurisdiction-specific
   patent expirations or existing platform/SDK licenses apply?
4. If a license is required, what are the eligible contract, measurement and
   territorial reporting arrangements? Does a separate HEVC pool need review?
5. Which entity would be responsible for obtaining the authorization?

**Do not contact a patent pool or represent that approval was granted without
an authorized user/company decision.**

## Required LGPL publication evidence, independent of patents

- Reproduce/cite the exact pinned LGPL-3.0 AND GNU GPLv3 full texts.
- Audit third-party transitive source/license files and corresponding source
  for the actual security-updated WASM; publish accessible source and
  rebuilding/replacement instructions, with the combined-work app code terms.
- Document the actual deployed standalone ESM interface so specialist users
  can recombine an interface-compatible modified LGPL library.
- Display notices in the deployed application, retain upstream attributions,
  and obtain confirmation that the bespoke app terms preserve LGPL §4 rights.
- Record named copyright/legal reviewers' decisions, evidence links, SHA-256
  and build/source provenance; do not approve merely by editing a flag.

## Enforced release controls

- `tools/heic/security-policy.mjs` refuses old embedded libheif/libde265
  versions with thresholds as at 2026-10-20.
- `tools/heic/release-gate.mjs` additionally requires independent
  `decoderSecurityAudit: approved`; the current release remains on HOLD.
- `tools/heic/block-unapproved-deployment.mjs` fails CI if the expected
  vendor bundle is committed without every release gate requirement fulfilled.
- Neither a passing unit test nor a compatibility check constitutes legal
  advice, freedom-to-operate, or a guarantee of security.
