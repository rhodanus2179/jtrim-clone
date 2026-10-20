import { isHeicCandidate } from "./image-format.js";

// Only a cautious *proxy*: compressed HEIC file size cannot reveal pixel count.
// At/above 2 MiB, remind users of potentially large decoded RGBA allocation.
export const HEIC_COMPRESSED_WARNING_BYTES = 2 * 1024 * 1024;

export function shouldWarnHeicMemory(file, thresholdBytes = HEIC_COMPRESSED_WARNING_BYTES) {
  return isHeicCandidate(file)
    && Number.isFinite(file?.size)
    && file.size >= thresholdBytes;
}

export function heicMemoryWarningMessage() {
  return "このHEIC/HEIF写真は圧縮サイズが2MiB以上です。"
    + "高解像度の写真は展開時に数百MiB以上のメモリを使い、"
    + "ブラウザが重くなる場合があります。読み込みますか？";
}
