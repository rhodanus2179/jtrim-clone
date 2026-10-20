import assert from "node:assert/strict";
import { writableImageType } from "../js/io/save-format.js";

// High-priority invariant: NEVER write JPEG/PNG bytes over a .HEIC original.
for (const ext of [".HEIC", ".heif"]) {
  for (const mime of ["image/heif", "image/heic", "image/jpeg", "image/png", "", "application/octet-stream"])
    assert.equal(writableImageType(mime, "IMG_0001" + ext), null, mime + ext);
}
assert.equal(writableImageType("image/heic", "image.jpg"), null);
assert.equal(writableImageType("image/heif-sequence", "image.png"), null);
assert.equal(writableImageType("image/jpeg", "image.jpg"), "image/jpeg");
assert.equal(writableImageType("image/png", "image.png"), "image/png");
assert.equal(writableImageType("image/webp", "image.webp"), "image/webp");
assert.equal(writableImageType("", "image.jpg"), "image/jpeg");
assert.equal(writableImageType("", "document.txt"), null);
console.log("HEIC overwrite protection tests passed");
