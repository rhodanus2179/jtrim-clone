export class CodecError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "CodecError";
    this.code = code;
    this.detail = detail;
  }
}

export class CodecClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("../worker/codec-worker.js", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", event => {
      const { id, ok, payload, error } = event.data || {};
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (ok) pending.resolve(payload);
      else pending.reject(new CodecError(
        error?.code || "CODEC_FAILED",
        error?.message || "高度コーデック処理に失敗しました",
        error?.detail || null
      ));
    });
    this.worker.addEventListener("error", event => {
      for (const { reject } of this.pending.values()) {
        reject(new CodecError("CODEC_WORKER_FAILED", event.message || "Codec Worker failed"));
      }
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    });
    return this.worker;
  }

  request(operation, payload, transfer = []) {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, operation, payload }, transfer);
    });
  }

  async jpegTransform(blob, options = {}) {
    const buffer = await blob.arrayBuffer();
    const result = await this.request("jpeg-transform", {
      bytes: buffer,
      options
    }, [buffer]);
    return {
      blob: new Blob([result.bytes], { type: "image/jpeg" }),
      stderr: result.stderr || ""
    };
  }

  async jpegTranscode(blob, options = {}) {
    const buffer = await blob.arrayBuffer();
    const result = await this.request("jpeg-transcode", {
      bytes: buffer,
      options
    }, [buffer]);
    return {
      blob: new Blob([result.bytes], { type: "image/jpeg" }),
      stderr: result.stderr || ""
    };
  }

  async jpegEncode(imageData, options = {}) {
    if (!imageData?.data || !imageData.width || !imageData.height) {
      throw new TypeError("jpegEncode requires ImageData-compatible input");
    }
    const copy = new Uint8Array(imageData.data.byteLength);
    copy.set(new Uint8Array(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength
    ));
    const buffer = copy.buffer;
    const result = await this.request("jpeg-encode", {
      rgba: buffer,
      width: imageData.width,
      height: imageData.height,
      options
    }, [buffer]);
    return {
      blob: new Blob([result.bytes], { type: "image/jpeg" }),
      stderr: result.stderr || ""
    };
  }

  async pngEncode(imageData, options = {}) {
    if (!imageData?.data || !imageData.width || !imageData.height) {
      throw new TypeError("pngEncode requires ImageData-compatible input");
    }
    const copy = new Uint8Array(imageData.data.byteLength);
    copy.set(new Uint8Array(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength
    ));
    const buffer = copy.buffer;
    const result = await this.request("png-encode", {
      rgba: buffer,
      width: imageData.width,
      height: imageData.height,
      options
    }, [buffer]);
    return {
      blob: new Blob([result.bytes], { type: "image/png" }),
      errorCode: result.errorCode || 0
    };
  }

  async probe() {
    return await this.request("probe", {});
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
