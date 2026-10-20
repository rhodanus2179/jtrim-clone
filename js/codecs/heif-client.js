import { HeifDecodeError, HEIF_LIMITS } from "./heif-decode-core.js";

// Not yet wired into the image I/O pipeline: wait for license-approved vendor module.
export class HeifClient {
  constructor({ workerFactory = () => new Worker(new URL("../worker/heif-worker.js", import.meta.url), { type: "module" }) } = {}) {
    this.workerFactory = workerFactory;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
  }
  ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    this.worker = worker;
    worker.addEventListener("message", event => {
      const { id, ok, payload, error } = event.data || {};
      const job = this.pending.get(id);
      if (!job) return;
      this.pending.delete(id);
      if (ok) job.resolve(payload);
      else job.reject(new HeifDecodeError(
        error?.code || "HEIF_DECODE_FAILED",
        error?.message || "HEIC画像を読み込めませんでした.",
        error?.detail || null
      ));
    });
    const failWorker = (code, message) => {
      this.failAll(new HeifDecodeError(code, message));
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    worker.addEventListener("error", event => {
      failWorker("HEIF_WORKER_FAILED", event.message || "HEIC Workerでエラーが発生しました。");
    });
    worker.addEventListener("messageerror", () => {
      failWorker("HEIF_WORKER_MESSAGE_ERROR", "HEIC Workerの受信データが不正です。");
    });
    return worker;
  }
  failAll(error) {
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
  }
  async decode(file) {
    if (!file || !Number.isFinite(file.size) || file.size > HEIF_LIMITS.maxCompressedBytes || file.size === 0) {
      throw new HeifDecodeError("HEIF_INPUT_LIMIT", "HEICファイルが大きすぎるか空です。");
    }
    const buffer = await file.arrayBuffer();
    const id = this.nextId++;
    const worker = this.ensureWorker();
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, operation: "heif-decode", buffer }, [buffer]);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new HeifDecodeError("HEIF_WORKER_DISPOSED", "HEIC Workerが終了しました。"));
  }
}
