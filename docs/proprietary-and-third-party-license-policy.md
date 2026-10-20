# Proprietary application and third-party licenses

The JTrim Clone owner has directed that the **original application code
remains proprietary**. Its root [LICENSE](../LICENSE) expresses reserved
rights while allowing normal use of a publicly hosted instance.

The application license does **not** replace third-party licenses:

| Component | License / rights inherited | Evidence |
| --- | --- | --- |
| JTrim Web original HTML/CSS/JS | Proprietary, rights reserved | [LICENSE](../LICENSE) |
| libjpeg-turbo 3.2.0 | IJG, BSD-3-Clause and zlib as applicable | `third_party/libjpeg-turbo/LICENSE.md`, `README.ijg` |
| libspng 0.7.4 | BSD-2-Clause and upstream component-specific terms | `third_party/libspng/LICENSE` |
| zlib | zlib License | `third_party/zlib/LICENSE` |
| libheif-js 1.23.5, libheif, libde265 | LGPL-3.0 and component-dependent terms — NOT YET DEPLOYED | [HEIC release gate](heic-heif-distribution-gate.md) |
| Original JTrim / WoodyBells | Outside this app's license | Unofficial implementation, no rights asserted |

**Existing codec notices and corresponding files must remain available**
when their binaries are delivered. The "This software is based in part on
the work of the Independent JPEG Group" attribution is retained.

### Normal users versus developers

Normal users do not need to download or replace a library. The About dialog
provides links to this app notice and the third-party notices. Developers may
inspect the sources and independently exercise their rights in components
covered by open licenses.

### Important HEIC conditions

GNU LGPL-3.0 section 4 allows a combined work under other application terms
only if the combined terms preserve the library modification and permitted
debugging rights, with required notices, license texts, corresponding source,
and an appropriate relinking or shared library mechanism. Whether this
project's future static WASM deployment meets those conditions is a separate
technical/legal determination; the current PR does not approve distribution.

See https://www.gnu.org/licenses/lgpl-3.0.html .
HEVC patent/commercial licensing remains subject to separate review.

No individual or corporation is designated here as sole copyright owner
without confirming the actual chain of title. No additional bespoke paid
licensing, indemnity, EULA or warranty terms are invented.
