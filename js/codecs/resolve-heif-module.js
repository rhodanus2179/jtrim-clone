import { HeifDecodeError } from "./heif-decode-core.js";

// Emscripten build variants may expose a decoder object or an async module factory.
export async function resolveHeifModule(imported) {
  let candidate = await imported;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (typeof candidate?.HeifDecoder === "function") return candidate;
    if (candidate?.default != null) {
      candidate = await candidate.default;
    } else if (typeof candidate === "function") {
      candidate = await candidate();
    } else {
      break;
    }
  }
  throw new HeifDecodeError("HEIF_CODEC_INIT_FAILED",
    "HEICデコーダーの初期化に失敗しました。",
    "Upstream module does not expose HeifDecoder");
}
