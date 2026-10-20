// One HEIC decode at a time within a dedicated Worker. A single 24.5MP frame
// is ~93MiB of RGBA; overlapping WASM decodes could multiply memory pressure.
// Dependency injection also makes the queue testable without vendor WASM.
export function createHeifWorkQueue({ decode, post }) {
  if (typeof decode !== "function" || typeof post !== "function")
    throw TypeError("HEIC Worker queue requires decode and post");
  let tail = Promise.resolve();
  let queued = 0;
  function enqueue(message) {
    if (message?.operation !== "heif-decode") return Promise.resolve(false);
    const {id, buffer} = message;
    queued++;
    const task = tail.then(async () => {
      let response, transfer = [];
      try {
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
          throw Object.assign(Error("HEIC入力データが不正です。"), {code:"HEIF_INVALID_INPUT"});
        }
        const result = await decode(buffer);
        response = {id,ok:true,payload:result};
        transfer = [result.buffer];
      } catch (error) {
        response = {id,ok:false,error:{
          code:error?.code || "HEIF_DECODE_FAILED",
          message:error?.message || "HEIC画像を読み込めませんでした。",
          detail:error?.detail || null
        }};
      } finally {
        queued--;
      }
      // Dispatch failures must remain visible. Do not reinterpret a failed
      // transferable postMessage as a codec decode error.
      post(response, transfer);
    });
    // Recover only the sequencing tail; callers still observe post failures.
    tail = task.catch(()=>{});
    return task;
  }
  return {enqueue,get queuedCount(){return queued;}};
}
