import assert from "node:assert/strict";
import { decodeHeifWithApi, assertHeifDimensions, HEIF_LIMITS } from "../js/codecs/heif-decode-core.js";
import { HeifClient } from "../js/codecs/heif-client.js";

assert.equal(assertHeifDimensions(4284, 5712), 4284 * 5712 * 4);
assert.throws(() => assertHeifDimensions(50000, 200), { code: "HEIF_DIMENSION_LIMIT" });
assert.throws(() => assertHeifDimensions(9000, 9000), { code: "HEIF_DIMENSION_LIMIT" });
const fake = { HeifDecoder: class {
  decode() { return [{
    get_width: () => 2, get_height: () => 1,
    display: (target, done) => { target.data.set([255, 0, 1, 255, 0, 255, 1, 255]); done(target); }
  }]; }
} };
const frame = await decodeHeifWithApi(fake, new Uint8Array([1]));
assert.deepEqual([frame.width, frame.height, frame.numberOfImages], [2, 1, 1]);
assert.deepEqual([...new Uint8Array(frame.buffer)], [255, 0, 1, 255, 0, 255, 1, 255]);
await assert.rejects(decodeHeifWithApi({}, new Uint8Array([1])), { code: "HEIF_CODEC_UNAVAILABLE" });
await assert.rejects(decodeHeifWithApi(fake, new Uint8Array()), { code: "HEIF_INPUT_LIMIT" });
await assert.rejects(decodeHeifWithApi({ HeifDecoder: class { decode() { return []; } } }, new Uint8Array([1])), { code: "HEIF_NO_IMAGE" });
await assert.rejects(decodeHeifWithApi({ HeifDecoder: class { decode() { throw Error("bad"); } } }, new Uint8Array([1])), { code: "HEIF_DECODE_FAILED" });
await assert.rejects(decodeHeifWithApi({ HeifDecoder: class {
  decode() { return [{ get_width:()=>1, get_height:()=>1, display:(_d,cb)=>cb(null) }]; }
} }, new Uint8Array([1])), { code: "HEIF_DISPLAY_FAILED" });
class FakeWorker {
  handlers = {};
  addEventListener(name, handler) { this.handlers[name] = handler; }
  postMessage(message) { this.last = message; }
  terminate() { this.terminated = true; }
  message(data) { this.handlers.message({ data }); }
}
const w = new FakeWorker();
const c = new HeifClient({ workerFactory: () => w });
const tinyFile = { size: 1, arrayBuffer: async () => new Uint8Array([42]).buffer };
const p = c.decode(tinyFile);
await Promise.resolve();
assert.equal(w.last?.operation, "heif-decode");
w.message({ id: w.last.id, ok: true, payload: { width: 2, height: 1 } });
assert.equal((await p).width, 2);
const rejected = c.decode(tinyFile);
await Promise.resolve();
w.message({ id: w.last.id, ok: false, error: { code: "HEIF_NO_IMAGE", message: "no image" } });
await assert.rejects(rejected, { code: "HEIF_NO_IMAGE" });
const canceled = c.decode(tinyFile);
await Promise.resolve();
c.dispose();
await assert.rejects(canceled, { code: "HEIF_WORKER_DISPOSED" });
assert.equal(w.terminated, true);
await assert.rejects(c.decode({ size: HEIF_LIMITS.maxCompressedBytes + 1 }), { code: "HEIF_INPUT_LIMIT" });
const corrupted = c.decode(tinyFile);
await Promise.resolve();
w.handlers.messageerror();
await assert.rejects(corrupted,{code:"HEIF_WORKER_MESSAGE_ERROR"});
assert.equal(w.terminated,true);
console.log("HEIF decoder contract smoke tests passed");
