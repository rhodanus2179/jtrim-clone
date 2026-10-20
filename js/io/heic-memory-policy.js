import { isHeicCandidate, inspectHeifFtyp } from "./image-format.js";

export const HEIC_COMPRESSED_WARNING_BYTES = 2 * 1024 * 1024;
export const HEIC_PIXEL_WARNING_THRESHOLD = 12_000_000;
export const HEIC_HEADER_READ_BYTES = 256 * 1024;

// HEIF dimensions live in the item properties container: meta/iprp/ipco/ispe.
// Inspect a bounded prefix and choose the largest valid spatial extent rather
// than trusting the first property (which might describe a thumbnail/tile).
// This is only a *memory warning heuristic*, not a file validation decoder.
export function inspectHeicSpatialExtents(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (inspectHeifFtyp(data).family !== "hevc") return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const cc = offset => String.fromCharCode(...data.subarray(offset, offset + 4));
  let largest = null;
  function walk(start, end, depth) {
    if (depth > 6) return;
    let offset = start;
    while (offset + 8 <= end) {
      const rawSize = view.getUint32(offset);
      let size = rawSize, header = 8;
      if (rawSize === 1) {
        if (offset + 16 > end) return;
        const value = view.getBigUint64(offset + 8);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) return;
        size = Number(value);
        header = 16;
      } else if (rawSize === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) break;
      const type = cc(offset + 4);
      if (type === "ispe" && size >= header + 12) {
        const width = view.getUint32(offset + header + 4);
        const height = view.getUint32(offset + header + 8);
        const pixels = width * height;
        if (width > 0 && height > 0 && Number.isSafeInteger(pixels)
          && (!largest || pixels > largest.pixels)) largest = { width, height, pixels };
      } else if (type === "meta" || type === "iprp" || type === "ipco") {
        const childStart = offset + header + (type === "meta" ? 4 : 0);
        if (childStart <= offset + size) walk(childStart, offset + size, depth + 1);
      }
      offset += size;
    }
  }
  walk(0, data.length, 0);
  return largest;
}

export function shouldWarnHeicMemory(file, thresholdBytes = HEIC_COMPRESSED_WARNING_BYTES) {
  return isHeicCandidate(file) && Number.isFinite(file?.size) && file.size >= thresholdBytes;
}

// Called before the original image is decoded. Even tiny HEIC files can
// expand into hundreds of MiB; inspect metadata instead of assuming a small
// compressed byte length implies low memory usage.
export async function shouldWarnHeicMemoryBeforeOpen(file) {
  if (!isHeicCandidate(file)) return false;
  if (shouldWarnHeicMemory(file)) return true;
  if (typeof file.slice !== "function") return true;
  try {
    const prefix = await file.slice(0, HEIC_HEADER_READ_BYTES).arrayBuffer();
    const dimensions = inspectHeicSpatialExtents(prefix);
    // The ispe box can be absent/outside the bounded prefix; warn when unknown.
    if (!dimensions) return true;
    return dimensions.pixels >= HEIC_PIXEL_WARNING_THRESHOLD ||
      Math.max(dimensions.width, dimensions.height) >= 10_000;
  } catch {
    return true;
  }
}

export function heicMemoryWarningMessage() {
  return "このHEIC/HEIF写真は解像度が大きい、または画像の大きさを確認できません。"
    + "圧縮ファイルが小さくても、展開時には数百MiB以上のメモリを使うことがあります。"
    + "ブラウザが重くなる可能性がありますが、読み込みますか？";
}
