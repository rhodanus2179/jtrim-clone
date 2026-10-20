// Decoder adapter is dependency-injected to permit CI tests without a vendor binary.
export const HEIF_LIMITS = Object.freeze({
  maxCompressedBytes: 100 * 1024 * 1024,
  maxWidth: 16384,
  maxHeight: 16384,
  maxPixels: 50_000_000
});

export class HeifDecodeError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "HeifDecodeError";
    this.code = code;
    this.detail = detail;
  }
}

export function assertHeifDimensions(width, height, limits = HEIF_LIMITS) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    width <= 0 || height <= 0 || width > limits.maxWidth ||
    height > limits.maxHeight || width * height > limits.maxPixels) {
    throw new HeifDecodeError("HEIF_DIMENSION_LIMIT", "HEIC画像のサイズが安全上限を超えています。");
  }
  return width * height * 4;
}

export async function decodeHeifWithApi(api, bytes, { limits = HEIF_LIMITS } = {}) {
  if (!(bytes instanceof Uint8Array)) {
    throw new HeifDecodeError("HEIF_INVALID_INPUT", "HEIF入力データが不正です。");
  }
  if (!bytes.byteLength || bytes.byteLength > limits.maxCompressedBytes) {
    throw new HeifDecodeError("HEIF_INPUT_LIMIT", "HEICファイルが大きすぎるか空です。");
  }
  if (typeof api?.HeifDecoder !== "function") {
    throw new HeifDecodeError("HEIF_CODEC_UNAVAILABLE", "HEICデコーダーが読み込めませんでした。");
  }
  let images;
  try {
    const decoder = new api.HeifDecoder();
    images = decoder.decode(bytes);
  } catch (error) {
    throw new HeifDecodeError("HEIF_DECODE_FAILED", "HEIC画像を解析できませんでした。", error?.message || String(error));
  }
  // First image selection follows the upstream high-level API example.
  // Primary-image/auxiliary-image semantics still require real-WASM testing.
  const image = images?.[0];
  if (!image) throw new HeifDecodeError("HEIF_NO_IMAGE", "HEICファイルに表示可能な画像がありません。");
  const width = image.get_width();
  const height = image.get_height();
  const length = assertHeifDimensions(width, height, limits);
  const output = { data: new Uint8ClampedArray(length), width, height };
  return await new Promise((resolve, reject) => {
    let settled = false;
    const success = data => {
      if (settled) return;
      settled = true;
      if (!data?.data || data.width !== width || data.height !== height ||
        data.data.byteLength !== length) {
        reject(new HeifDecodeError("HEIF_DISPLAY_FAILED", "HEIC画像の画素展開に失敗しました。"));
        return;
      }
      const rgba = data.data;
      const direct = rgba.buffer instanceof ArrayBuffer &&
        rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength;
      resolve({ width, height,
        buffer: direct ? rgba.buffer : new Uint8ClampedArray(rgba).buffer,
        numberOfImages: images.length });
    };
    try {
      image.display(output, success);
    } catch (error) {
      if (!settled) {
        settled = true;
        reject(new HeifDecodeError("HEIF_DISPLAY_FAILED", "HEIC画像の画素展開に失敗しました。", error?.message || String(error)));
      }
    }
  });
}
