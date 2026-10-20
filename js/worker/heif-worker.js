import { decodeHeifWithApi, HeifDecodeError } from "../codecs/heif-decode-core.js";
import { resolveHeifModule } from "../codecs/resolve-heif-module.js";

let libheifPromise = null;
async function getHeifApi() {
  if (!libheifPromise) {
    // File is intentionally absent until its distribution obligations are reviewed.
    // No runtime CDN dependency or HEIC payload upload.
    libheifPromise = import("../../third_party/libheif-js/libheif-bundle.mjs")
      .then(resolveHeifModule)
      .catch(error => {
        libheifPromise = null;
        throw new HeifDecodeError("HEIF_CODEC_UNAVAILABLE",
          "HEICデコーダーはまだ配布されていません。", error?.message || String(error));
      });
  }
  return await libheifPromise;
}

self.addEventListener("message", async event => {
  const { id, operation, buffer } = event.data || {};
  if (operation !== "heif-decode") return;
  try {
    const api = await getHeifApi();
    const result = await decodeHeifWithApi(api, new Uint8Array(buffer));
    self.postMessage({ id, ok: true, payload: result }, [result.buffer]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: {
      code: error?.code || "HEIF_DECODE_FAILED",
      message: error?.message || "HEIC画像を読み込めませんでした。",
      detail: error?.detail || null
    } });
  }
});
