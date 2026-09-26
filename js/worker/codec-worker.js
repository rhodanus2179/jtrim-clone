import { jpegtranArgumentsForOperation } from "../codecs/jpeg-orientation.js";

const MAX_COMPRESSED_BYTES = 512 * 1024 * 1024;
let jpegtranFactoryPromise = null;
let cjpegFactoryPromise = null;
const MAX_PIXELS = 180_000_000;

function fail(code, message, detail = null) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail;
  throw error;
}

async function loadJpegtranFactory() {
  if (!jpegtranFactoryPromise) {
    jpegtranFactoryPromise = import("../codecs/generated/jpegtran-module.js")
      .then(module => module.default)
      .catch(error => {
        jpegtranFactoryPromise = null;
        fail(
          "CODEC_INIT_FAILED",
          "JPEGロスレスコーデックを読み込めませんでした。生成済みWASMモジュールが必要です。",
          error?.message || String(error)
        );
      });
  }
  return await jpegtranFactoryPromise;
}

async function loadCjpegFactory() {
  if (!cjpegFactoryPromise) {
    cjpegFactoryPromise = import("../codecs/generated/cjpeg-module.js")
      .then(module => module.default)
      .catch(error => {
        cjpegFactoryPromise = null;
        fail(
          "CODEC_INIT_FAILED",
          "Progressive JPEGエンコーダを読み込めませんでした。生成済みWASMモジュールが必要です。",
          error?.message || String(error)
        );
      });
  }
  return await cjpegFactoryPromise;
}

function rgbaToPpm(rgbaBuffer, width, height) {
  const rgba = new Uint8Array(rgbaBuffer);
  if (rgba.length !== width * height * 4) {
    fail("JPEG_INVALID_INPUT", "RGBAバッファサイズが画像寸法と一致しません。");
  }
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  const ppm = new Uint8Array(header.length + width * height * 3);
  ppm.set(header, 0);
  let src = 0;
  let dst = header.length;
  while (src < rgba.length) {
    const a = rgba[src + 3] / 255;
    ppm[dst] = Math.round(rgba[src] * a + 255 * (1 - a));
    ppm[dst + 1] = Math.round(rgba[src + 1] * a + 255 * (1 - a));
    ppm[dst + 2] = Math.round(rgba[src + 2] * a + 255 * (1 - a));
    src += 4;
    dst += 3;
  }
  return ppm;
}

async function runCjpeg(rgbaBuffer, width, height, {
  quality = 92,
  progressive = false,
  optimize = true
} = {}) {
  width = Math.trunc(Number(width));
  height = Math.trunc(Number(height));
  if (width < 1 || height < 1 || width > 30000 || height > 30000 || width * height > MAX_PIXELS) {
    fail("JPEG_MEMORY_LIMIT", "画像サイズが高度JPEGエンコーダの安全上限を超えています。");
  }
  quality = Math.max(1, Math.min(100, Math.round(Number(quality) || 92)));

  const createCjpeg = await loadCjpegFactory();
  const stderr = [];
  const module = await createCjpeg({
    noInitialRun: true,
    print: () => {},
    printErr: line => stderr.push(String(line))
  });
  module.FS.writeFile("/input.ppm", rgbaToPpm(rgbaBuffer, width, height));
  const args = ["-quality", String(quality)];
  if (progressive) args.push("-progressive");
  if (optimize) args.push("-optimize");
  args.push("-outfile", "/output.jpg", "/input.ppm");

  try {
    module.callMain(args);
  } catch (error) {
    fail(
      "JPEG_ENCODE_FAILED",
      "JPEGエンコードに失敗しました。",
      stderr.join("\n") || error?.message || String(error)
    );
  }

  let output;
  try {
    output = module.FS.readFile("/output.jpg");
  } catch {
    fail("JPEG_ENCODE_FAILED", "JPEGエンコード結果を取得できませんでした。", stderr.join("\n"));
  }

  return {
    bytes: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength),
    stderr: stderr.join("\n")
  };
}

function classifyJpegtranFailure(stderr) {
  const text = String(stderr || "");
  if (/perfect transformation is not possible|transformation is not perfect|not perfect/i.test(text)) {
    return {
      code: "JPEG_NOT_PERFECT",
      message: "このJPEGは端のブロックまで完全にはロスレス変換できません。",
      detail: text
    };
  }
  if (/too many scans|maxscans/i.test(text)) {
    return {
      code: "JPEG_TOO_MANY_SCANS",
      message: "Progressive JPEGのscan数が安全上限を超えています。",
      detail: text
    };
  }
  return {
    code: "JPEG_TRANSFORM_FAILED",
    message: "JPEGロスレス変換に失敗しました。",
    detail: text
  };
}

async function runJpegtran(sourceBuffer, {
  operation = "identity",
  edgePolicy = "perfect",
  progressive = "preserve",
  copyMarkers = true
} = {}) {
  if (!(sourceBuffer instanceof ArrayBuffer)) fail("JPEG_INVALID_INPUT", "JPEG入力が不正です。");
  if (sourceBuffer.byteLength > MAX_COMPRESSED_BYTES) {
    fail("JPEG_MEMORY_LIMIT", "JPEGファイルが高度コーデックの入力上限を超えています。");
  }

  const createJpegtran = await loadJpegtranFactory();
  const stderr = [];
  const module = await createJpegtran({
    noInitialRun: true,
    print: () => {},
    printErr: line => stderr.push(String(line))
  });

  module.FS.writeFile("/input.jpg", new Uint8Array(sourceBuffer));
  const args = [];
  if (copyMarkers) args.push("-copy", "all");
  args.push("-maxmemory", "512m", "-maxscans", "100");

  if (edgePolicy === "perfect") args.push("-perfect");
  else if (edgePolicy === "trim") args.push("-trim");

  args.push(...jpegtranArgumentsForOperation(operation));

  if (progressive === true) args.push("-progressive");
  args.push("-outfile", "/output.jpg", "/input.jpg");

  try {
    module.callMain(args);
  } catch (error) {
    const classified = classifyJpegtranFailure(stderr.join("\n") || error?.message);
    fail(classified.code, classified.message, classified.detail);
  }

  let output;
  try {
    output = module.FS.readFile("/output.jpg");
  } catch {
    const classified = classifyJpegtranFailure(stderr.join("\n"));
    fail(classified.code, classified.message, classified.detail);
  }

  const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  return { bytes, stderr: stderr.join("\n") };
}

self.addEventListener("message", async event => {
  const { id, operation, payload } = event.data || {};
  try {
    let result;
    if (operation === "probe") {
      const jpegtran = await loadJpegtranFactory();
      result = { jpegtran: typeof jpegtran === "function" };
    } else if (operation === "jpeg-transform") {
      result = await runJpegtran(payload.bytes, payload.options || {});
    } else if (operation === "jpeg-transcode") {
      result = await runJpegtran(payload.bytes, {
        ...(payload.options || {}),
        operation: "identity",
        edgePolicy: "none"
      });
    } else if (operation === "jpeg-encode") {
      result = await runCjpeg(
        payload.rgba,
        payload.width,
        payload.height,
        payload.options || {}
      );
    } else {
      fail("CODEC_UNKNOWN_OPERATION", `Unknown codec operation: ${operation}`);
    }

    const transfer = result?.bytes instanceof ArrayBuffer ? [result.bytes] : [];
    self.postMessage({ id, ok: true, payload: result }, transfer);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        code: error?.code || "CODEC_FAILED",
        message: error?.message || String(error),
        detail: error?.detail || null
      }
    });
  }
});
