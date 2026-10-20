import assert from "node:assert/strict";
import { resolveHeifModule } from "../js/codecs/resolve-heif-module.js";
const api = { HeifDecoder: class {} };
assert.equal(await resolveHeifModule(api), api);
assert.equal(await resolveHeifModule({ default: api }), api);
assert.equal(await resolveHeifModule({ default: async () => api }), api);
assert.equal(await resolveHeifModule({ default: { default: () => Promise.resolve(api) }}), api);
await assert.rejects(resolveHeifModule({}), { code: "HEIF_CODEC_INIT_FAILED" });
console.log("WASM module resolver unit tests passed");
