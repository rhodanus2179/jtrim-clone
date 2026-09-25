function regionBounds(source, selection) {
  const region = selection || { x: 0, y: 0, width: source.width, height: source.height };
  return {
    x0: Math.max(0, Math.round(region.x)),
    y0: Math.max(0, Math.round(region.y)),
    x1: Math.min(source.width, Math.round(region.x + region.width)),
    y1: Math.min(source.height, Math.round(region.y + region.height))
  };
}

function cloneImageData(source) {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

export function brightnessContrastImageData(source, brightness = 0, contrast = 0, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
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

export function gammaImageData(source, gamma = 1, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  gamma = Math.max(0.05, Number(gamma) || 1);
  const exponent = 1 / gamma;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp255(255 * Math.pow(i / 255, exponent));

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
  }
  return out;
}

export function rgbAdjustImageData(source, red = 0, green = 0, blue = 0, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const ro = Number(red) * 2.55;
  const go = Number(green) * 2.55;
  const bo = Number(blue) * 2.55;

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      d[i] = clamp255(d[i] + ro);
      d[i + 1] = clamp255(d[i + 1] + go);
      d[i + 2] = clamp255(d[i + 2] + bo);
    }
  }
  return out;
}

export function hsvAdjustImageData(source, hue = 0, saturation = 0, value = 0, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const satFactor = 1 + Number(saturation) / 100;
  const valFactor = 1 + Number(value) / 100;
  const hueShift = Number(hue);

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      let [h, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
      h = (h + hueShift + 360) % 360;
      s = Math.max(0, Math.min(1, s * satFactor));
      v = Math.max(0, Math.min(1, v * valFactor));
      const [r, g, b] = hsvToRgb(h, s, v);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
  return out;
}

export function sharpenImageData(source, level = 1, selection = null) {
  const out = cloneImageData(source);
  const src = source.data;
  const dst = out.data;
  const w = source.width;
  const h = source.height;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const amount = Math.max(0, Math.min(20, Number(level))) / 4;
  const center = 1 + 4 * amount;
  const side = -amount;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const xl = x > 0 ? x - 1 : 0;
      const xr = x < w - 1 ? x + 1 : w - 1;
      const yu = y > 0 ? y - 1 : 0;
      const yd = y < h - 1 ? y + 1 : h - 1;
      const il = (y * w + xl) * 4;
      const ir = (y * w + xr) * 4;
      const iu = (yu * w + x) * 4;
      const id = (yd * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        dst[i + ch] = clamp255(
          src[i + ch] * center +
          (src[il + ch] + src[ir + ch] + src[iu + ch] + src[id + ch]) * side
        );
      }
    }
  }
  return out;
}

export function mosaicImageData(source, blockSize = 8, selection = null) {
  const out = cloneImageData(source);
  const src = source.data;
  const dst = out.data;
  const w = source.width;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const size = Math.max(2, Math.min(200, Math.round(Number(blockSize) || 8)));

  for (let by = y0; by < y1; by += size) {
    for (let bx = x0; bx < x1; bx += size) {
      const ex = Math.min(x1, bx + size);
      const ey = Math.min(y1, by + size);
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; count++;
        }
      }
      r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count); a = Math.round(a / count);
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = a;
        }
      }
    }
  }
  return out;
}


export function posterizeImageData(source, levels = 8, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  levels = Math.max(2, Math.min(64, Math.round(Number(levels) || 8)));
  const steps = levels - 1;
  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      d[i] = Math.round(Math.round(d[i] / 255 * steps) / steps * 255);
      d[i + 1] = Math.round(Math.round(d[i + 1] / 255 * steps) / steps * 255);
      d[i + 2] = Math.round(Math.round(d[i + 2] / 255 * steps) / steps * 255);
    }
  }
  return out;
}

export function solarizeImageData(source, threshold = 128, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  threshold = Math.max(0, Math.min(255, Math.round(Number(threshold) || 0)));
  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      if (d[i] >= threshold) d[i] = 255 - d[i];
      if (d[i + 1] >= threshold) d[i + 1] = 255 - d[i + 1];
      if (d[i + 2] >= threshold) d[i + 2] = 255 - d[i + 2];
    }
  }
  return out;
}

export function thresholdImageData(source, threshold = 128, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  threshold = Math.max(0, Math.min(255, Math.round(Number(threshold) || 0)));
  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = luma >= threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  return out;
}

function convolve3x3(source, kernel, divisor = 1, offset = 0, selection = null, monochrome = false) {
  const out = cloneImageData(source);
  const src = source.data;
  const dst = out.data;
  const w = source.width, h = source.height;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      let rr = 0, gg = 0, bb = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        const sy = Math.max(0, Math.min(h - 1, y + ky));
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.max(0, Math.min(w - 1, x + kx));
          const si = (sy * w + sx) * 4;
          const weight = kernel[ki++];
          rr += src[si] * weight;
          gg += src[si + 1] * weight;
          bb += src[si + 2] * weight;
        }
      }
      if (monochrome) {
        const v = clamp255((0.299 * rr + 0.587 * gg + 0.114 * bb) / divisor + offset);
        dst[i] = dst[i + 1] = dst[i + 2] = v;
      } else {
        dst[i] = clamp255(rr / divisor + offset);
        dst[i + 1] = clamp255(gg / divisor + offset);
        dst[i + 2] = clamp255(bb / divisor + offset);
      }
    }
  }
  return out;
}

export function embossImageData(source, level = 3, selection = null, color = false) {
  const amount = Math.max(1, Math.min(20, Number(level) || 1));
  const k = amount / 3;
  return convolve3x3(
    source,
    [-2 * k, -k, 0, -k, 1, k, 0, k, 2 * k],
    1,
    128,
    selection,
    !color
  );
}

export function edgeEnhanceImageData(source, level = 3, selection = null) {
  const amount = Math.max(1, Math.min(20, Number(level) || 1)) / 5;
  return convolve3x3(
    source,
    [0, -amount, 0, -amount, 1 + 4 * amount, -amount, 0, -amount, 0],
    1,
    0,
    selection,
    false
  );
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
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        const si = (y * w + sx) * 4;
        const weight = kernel[k + radius];
        r += src[si] * weight; g += src[si + 1] * weight; b += src[si + 2] * weight; a += src[si + 3] * weight;
      }
      temp[di] = r; temp[di + 1] = g; temp[di + 2] = b; temp[di + 3] = a;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        const si = (sy * w + x) * 4;
        const weight = kernel[k + radius];
        r += temp[si] * weight; g += temp[si + 1] * weight; b += temp[si + 2] * weight; a += temp[si + 3] * weight;
      }
      blurred[di] = clamp255(r); blurred[di + 1] = clamp255(g); blurred[di + 2] = clamp255(b); blurred[di + 3] = clamp255(a);
    }
  }

  if (!selection) return new ImageData(blurred, w, h);
  const out = new Uint8ClampedArray(src);
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  for (let y = y0; y < y1; y++) {
    const start = (y * w + x0) * 4;
    const end = (y * w + x1) * 4;
    out.set(blurred.subarray(start, end), start);
  }
  return new ImageData(out, w, h);
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return [clamp255((rp + m) * 255), clamp255((gp + m) * 255), clamp255((bp + m) * 255)];
}

function clamp255(value) {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}
