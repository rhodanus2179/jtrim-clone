import {decodeHeifWithApi,HeifDecodeError} from "../codecs/heif-decode-core.js";
import {resolveHeifModule} from "../codecs/resolve-heif-module.js";
import {createHeifWorkQueue} from "./heif-work-queue.js";
let apiPromise=null;
async function api(){
  if(!apiPromise){
    apiPromise=import("../../third_party/libheif-js/libheif-bundle.mjs")
      .then(resolveHeifModule)
      .catch(error=>{
        apiPromise=null;
        throw new HeifDecodeError("HEIF_CODEC_UNAVAILABLE",
          "HEICデコーダーはまだ配布されていません。",error?.message||String(error));
      });
  }
  return apiPromise;
}
// Module workers do not run decode tasks concurrently, even when the main
// thread simultaneously requests gallery, batch and editor HEIC images.
const queue=createHeifWorkQueue({
  decode:async buffer=>decodeHeifWithApi(await api(),new Uint8Array(buffer)),
  post:(message,transfers=[])=>self.postMessage(message,transfers)
});
self.addEventListener("message",event=>{void queue.enqueue(event.data);});
