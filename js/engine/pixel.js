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
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      d[i] = clamp255(factor * (d[i] - 128) + 128 + offset);
      d[i + 1] = clamp255(factor * (d[i + 1] - 128) + 128 + offset);
      d[i + 2] = clamp255(factor * (d[i + 2] - 128) + 128 + offset);
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

  // Horizontal pass.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        const si = (y * w + sx) * 4;
        const weight = kernel[k + radius];
        r += src[si] * weight;
        g += src[si + 1] * weight;
        b += src[si + 2] * weight;
        a += src[si + 3] * weight;
      }
      temp[di] = r; temp[di + 1] = g; temp[di + 2] = b; temp[di + 3] = a;
    }
  }

  // Vertical pass.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        const si = (sy * w + x) * 4;
        const weight = kernel[k + radius];
        r += temp[si] * weight;
        g += temp[si + 1] * weight;
        b += temp[si + 2] * weight;
        a += temp[si + 3] * weight;
      }
      blurred[di] = clamp255(r);
      blurred[di + 1] = clamp255(g);
      blurred[di + 2] = clamp255(b);
      blurred[di + 3] = clamp255(a);
    }
  }

  if (!selection) return new ImageData(blurred, w, h);

  const out = new Uint8ClampedArray(src);
  const x0 = Math.max(0, Math.round(selection.x));
  const y0 = Math.max(0, Math.round(selection.y));
  const x1 = Math.min(w, Math.round(selection.x + selection.width));
  const y1 = Math.min(h, Math.round(selection.y + selection.height));
  for (let y = y0; y < y1; y++) {
    const start = (y * w + x0) * 4;
    const end = (y * w + x1) * 4;
    out.set(blurred.subarray(start, end), start);
  }
  return new ImageData(out, w, h);
}

function clamp255(value) {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}
