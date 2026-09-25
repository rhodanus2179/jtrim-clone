export class ImageWorkerClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.worker = new Worker(new URL("./image-worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = event => {
      const { id, error, width, height, buffer, resultType, payload } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (error) {
        pending.reject(new Error(error));
        return;
      }
      if (resultType === "histogram") {
        pending.resolve(payload);
        return;
      }
      pending.resolve(new ImageData(new Uint8ClampedArray(buffer), width, height));
    };
    this.worker.onerror = error => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  run(operation, imageData, params = {}) {
    const id = this.nextId++;
    // Transfer a dedicated copy so callers can keep using their ImageData for preview.
    const pixels = new Uint8ClampedArray(imageData.data);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({
        id,
        operation,
        width: imageData.width,
        height: imageData.height,
        buffer: pixels.buffer,
        params
      }, [pixels.buffer]);
    });
  }

  terminate() {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error("Worker terminated"));
    this.pending.clear();
  }
}
