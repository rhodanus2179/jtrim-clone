import assert from "node:assert/strict";

globalThis.ImageData = class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};

const { floodFillImageData } = await import("../js/engine/pixel.js");

function imageFromPixels(pixels, width) {
  const data = new Uint8ClampedArray(pixels.flat());
  return new ImageData(data, width, pixels.length / width);
}

function pixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [...image.data.slice(i, i + 4)];
}

// Seed-based comparison: 100 -> 110 is allowed at 5% (~13),
// but 120 must not be reached merely because it is close to 110.
{
  const source = imageFromPixels([
    [100,100,100,255],
    [110,110,110,255],
    [120,120,120,255],
    [130,130,130,255],
    [140,140,140,255]
  ], 5);
  const out = floodFillImageData(source, 0, 0, "#ff0000", 5, 1);
  assert.deepEqual(pixel(out, 0, 0), [255,0,0,255]);
  assert.deepEqual(pixel(out, 1, 0), [255,0,0,255]);
  assert.deepEqual(pixel(out, 2, 0), [120,120,120,255]);
}

// Selection is a hard fill boundary.
{
  const source = imageFromPixels([
    [20,20,20,255],
    [20,20,20,255],
    [20,20,20,255]
  ], 3);
  const out = floodFillImageData(
    source, 1, 0, "#00ff00", 100, 1,
    { x: 1, y: 0, width: 1, height: 1 }
  );
  assert.deepEqual(pixel(out, 0, 0), [20,20,20,255]);
  assert.deepEqual(pixel(out, 1, 0), [0,255,0,255]);
  assert.deepEqual(pixel(out, 2, 0), [20,20,20,255]);
}

// Alpha does not participate in tolerance matching.
{
  const source = imageFromPixels([
    [50,60,70,10],
    [50,60,70,240]
  ], 2);
  const out = floodFillImageData(source, 0, 0, "#0000ff", 0, 1);
  assert.deepEqual(pixel(out, 0, 0), [0,0,255,255]);
  assert.deepEqual(pixel(out, 1, 0), [0,0,255,255]);
}

// Opacity blends the fill rather than replacing immediately.
{
  const source = imageFromPixels([[100,100,100,100]], 1);
  const out = floodFillImageData(source, 0, 0, "#ffffff", 0, 0.5);
  assert.deepEqual(pixel(out, 0, 0), [178,178,178,178]);
}

// A seed outside the active selection is a no-op.
{
  const source = imageFromPixels([
    [10,10,10,255],
    [10,10,10,255]
  ], 2);
  const out = floodFillImageData(
    source, 0, 0, "#ffffff", 100, 1,
    { x: 1, y: 0, width: 1, height: 1 }
  );
  assert.deepEqual([...out.data], [...source.data]);
}

console.log("Flood fill smoke tests passed");
