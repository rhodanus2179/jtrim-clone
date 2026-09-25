import { nearestNeighborResize, resizeImageData } from "./resample.js";

function context(canvas) {
  return canvas.getContext("2d", { willReadFrequently: true });
}

function normalizedRegion(canvas, selection) {
  if (!selection) return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const x = Math.max(0, Math.min(canvas.width, Math.round(selection.x)));
  const y = Math.max(0, Math.min(canvas.height, Math.round(selection.y)));
  const width = Math.max(0, Math.min(canvas.width - x, Math.round(selection.width)));
  const height = Math.max(0, Math.min(canvas.height - y, Math.round(selection.height)));
  return { x, y, width, height };
}

export function resizeCanvas(canvas, width, height, method = "lanczos3", resample = true) {
  const ctx = context(canvas);
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const output = resample
    ? resizeImageData(source, width, height, method)
    : nearestNeighborResize(source, width, height);
  canvas.width = output.width;
  canvas.height = output.height;
  context(canvas).putImageData(output, 0, 0);
}

export function cropCanvas(canvas, selection) {
  const region = normalizedRegion(canvas, selection);
  if (region.width < 1 || region.height < 1) return false;
  const pixels = context(canvas).getImageData(region.x, region.y, region.width, region.height);
  canvas.width = region.width;
  canvas.height = region.height;
  context(canvas).putImageData(pixels, 0, 0);
  return true;
}

export function rotate90(canvas, direction) {
  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  temp.getContext("2d").drawImage(canvas, 0, 0);
  const oldWidth = temp.width;
  const oldHeight = temp.height;
  canvas.width = oldHeight;
  canvas.height = oldWidth;
  const ctx = context(canvas);
  ctx.save();
  if (direction === "left") {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  } else {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
}

export function flipCanvas(canvas, axis = "horizontal") {
  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  temp.getContext("2d").drawImage(canvas, 0, 0);
  const ctx = context(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (axis === "horizontal") {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, canvas.height);
    ctx.scale(1, -1);
  }
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
}

function transformPixels(canvas, selection, transform) {
  const region = normalizedRegion(canvas, selection);
  if (!region.width || !region.height) return;
  const ctx = context(canvas);
  const image = ctx.getImageData(region.x, region.y, region.width, region.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) transform(d, i);
  ctx.putImageData(image, region.x, region.y);
}

export function grayscale(canvas, selection) {
  transformPixels(canvas, selection, (d, i) => {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  });
}

export function sepia(canvas, selection) {
  transformPixels(canvas, selection, (d, i) => {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = Math.min(255, Math.round(.393 * r + .769 * g + .189 * b));
    d[i + 1] = Math.min(255, Math.round(.349 * r + .686 * g + .168 * b));
    d[i + 2] = Math.min(255, Math.round(.272 * r + .534 * g + .131 * b));
  });
}

export function invert(canvas, selection) {
  transformPixels(canvas, selection, (d, i) => {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  });
}

export function brightnessContrastImageData(source, brightness = 0, contrast = 0, selection = null) {
  const out = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const d = out.data;
  const region = selection || { x: 0, y: 0, width: source.width, height: source.height };
  const x0 = Math.max(0, Math.round(region.x));
  const y0 = Math.max(0, Math.round(region.y));
  const x1 = Math.min(source.width, Math.round(region.x + region.width));
  const y1 = Math.min(source.height, Math.round(region.y + region.height));
  const offset = brightness * 2.55;
  const c = Math.max(-254.99, Math.min(254.99, contrast * 2.55));
  const factor = (259 * (c + 255)) / (255 * (259 - c));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * source.width + x) * 4;
      d[i] = Math.max(0, Math.min(255, Math.round(factor * (d[i] - 128) + 128 + offset)));
      d[i + 1] = Math.max(0, Math.min(255, Math.round(factor * (d[i + 1] - 128) + 128 + offset)));
      d[i + 2] = Math.max(0, Math.min(255, Math.round(factor * (d[i + 2] - 128) + 128 + offset)));
    }
  }
  return out;
}

function gaussianKernel(level) {
  const radius = Math.max(1, Math.round(level));
  const sigma = Math.max(.65, level * .72);
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return { kernel, radius };
}

export function gaussianBlurImageData(source, level = 3, selection = null) {
  const { kernel, radius } = gaussianKernel(level);
  const w = source.width, h = source.height;
  const src = source.data;
  const temp = new Float32Array(src.length);
  const blurred = new Uint8ClampedArray(src.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = Math.max(0, Math.min(w - 1, x + k));
          sum += src[(y * w + sx) * 4 + ch] * kernel[k + radius];
        }
        temp[di + ch] = sum;
      }
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const sy = Math.max(0, Math.min(h - 1, y + k));
          sum += temp[(sy * w + x) * 4 + ch] * kernel[k + radius];
        }
        blurred[di + ch] = Math.max(0, Math.min(255, Math.round(sum)));
      }
    }
  }

  if (!selection) return new ImageData(blurred, w, h);

  const out = new Uint8ClampedArray(src);
  const r = {
    x: Math.max(0, Math.round(selection.x)),
    y: Math.max(0, Math.round(selection.y)),
    width: Math.max(0, Math.round(selection.width)),
    height: Math.max(0, Math.round(selection.height))
  };
  const x1 = Math.min(w, r.x + r.width);
  const y1 = Math.min(h, r.y + r.height);
  for (let y = r.y; y < y1; y++) {
    for (let x = r.x; x < x1; x++) {
      const i = (y * w + x) * 4;
      out[i] = blurred[i];
      out[i + 1] = blurred[i + 1];
      out[i + 2] = blurred[i + 2];
      out[i + 3] = blurred[i + 3];
    }
  }
  return new ImageData(out, w, h);
}


export function rotateArbitrary(canvas, degrees, background = "#ffffff", expand = true) {
  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  temp.getContext("2d").drawImage(canvas, 0, 0);

  const radians = Number(degrees) * Math.PI / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const targetWidth = expand ? Math.ceil(temp.width * cos + temp.height * sin) : temp.width;
  const targetHeight = expand ? Math.ceil(temp.width * sin + temp.height * cos) : temp.height;

  canvas.width = Math.max(1, targetWidth);
  canvas.height = Math.max(1, targetHeight);
  const ctx = context(canvas);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(temp, -temp.width / 2, -temp.height / 2);
  ctx.restore();
}

export function addMargin(canvas, { top = 0, right = 0, bottom = 0, left = 0, color = "#ffffff" } = {}) {
  top = Math.max(0, Math.round(Number(top) || 0));
  right = Math.max(0, Math.round(Number(right) || 0));
  bottom = Math.max(0, Math.round(Number(bottom) || 0));
  left = Math.max(0, Math.round(Number(left) || 0));

  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  temp.getContext("2d").drawImage(canvas, 0, 0);

  canvas.width = temp.width + left + right;
  canvas.height = temp.height + top + bottom;
  const ctx = context(canvas);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(temp, left, top);
}

export function drawText(canvas, options) {
  const ctx = context(canvas);
  const {
    text = "", x = 20, y = 20, fontFamily = "sans-serif", fontSize = 32,
    bold = false, italic = false, underline = false, color = "#000000", opacity = 1
  } = options;
  if (!text) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.font = `${italic ? "italic " : ""}${bold ? "700 " : ""}${fontSize}px ${fontFamily}`;
  const lines = text.replace(/\r/g, "").split("\n");
  const lineHeight = fontSize * 1.25;
  lines.forEach((line, index) => {
    const ty = y + index * lineHeight;
    ctx.fillText(line, x, ty);
    if (underline) {
      const metrics = ctx.measureText(line);
      ctx.fillRect(x, ty + fontSize * 1.05, metrics.width, Math.max(1, fontSize / 18));
    }
  });
  ctx.restore();
}
