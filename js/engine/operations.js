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



export function coordinateCrop(canvas, x, y, width, height) {
  return cropCanvas(canvas, {
    x: Math.round(Number(x) || 0),
    y: Math.round(Number(y) || 0),
    width: Math.round(Number(width) || 0),
    height: Math.round(Number(height) || 0)
  });
}

function buildMaskedCrop(canvas, selection, shape, options = {}) {
  const region = normalizedRegion(canvas, selection);
  if (region.width < 1 || region.height < 1) return false;

  const {
    background = "#ffffff",
    radius = 24,
    border = false,
    borderWidth = 1,
    borderColor = "#000000",
    shadow = false,
    shadowOffsetX = 5,
    shadowOffsetY = 5,
    shadowBlur = 6,
    shadowOpacity = 35,
    shadowColor = "#000000"
  } = options;

  const mask = document.createElement("canvas");
  mask.width = region.width;
  mask.height = region.height;
  const mctx = mask.getContext("2d");
  mctx.save();
  beginShapePath(mctx, shape, region.width, region.height, radius);
  mctx.clip();
  mctx.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  mctx.restore();

  let padLeft = 0, padTop = 0, padRight = 0, padBottom = 0;
  if (shadow) {
    const blurPad = Math.ceil(Math.max(0, Number(shadowBlur) || 0) * 2);
    const ox = Math.round(Number(shadowOffsetX) || 0);
    const oy = Math.round(Number(shadowOffsetY) || 0);
    padLeft = blurPad + Math.max(0, -ox);
    padTop = blurPad + Math.max(0, -oy);
    padRight = blurPad + Math.max(0, ox);
    padBottom = blurPad + Math.max(0, oy);
  }

  canvas.width = region.width + padLeft + padRight;
  canvas.height = region.height + padTop + padBottom;
  const ctx = context(canvas);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (shadow) {
    ctx.save();
    ctx.shadowOffsetX = Number(shadowOffsetX) || 0;
    ctx.shadowOffsetY = Number(shadowOffsetY) || 0;
    ctx.shadowBlur = Math.max(0, Number(shadowBlur) || 0);
    ctx.shadowColor = hexWithAlpha(shadowColor, Math.max(0, Math.min(100, Number(shadowOpacity) || 0)) / 100);
    ctx.drawImage(mask, padLeft, padTop);
    ctx.restore();
  }

  ctx.drawImage(mask, padLeft, padTop);

  if (border) {
    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(1, Number(borderWidth) || 1);
    beginShapePath(ctx, shape, region.width, region.height, radius, padLeft, padTop);
    ctx.stroke();
    ctx.restore();
  }
  return true;
}

function beginShapePath(ctx, shape, width, height, radius = 24, offsetX = 0, offsetY = 0) {
  ctx.beginPath();
  if (shape === "ellipse") {
    ctx.ellipse(offsetX + width / 2, offsetY + height / 2, Math.max(0, width / 2 - .5), Math.max(0, height / 2 - .5), 0, 0, Math.PI * 2);
  } else {
    const r = Math.max(0, Math.min(Number(radius) || 0, width / 2, height / 2));
    ctx.roundRect(offsetX, offsetY, width, height, r);
  }
  ctx.closePath();
}

function hexWithAlpha(hex, alpha) {
  const value = String(hex || "#000000").replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function circularCrop(canvas, selection = null, options = {}) {
  return buildMaskedCrop(canvas, selection, "ellipse", options);
}

export function roundedCrop(canvas, selection = null, options = {}) {
  return buildMaskedCrop(canvas, selection, "rounded", options);
}

export function shiftCanvas(canvas, dx = 0, dy = 0) {
  dx = Math.round(Number(dx) || 0);
  dy = Math.round(Number(dy) || 0);
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  dx = ((dx % w) + w) % w;
  dy = ((dy % h) + h) % h;

  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;
  temp.getContext("2d").drawImage(canvas, 0, 0);
  const ctx = context(canvas);
  ctx.clearRect(0, 0, w, h);

  for (const ox of [dx - w, dx]) {
    for (const oy of [dy - h, dy]) {
      ctx.drawImage(temp, ox, oy);
    }
  }
}

export function addShadow(canvas, selection = null, {
  offsetX = 6,
  offsetY = 6,
  blur = 8,
  opacity = 40,
  color = "#000000"
} = {}) {
  const region = normalizedRegion(canvas, selection);
  if (region.width < 1 || region.height < 1) return false;

  const source = copyRegion(canvas, region);
  const ox = Number(offsetX) || 0;
  const oy = Number(offsetY) || 0;
  const blurValue = Math.max(0, Number(blur) || 0);
  const shadowColor = hexWithAlpha(color, Math.max(0, Math.min(100, Number(opacity) || 0)) / 100);

  if (!selection) {
    const pad = Math.ceil(blurValue * 2);
    const left = pad + Math.max(0, -Math.round(ox));
    const top = pad + Math.max(0, -Math.round(oy));
    const right = pad + Math.max(0, Math.round(ox));
    const bottom = pad + Math.max(0, Math.round(oy));
    canvas.width = source.width + left + right;
    canvas.height = source.height + top + bottom;
    const ctx = context(canvas);
    ctx.save();
    ctx.shadowOffsetX = ox;
    ctx.shadowOffsetY = oy;
    ctx.shadowBlur = blurValue;
    ctx.shadowColor = shadowColor;
    ctx.drawImage(source, left, top);
    ctx.restore();
    ctx.drawImage(source, left, top);
    return true;
  }

  const ctx = context(canvas);
  ctx.save();
  ctx.shadowOffsetX = ox;
  ctx.shadowOffsetY = oy;
  ctx.shadowBlur = blurValue;
  ctx.shadowColor = shadowColor;
  ctx.drawImage(source, region.x, region.y);
  ctx.restore();
  ctx.drawImage(source, region.x, region.y);
  return true;
}

export function copyRegion(canvas, selection = null) {
  const region = normalizedRegion(canvas, selection);
  if (region.width < 1 || region.height < 1) return null;
  const out = document.createElement("canvas");
  out.width = region.width;
  out.height = region.height;
  out.getContext("2d").drawImage(
    canvas,
    region.x, region.y, region.width, region.height,
    0, 0, region.width, region.height
  );
  return out;
}

export function clearRegion(canvas, selection = null, color = "#ffffff") {
  const region = normalizedRegion(canvas, selection);
  if (region.width < 1 || region.height < 1) return;
  const ctx = context(canvas);
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(region.x, region.y, region.width, region.height);
  ctx.restore();
}

export function pasteCanvas(canvas, sourceCanvas, x = 0, y = 0, opacity = 1) {
  if (!sourceCanvas) return;
  const ctx = context(canvas);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, Number(opacity) || 0));
  ctx.drawImage(sourceCanvas, Math.round(x), Math.round(y));
  ctx.restore();
}

export function compositeCanvas(canvas, sourceCanvas, {
  x = 0, y = 0, opacity = 1, mode = "alpha"
} = {}) {
  if (!sourceCanvas) return;
  x = Math.round(Number(x) || 0);
  y = Math.round(Number(y) || 0);
  opacity = Math.max(0, Math.min(1, Number(opacity) || 0));

  if (mode === "alpha" || mode === "overwrite") {
    const ctx = context(canvas);
    ctx.save();
    ctx.globalAlpha = mode === "overwrite" ? 1 : opacity;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(sourceCanvas, x, y);
    ctx.restore();
    return;
  }

  const ctx = context(canvas);
  const sx0 = Math.max(0, -x);
  const sy0 = Math.max(0, -y);
  const dx0 = Math.max(0, x);
  const dy0 = Math.max(0, y);
  const width = Math.min(sourceCanvas.width - sx0, canvas.width - dx0);
  const height = Math.min(sourceCanvas.height - sy0, canvas.height - dy0);
  if (width <= 0 || height <= 0) return;

  const base = ctx.getImageData(dx0, dy0, width, height);
  const sctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const src = sctx.getImageData(sx0, sy0, width, height);
  const bd = base.data, sd = src.data;

  for (let i = 0; i < bd.length; i += 4) {
    const sa = (sd[i + 3] / 255) * opacity;
    if (sa <= 0) continue;
    for (let ch = 0; ch < 3; ch++) {
      const b = bd[i + ch];
      const v = sd[i + ch];
      let mixed;
      switch (mode) {
        case "add": mixed = Math.min(255, b + v); break;
        case "subtract": mixed = Math.max(0, b - v); break;
        case "lighten": mixed = Math.max(b, v); break;
        case "darken": mixed = Math.min(b, v); break;
        default: mixed = v;
      }
      bd[i + ch] = Math.round(b * (1 - sa) + mixed * sa);
    }
    bd[i + 3] = Math.max(bd[i + 3], Math.round(sd[i + 3] * opacity));
  }
  ctx.putImageData(base, dx0, dy0);
}

export function joinCanvas(canvas, otherCanvas, {
  direction = "right", spacing = 0, offset = 0, color = "#ffffff"
} = {}) {
  if (!otherCanvas) return;
  spacing = Math.max(0, Math.round(Number(spacing) || 0));
  offset = Math.round(Number(offset) || 0);

  const base = document.createElement("canvas");
  base.width = canvas.width;
  base.height = canvas.height;
  base.getContext("2d").drawImage(canvas, 0, 0);

  const horizontal = direction === "left" || direction === "right";
  let width, height, baseX = 0, baseY = 0, otherX = 0, otherY = 0;

  if (horizontal) {
    const minY = Math.min(0, offset);
    const maxY = Math.max(base.height, offset + otherCanvas.height);
    width = base.width + spacing + otherCanvas.width;
    height = maxY - minY;
    baseY = -minY;
    otherY = offset - minY;
    if (direction === "left") {
      otherX = 0;
      baseX = otherCanvas.width + spacing;
    } else {
      baseX = 0;
      otherX = base.width + spacing;
    }
  } else {
    const minX = Math.min(0, offset);
    const maxX = Math.max(base.width, offset + otherCanvas.width);
    width = maxX - minX;
    height = base.height + spacing + otherCanvas.height;
    baseX = -minX;
    otherX = offset - minX;
    if (direction === "top") {
      otherY = 0;
      baseY = otherCanvas.height + spacing;
    } else {
      baseY = 0;
      otherY = base.height + spacing;
    }
  }

  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = context(canvas);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, baseX, baseY);
  ctx.drawImage(otherCanvas, otherX, otherY);
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
