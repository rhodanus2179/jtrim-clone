import assert from "node:assert/strict";
import createJpegtran from "../js/codecs/generated/jpegtran-module.js";
import { parseJpegInfo } from "../js/io/jpeg-info.js";
import {
  composeJpegTransform,
  jpegtranArgumentsForOperation,
  operationForExifOrientation
} from "../js/codecs/jpeg-orientation.js";

const SOURCE_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIABADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDx/wAB/smf6v8A0P0/hpZdmO2p8Fw74gfD759CeEf2WYtPt1mmtNqDoAvLH0HvX1uN4uwPDmBlmGYVOWEdl1k+kYrrJ/cldtqKbX9R8McdyrSjGE9T/9k=";
const source = Buffer.from(SOURCE_BASE64, "base64");

async function runJpegtran(args) {
  const stderr = [];
  const mod = await createJpegtran({
    noInitialRun: true,
    print: () => {},
    printErr: line => stderr.push(String(line))
  });
  mod.FS.writeFile("/input.jpg", source);
  mod.callMain([...args, "-outfile", "/output.jpg", "/input.jpg"]);
  const output = mod.FS.readFile("/output.jpg");
  return {
    bytes: new Uint8Array(output),
    stderr: stderr.join("\n")
  };
}

assert.equal(operationForExifOrientation(1), "identity");
assert.equal(operationForExifOrientation(6), "rotate90");
assert.equal(operationForExifOrientation(8), "rotate270");
assert.equal(composeJpegTransform("rotate90", 6), "rotate180");
assert.equal(composeJpegTransform("identity", 8), "rotate270");
assert.deepEqual(jpegtranArgumentsForOperation("flipH"), ["-flip", "horizontal"]);

const rotated = await runJpegtran(["-copy", "all", "-perfect", "-rotate", "90"]);
const rotatedInfo = await parseJpegInfo(new Blob([rotated.bytes], { type: "image/jpeg" }));
assert.ok(rotatedInfo);
assert.equal(rotatedInfo.width, 8);
assert.equal(rotatedInfo.height, 16);
assert.equal(rotatedInfo.progressive, false);

const progressive = await runJpegtran(["-copy", "all", "-progressive"]);
const progressiveInfo = await parseJpegInfo(new Blob([progressive.bytes], { type: "image/jpeg" }));
assert.ok(progressiveInfo);
assert.equal(progressiveInfo.width, 16);
assert.equal(progressiveInfo.height, 8);
assert.equal(progressiveInfo.progressive, true);

console.log("Advanced JPEG codec smoke tests passed");
