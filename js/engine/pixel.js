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

export function grayscaleImageData(source, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      const value = clamp255(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = value;
    }
  }
  return out;
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


export function histogramData(source, selection = null) {
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  const luma = new Uint32Array(256);
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const d = source.data;
  let pixels = 0;
  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      red[d[i]]++;
      green[d[i + 1]]++;
      blue[d[i + 2]]++;
      const yv = clamp255(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      luma[yv]++;
      pixels++;
    }
  }
  return {
    red: Array.from(red),
    green: Array.from(green),
    blue: Array.from(blue),
    luma: Array.from(luma),
    pixels
  };
}

export function normalizeImageData(source, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const min = [255, 255, 255];
  const max = [0, 0, 0];

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        const v = d[i + ch];
        if (v < min[ch]) min[ch] = v;
        if (v > max[ch]) max[ch] = v;
      }
    }
  }

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        const span = max[ch] - min[ch];
        d[i + ch] = span ? clamp255((d[i + ch] - min[ch]) * 255 / span) : d[i + ch];
      }
    }
  }
  return out;
}

export function equalizeImageData(source, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const hist = new Uint32Array(256);
  let count = 0;

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      const yv = clamp255(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      hist[yv]++;
      count++;
    }
  }

  const cdf = new Uint32Array(256);
  let running = 0, cdfMin = 0;
  for (let i = 0; i < 256; i++) {
    running += hist[i];
    cdf[i] = running;
    if (!cdfMin && hist[i]) cdfMin = running;
  }
  const denom = Math.max(1, count - cdfMin);

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      const oldY = Math.max(1, 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      const idx = clamp255(oldY);
      const newY = clamp255((cdf[idx] - cdfMin) * 255 / denom);
      const ratio = newY / oldY;
      d[i] = clamp255(d[i] * ratio);
      d[i + 1] = clamp255(d[i + 1] * ratio);
      d[i + 2] = clamp255(d[i + 2] * ratio);
    }
  }
  return out;
}

export function edgeExtractImageData(source, level = 3, selection = null) {
  const amount = Math.max(1, Math.min(20, Number(level) || 1));
  const scale = amount / 3;
  return convolve3x3(
    source,
    [0, -scale, 0, -scale, 4 * scale, -scale, 0, -scale, 0],
    1,
    128,
    selection,
    true
  );
}

export function noiseImageData(source, amount = 15, color = false, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const amp = Math.max(0, Math.min(100, Number(amount) || 0)) * 2.55;

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      if (color) {
        d[i] = clamp255(d[i] + (Math.random() * 2 - 1) * amp);
        d[i + 1] = clamp255(d[i + 1] + (Math.random() * 2 - 1) * amp);
        d[i + 2] = clamp255(d[i + 2] + (Math.random() * 2 - 1) * amp);
      } else {
        const n = (Math.random() * 2 - 1) * amp;
        d[i] = clamp255(d[i] + n);
        d[i + 1] = clamp255(d[i + 1] + n);
        d[i + 2] = clamp255(d[i + 2] + n);
      }
    }
  }
  return out;
}

export function diffuseImageData(source, radius = 4, selection = null) {
  const out = cloneImageData(source);
  const src = source.data, dst = out.data;
  const w = source.width, h = source.height;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  radius = Math.max(1, Math.min(30, Math.round(Number(radius) || 1)));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const sx = Math.max(0, Math.min(w - 1, x + Math.round((Math.random() * 2 - 1) * radius)));
      const sy = Math.max(0, Math.min(h - 1, y + Math.round((Math.random() * 2 - 1) * radius)));
      const si = (sy * w + sx) * 4;
      const di = (y * w + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return out;
}

export function glassImageData(source, size = 6, direction = "both", selection = null) {
  const out = cloneImageData(source);
  const src = source.data, dst = out.data;
  const w = source.width, h = source.height;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  size = Math.max(2, Math.min(80, Math.round(Number(size) || 6)));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let sx = x, sy = y;
      if (direction === "horizontal" || direction === "both") {
        const bx = Math.floor((x - x0) / size) * size + x0;
        sx = Math.min(x1 - 1, bx + (size - 1 - ((x - bx) % size)));
      }
      if (direction === "vertical" || direction === "both") {
        const by = Math.floor((y - y0) / size) * size + y0;
        sy = Math.min(y1 - 1, by + (size - 1 - ((y - by) % size)));
      }
      const si = (Math.max(0, Math.min(h - 1, sy)) * w + Math.max(0, Math.min(w - 1, sx))) * 4;
      const di = (y * w + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return out;
}

export function pencilImageData(source, selection = null) {
  const edge = edgeExtractImageData(source, 4, selection);
  const out = cloneImageData(source);
  const d = out.data, e = edge.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      const v = clamp255(255 - Math.abs(e[i] - 128) * 2.2);
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  return out;
}

export function floodFillImageData(source, x, y, color, tolerance = 20, opacity = 1) {
  const out = cloneImageData(source);
  const d = out.data;
  const w = source.width, h = source.height;
  x = Math.max(0, Math.min(w - 1, Math.round(Number(x) || 0)));
  y = Math.max(0, Math.min(h - 1, Math.round(Number(y) || 0)));
  tolerance = Math.max(0, Math.min(255, Number(tolerance) || 0));
  opacity = Math.max(0, Math.min(1, Number(opacity)));
  const targetIndex = (y * w + x) * 4;
  const target = [d[targetIndex], d[targetIndex + 1], d[targetIndex + 2], d[targetIndex + 3]];
  const fill = parseHexColor(color);
  const seen = new Uint8Array(w * h);
  const stack = [x, y];

  const closeEnough = idx =>
    Math.abs(d[idx] - target[0]) <= tolerance &&
    Math.abs(d[idx + 1] - target[1]) <= tolerance &&
    Math.abs(d[idx + 2] - target[2]) <= tolerance &&
    Math.abs(d[idx + 3] - target[3]) <= tolerance;

  while (stack.length) {
    const cy = stack.pop();
    const cx = stack.pop();
    const pos = cy * w + cx;
    if (seen[pos]) continue;
    seen[pos] = 1;
    const i = pos * 4;
    if (!closeEnough(i)) continue;

    d[i] = clamp255(d[i] * (1 - opacity) + fill[0] * opacity);
    d[i + 1] = clamp255(d[i + 1] * (1 - opacity) + fill[1] * opacity);
    d[i + 2] = clamp255(d[i + 2] * (1 - opacity) + fill[2] * opacity);
    d[i + 3] = clamp255(d[i + 3] * (1 - opacity) + 255 * opacity);

    if (cx > 0) stack.push(cx - 1, cy);
    if (cx < w - 1) stack.push(cx + 1, cy);
    if (cy > 0) stack.push(cx, cy - 1);
    if (cy < h - 1) stack.push(cx, cy + 1);
  }
  return out;
}

function parseHexColor(value) {
  const hex = String(value || "#000000").replace("#", "");
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16)
    ];
  }
  return [
    parseInt(hex.slice(0, 2), 16) || 0,
    parseInt(hex.slice(2, 4), 16) || 0,
    parseInt(hex.slice(4, 6), 16) || 0
  ];
}


function sampleBilinear(data, w, h, x, y, channel) {
  x = Math.max(0, Math.min(w - 1, x));
  y = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const i00 = (y0 * w + x0) * 4 + channel;
  const i10 = (y0 * w + x1) * 4 + channel;
  const i01 = (y1 * w + x0) * 4 + channel;
  const i11 = (y1 * w + x1) * 4 + channel;
  const a = data[i00] * (1 - tx) + data[i10] * tx;
  const b = data[i01] * (1 - tx) + data[i11] * tx;
  return a * (1 - ty) + b * ty;
}

function distortImageData(source, selection, mapper) {
  const out = cloneImageData(source);
  const src = source.data, dst = out.data;
  const w = source.width, h = source.height;
  const bounds = regionBounds(source, selection);

  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let x = bounds.x0; x < bounds.x1; x++) {
      const mapped = mapper(x, y, bounds);
      const sx = mapped[0], sy = mapped[1];
      const di = (y * w + x) * 4;
      if (sx < bounds.x0 || sx >= bounds.x1 || sy < bounds.y0 || sy >= bounds.y1) {
        continue;
      }
      dst[di] = clamp255(sampleBilinear(src, w, h, sx, sy, 0));
      dst[di + 1] = clamp255(sampleBilinear(src, w, h, sx, sy, 1));
      dst[di + 2] = clamp255(sampleBilinear(src, w, h, sx, sy, 2));
      dst[di + 3] = clamp255(sampleBilinear(src, w, h, sx, sy, 3));
    }
  }
  return out;
}

export function waveImageData(source, amplitude = 10, wavelength = 40, direction = "horizontal", selection = null) {
  amplitude = Math.max(0, Math.min(200, Number(amplitude) || 0));
  wavelength = Math.max(2, Math.min(1000, Number(wavelength) || 40));
  return distortImageData(source, selection, (x, y) => {
    let sx = x, sy = y;
    if (direction === "horizontal" || direction === "both") {
      sx = x + Math.sin((y / wavelength) * Math.PI * 2) * amplitude;
    }
    if (direction === "vertical" || direction === "both") {
      sy = y + Math.sin((x / wavelength) * Math.PI * 2) * amplitude;
    }
    return [sx, sy];
  });
}

export function blockImageData(source, size = 12, stagger = false, border = false, selection = null) {
  const out = cloneImageData(source);
  const src = source.data, dst = out.data;
  const w = source.width;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  size = Math.max(2, Math.min(200, Math.round(Number(size) || 12)));
  const borderColor = [0, 0, 0];

  let row = 0;
  for (let by = y0; by < y1; by += size, row++) {
    const rowOffset = stagger && row % 2 ? Math.floor(size / 2) : 0;
    for (let bx = x0 - rowOffset; bx < x1; bx += size) {
      const sx0 = Math.max(x0, bx);
      const sy0 = by;
      const ex = Math.min(x1, bx + size);
      const ey = Math.min(y1, by + size);
      if (sx0 >= ex || sy0 >= ey) continue;

      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let y = sy0; y < ey; y++) {
        for (let x = sx0; x < ex; x++) {
          const i = (y * w + x) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; count++;
        }
      }
      r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count); a = Math.round(a / count);

      for (let y = sy0; y < ey; y++) {
        for (let x = sx0; x < ex; x++) {
          const i = (y * w + x) * 4;
          const isBorder = border && (x === sx0 || x === ex - 1 || y === sy0 || y === ey - 1);
          dst[i] = isBorder ? borderColor[0] : r;
          dst[i + 1] = isBorder ? borderColor[1] : g;
          dst[i + 2] = isBorder ? borderColor[2] : b;
          dst[i + 3] = a;
        }
      }
    }
  }
  return out;
}

export function fadeImageData(source, strength = 100, shape = "ellipse", color = "#ffffff", selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const fill = parseHexColor(color);
  const cx = (x0 + x1 - 1) / 2, cy = (y0 + y1 - 1) / 2;
  const rx = Math.max(1, (x1 - x0) / 2), ry = Math.max(1, (y1 - y0) / 2);
  const amount = Math.max(0, Math.min(1, Number(strength) / 100));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let dist;
      if (shape === "rectangle") {
        dist = Math.max(Math.abs((x - cx) / rx), Math.abs((y - cy) / ry));
      } else {
        dist = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
      }
      const alpha = Math.max(0, Math.min(1, dist)) * amount;
      const i = (y * source.width + x) * 4;
      d[i] = clamp255(d[i] * (1 - alpha) + fill[0] * alpha);
      d[i + 1] = clamp255(d[i + 1] * (1 - alpha) + fill[1] * alpha);
      d[i + 2] = clamp255(d[i + 2] * (1 - alpha) + fill[2] * alpha);
    }
  }
  return out;
}

export function oilPaintImageData(source, radius = 3, levels = 24, selection = null) {
  const out = cloneImageData(source);
  const src = source.data, dst = out.data;
  const w = source.width, h = source.height;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  radius = Math.max(1, Math.min(5, Math.round(Number(radius) || 3)));
  levels = Math.max(8, Math.min(64, Math.round(Number(levels) || 24)));

  const counts = new Uint16Array(levels);
  const rs = new Uint32Array(levels);
  const gs = new Uint32Array(levels);
  const bs = new Uint32Array(levels);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      counts.fill(0); rs.fill(0); gs.fill(0); bs.fill(0);
      let best = 0, bestCount = 0;
      for (let yy = Math.max(y0, y - radius); yy <= Math.min(y1 - 1, y + radius); yy++) {
        for (let xx = Math.max(x0, x - radius); xx <= Math.min(x1 - 1, x + radius); xx++) {
          const i = (yy * w + xx) * 4;
          const lum = (src[i] + src[i + 1] + src[i + 2]) / 3;
          const bucket = Math.min(levels - 1, Math.floor(lum / 256 * levels));
          const c = ++counts[bucket];
          rs[bucket] += src[i]; gs[bucket] += src[i + 1]; bs[bucket] += src[i + 2];
          if (c > bestCount) { bestCount = c; best = bucket; }
        }
      }
      const di = (y * w + x) * 4;
      dst[di] = Math.round(rs[best] / bestCount);
      dst[di + 1] = Math.round(gs[best] / bestCount);
      dst[di + 2] = Math.round(bs[best] / bestCount);
    }
  }
  return out;
}

export function swirlImageData(source, degrees = 180, selection = null) {
  const angle = Math.max(-540, Math.min(540, Number(degrees) || 0)) * Math.PI / 180;
  return distortImageData(source, selection, (x, y, b) => {
    const cx = (b.x0 + b.x1 - 1) / 2, cy = (b.y0 + b.y1 - 1) / 2;
    const rx = Math.max(1, (b.x1 - b.x0) / 2), ry = Math.max(1, (b.y1 - b.y0) / 2);
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r >= 1) return [x, y];
    const theta = Math.atan2(dy, dx) - angle * (1 - r) * (1 - r);
    return [cx + Math.cos(theta) * r * rx, cy + Math.sin(theta) * r * ry];
  });
}

export function radialWarpImageData(source, strength = 50, selection = null) {
  strength = Math.max(-100, Math.min(100, Number(strength) || 0)) / 100;
  return distortImageData(source, selection, (x, y, b) => {
    const cx = (b.x0 + b.x1 - 1) / 2, cy = (b.y0 + b.y1 - 1) / 2;
    const rx = Math.max(1, (b.x1 - b.x0) / 2), ry = Math.max(1, (b.y1 - b.y0) / 2);
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r <= 0 || r >= 1) return [x, y];
    const power = strength >= 0 ? 1 + strength * 2 : 1 / (1 + (-strength) * 2);
    const sr = Math.pow(r, power);
    return [cx + dx / r * sr * rx, cy + dy / r * sr * ry];
  });
}

export function spotlightImageData(source, centerX, centerY, radius = 120, strength = 60, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const b = regionBounds(source, selection);
  const cx = Number.isFinite(Number(centerX)) ? Number(centerX) : (b.x0 + b.x1) / 2;
  const cy = Number.isFinite(Number(centerY)) ? Number(centerY) : (b.y0 + b.y1) / 2;
  radius = Math.max(1, Number(radius) || 120);
  const amount = Math.max(-100, Math.min(100, Number(strength) || 0)) * 2.55;

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist >= radius) continue;
      const falloff = 1 - dist / radius;
      const delta = amount * falloff * falloff;
      const i = (y * source.width + x) * 4;
      d[i] = clamp255(d[i] + delta);
      d[i + 1] = clamp255(d[i + 1] + delta);
      d[i + 2] = clamp255(d[i + 2] + delta);
    }
  }
  return out;
}

export function blindsImageData(source, width = 10, color = "#000000", opacity = 30, direction = "horizontal", selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const b = regionBounds(source, selection);
  const fill = parseHexColor(color);
  width = Math.max(2, Math.min(200, Math.round(Number(width) || 10)));
  const alpha = Math.max(0, Math.min(1, Number(opacity) / 100));

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const p = direction === "vertical" ? x - b.x0 : y - b.y0;
      if (Math.floor(p / width) % 2 === 0) continue;
      const i = (y * source.width + x) * 4;
      d[i] = clamp255(d[i] * (1 - alpha) + fill[0] * alpha);
      d[i + 1] = clamp255(d[i + 1] * (1 - alpha) + fill[1] * alpha);
      d[i + 2] = clamp255(d[i + 2] * (1 - alpha) + fill[2] * alpha);
    }
  }
  return out;
}

function hash01(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function supernovaImageData(source, centerX, centerY, radius = 100, rays = 24, color = "#fff2a0", randomHue = false, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const b = regionBounds(source, selection);
  const cx = Number.isFinite(Number(centerX)) ? Number(centerX) : (b.x0 + b.x1) / 2;
  const cy = Number.isFinite(Number(centerY)) ? Number(centerY) : (b.y0 + b.y1) / 2;
  radius = Math.max(5, Number(radius) || 100);
  rays = Math.max(4, Math.min(200, Math.round(Number(rays) || 24)));
  const base = parseHexColor(color);

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const angle = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
      const rayPos = angle * rays;
      const rayIndex = Math.floor(rayPos);
      const rayDistance = Math.abs(rayPos - Math.round(rayPos));
      const ray = Math.pow(Math.max(0, 1 - rayDistance * 7), 3);
      const core = Math.pow(Math.max(0, 1 - dist / radius), 2);
      const alpha = Math.min(1, core * 0.75 + ray * core * 0.8);
      if (alpha <= 0) continue;
      let fill = base;
      if (randomHue) {
        const hue = hash01(rayIndex + 1) * 360;
        fill = hsvToRgb(hue, .65, 1);
      }
      const i = (y * source.width + x) * 4;
      d[i] = clamp255(d[i] * (1 - alpha) + fill[0] * alpha);
      d[i + 1] = clamp255(d[i + 1] * (1 - alpha) + fill[1] * alpha);
      d[i + 2] = clamp255(d[i + 2] * (1 - alpha) + fill[2] * alpha);
    }
  }
  return out;
}

export function rippleImageData(source, amplitude = 8, wavelength = 28, selection = null) {
  amplitude = Math.max(0, Math.min(100, Number(amplitude) || 0));
  wavelength = Math.max(2, Math.min(500, Number(wavelength) || 28));
  return distortImageData(source, selection, (x, y, b) => {
    const cx = (b.x0 + b.x1 - 1) / 2, cy = (b.y0 + b.y1 - 1) / 2;
    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    if (r === 0) return [x, y];
    const displacement = Math.sin(r / wavelength * Math.PI * 2) * amplitude;
    const sr = Math.max(0, r + displacement);
    return [cx + dx / r * sr, cy + dy / r * sr];
  });
}

export function newspaperImageData(source, cellSize = 4, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const b = regionBounds(source, selection);
  const matrix = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];
  cellSize = Math.max(1, Math.min(16, Math.round(Number(cellSize) || 4)));

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = (y * source.width + x) * 4;
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const mx = Math.floor((x - b.x0) / cellSize) % 4;
      const my = Math.floor((y - b.y0) / cellSize) % 4;
      const threshold = (matrix[my][mx] + .5) / 16 * 255;
      const v = gray >= threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  return out;
}

export function customFilterImageData(source, kernel, divisor = 1, offset = 0, selection = null) {
  if (!Array.isArray(kernel) || kernel.length !== 9) {
    throw new Error("Custom filter kernel must contain 9 values");
  }
  const k = kernel.map(v => Number(v) || 0);
  divisor = Number(divisor);
  if (!Number.isFinite(divisor) || divisor === 0) divisor = 1;
  offset = Number(offset) || 0;
  return convolve3x3(source, k, divisor, offset, selection, false);
}


export function softenImageData(source, selection = null) {
  return convolve3x3(source, [1,1,1,1,1,1,1,1,1], 9, 0, selection, false);
}

export function softLensImageData(source, strength = 5, selection = null) {
  strength = Math.max(1, Math.min(10, Number(strength) || 5));
  const blurred = gaussianBlurImageData(source, Math.max(1, strength / 2), selection);
  const out = cloneImageData(source);
  const dst = out.data, src = source.data, blur = blurred.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  const alpha = Math.min(.8, strength / 12);

  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      dst[i] = clamp255(src[i] * (1 - alpha) + blur[i] * alpha + strength * 0.7);
      dst[i + 1] = clamp255(src[i + 1] * (1 - alpha) + blur[i + 1] * alpha + strength * 0.7);
      dst[i + 2] = clamp255(src[i + 2] * (1 - alpha) + blur[i + 2] * alpha + strength * 0.7);
    }
  }
  return out;
}

export function motionBlurImageData(source, distance = 8, angle = 0, selection = null) {
  const out = cloneImageData(source);
  const src = source.data, dst = out.data;
  const w = source.width, h = source.height;
  const b = regionBounds(source, selection);
  distance = Math.max(1, Math.min(100, Math.round(Number(distance) || 8)));
  const rad = Number(angle) * Math.PI / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const samples = Math.min(31, distance * 2 + 1);

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const di = (y * w + x) * 4;
      let rr = 0, gg = 0, bb = 0, aa = 0, count = 0;
      for (let n = 0; n < samples; n++) {
        const t = (n / Math.max(1, samples - 1) - .5) * distance;
        const sx = x + dx * t, sy = y + dy * t;
        if (sx < b.x0 || sx >= b.x1 || sy < b.y0 || sy >= b.y1) continue;
        rr += sampleBilinear(src, w, h, sx, sy, 0);
        gg += sampleBilinear(src, w, h, sx, sy, 1);
        bb += sampleBilinear(src, w, h, sx, sy, 2);
        aa += sampleBilinear(src, w, h, sx, sy, 3);
        count++;
      }
      if (count) {
        dst[di] = clamp255(rr / count);
        dst[di + 1] = clamp255(gg / count);
        dst[di + 2] = clamp255(bb / count);
        dst[di + 3] = clamp255(aa / count);
      }
    }
  }
  return out;
}

export function bevelImageData(source, width = 8, inset = false, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const b = regionBounds(source, selection);
  width = Math.max(1, Math.min(100, Math.round(Number(width) || 8)));
  const sign = inset ? -1 : 1;

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const left = x - b.x0;
      const right = b.x1 - 1 - x;
      const top = y - b.y0;
      const bottom = b.y1 - 1 - y;
      let shade = 0;
      if (top < width) shade += sign * (1 - top / width) * 70;
      if (left < width) shade += sign * (1 - left / width) * 70;
      if (bottom < width) shade -= sign * (1 - bottom / width) * 70;
      if (right < width) shade -= sign * (1 - right / width) * 70;
      if (!shade) continue;
      const i = (y * source.width + x) * 4;
      d[i] = clamp255(d[i] + shade);
      d[i + 1] = clamp255(d[i + 1] + shade);
      d[i + 2] = clamp255(d[i + 2] + shade);
    }
  }
  return out;
}

export function silkScreenImageData(source, cellSize = 5, angle = 45, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const b = regionBounds(source, selection);
  cellSize = Math.max(2, Math.min(30, Math.round(Number(cellSize) || 5)));
  const rad = Number(angle) * Math.PI / 180;
  const cs = Math.cos(rad), sn = Math.sin(rad);

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = (y * source.width + x) * 4;
      const gray = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const u = (x * cs + y * sn) / cellSize;
      const v = (-x * sn + y * cs) / cellSize;
      const fx = u - Math.floor(u) - .5;
      const fy = v - Math.floor(v) - .5;
      const radius = Math.sqrt(Math.max(0, 1 - gray)) * .52;
      const ink = Math.hypot(fx, fy) < radius ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = ink;
    }
  }
  return out;
}


export function colorScaleImageData(source, color = "#ff0000", selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const target = parseHexColor(color);
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      d[i] = clamp255(target[0] * lum);
      d[i + 1] = clamp255(target[1] * lum);
      d[i + 2] = clamp255(target[2] * lum);
    }
  }
  return out;
}

export function rgbExchangeImageData(source, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = g;
      d[i + 1] = b;
      d[i + 2] = r;
    }
  }
  return out;
}

export function xorColorImageData(source, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const { x0, y0, x1, y1 } = regionBounds(source, selection);
  for (let y = y0; y < y1; y++) {
    let i = (y * source.width + x0) * 4;
    const end = (y * source.width + x1) * 4;
    for (; i < end; i += 4) {
      d[i] ^= 128;
      d[i + 1] ^= 128;
      d[i + 2] ^= 128;
    }
  }
  return out;
}

export function gradientImageData(source, startColor, endColor, direction = "horizontal", opacity = 50, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const start = parseHexColor(startColor);
  const end = parseHexColor(endColor);
  const b = regionBounds(source, selection);
  const alpha = Math.max(0, Math.min(1, Number(opacity) / 100));
  const width = Math.max(1, b.x1 - b.x0 - 1);
  const height = Math.max(1, b.y1 - b.y0 - 1);

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      let t;
      switch (direction) {
        case "vertical":
          t = (y - b.y0) / height;
          break;
        case "diag-down":
          t = ((x - b.x0) / width + (y - b.y0) / height) / 2;
          break;
        case "diag-up":
          t = ((x - b.x0) / width + 1 - (y - b.y0) / height) / 2;
          break;
        default:
          t = (x - b.x0) / width;
      }
      const gr = start[0] * (1 - t) + end[0] * t;
      const gg = start[1] * (1 - t) + end[1] * t;
      const gb = start[2] * (1 - t) + end[2] * t;
      const i = (y * source.width + x) * 4;
      d[i] = clamp255(d[i] * (1 - alpha) + gr * alpha);
      d[i + 1] = clamp255(d[i + 1] * (1 - alpha) + gg * alpha);
      d[i + 2] = clamp255(d[i + 2] * (1 - alpha) + gb * alpha);
    }
  }
  return out;
}

export function shadowHighlightImageData(source, shadows = 0, highlights = 0, selection = null) {
  const out = cloneImageData(source);
  const d = out.data;
  const b = regionBounds(source, selection);
  shadows = Math.max(-100, Math.min(100, Number(shadows) || 0));
  highlights = Math.max(-100, Math.min(100, Number(highlights) || 0));

  for (let y = b.y0; y < b.y1; y++) {
    let i = (y * source.width + b.x0) * 4;
    const end = (y * source.width + b.x1) * 4;
    for (; i < end; i += 4) {
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const shadowWeight = Math.pow(1 - lum, 2);
      const highlightWeight = Math.pow(lum, 2);
      const delta = shadows * 1.8 * shadowWeight - highlights * 1.8 * highlightWeight;
      d[i] = clamp255(d[i] + delta);
      d[i + 1] = clamp255(d[i + 1] + delta);
      d[i + 2] = clamp255(d[i + 2] + delta);
    }
  }
  return out;
}

export function transparentColorImageData(source, color = "#ffffff", tolerance = 0) {
  const out = cloneImageData(source);
  const d = out.data;
  const target = parseHexColor(color);
  tolerance = Math.max(0, Math.min(255, Number(tolerance) || 0));

  for (let i = 0; i < d.length; i += 4) {
    if (
      Math.abs(d[i] - target[0]) <= tolerance &&
      Math.abs(d[i + 1] - target[1]) <= tolerance &&
      Math.abs(d[i + 2] - target[2]) <= tolerance
    ) d[i + 3] = 0;
  }
  return out;
}

export function usedColorCount(source) {
  // 24-bit RGB has 16,777,216 possible values. One bit per color is only 2 MiB,
  // and avoids a potentially enormous JS Set for photographs.
  const bits = new Uint8Array(1 << 21);
  const d = source.data;
  let count = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const value = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    const byte = value >> 3;
    const mask = 1 << (value & 7);
    if ((bits[byte] & mask) === 0) {
      bits[byte] |= mask;
      count++;
    }
  }
  return count;
}

function nearestPaletteValue(value, levels) {
  if (levels <= 1) return value >= 128 ? 255 : 0;
  return Math.round(Math.round(value / 255 * (levels - 1)) * 255 / (levels - 1));
}

function quantizeChannels(r, g, b, mode) {
  if (mode === "256") return [nearestPaletteValue(r, 8), nearestPaletteValue(g, 8), nearestPaletteValue(b, 4)];
  if (mode === "16") return [nearestPaletteValue(r, 2), nearestPaletteValue(g, 4), nearestPaletteValue(b, 2)];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const v = lum >= 128 ? 255 : 0;
  return [v, v, v];
}

export function colorDepthImageData(source, mode = "256", dither = false) {
  if (mode === "24") return cloneImageData(source);
  const out = cloneImageData(source);
  const d = out.data;
  const w = source.width, h = source.height;

  if (!dither) {
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = quantizeChannels(d[i], d[i + 1], d[i + 2], mode);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    return out;
  }

  const work = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) work[i] = d[i];

  const addError = (x, y, er, eg, eb, factor) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    work[i] += er * factor;
    work[i + 1] += eg * factor;
    work[i + 2] += eb * factor;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const oldR = Math.max(0, Math.min(255, work[i]));
      const oldG = Math.max(0, Math.min(255, work[i + 1]));
      const oldB = Math.max(0, Math.min(255, work[i + 2]));
      const [nr, ng, nb] = quantizeChannels(oldR, oldG, oldB, mode);
      d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      const er = oldR - nr, eg = oldG - ng, eb = oldB - nb;
      addError(x + 1, y, er, eg, eb, 7 / 16);
      addError(x - 1, y + 1, er, eg, eb, 3 / 16);
      addError(x, y + 1, er, eg, eb, 5 / 16);
      addError(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }
  return out;
}


export function redEyeImageData(source, selection = null, strength = 80) {
  const out = cloneImageData(source);
  const d = out.data;
  const b = regionBounds(source, selection);
  const mix = Math.max(0, Math.min(1, Number(strength) / 100));

  for (let y = b.y0; y < b.y1; y++) {
    let i = (y * source.width + b.x0) * 4;
    const end = (y * source.width + b.x1) * 4;
    for (; i < end; i += 4) {
      const r = d[i], g = d[i + 1], bl = d[i + 2];
      const base = (g + bl) / 2;
      const redness = r - Math.max(g, bl);
      if (r > 70 && redness > 25 && r > g * 1.25 && r > bl * 1.2) {
        const targetR = Math.min(r, base * 1.05);
        d[i] = clamp255(r * (1 - mix) + targetR * mix);
      }
    }
  }
  return out;
}

function neighborhoodStatisticImageData(source, mode = "median", radius = 1, selection = null) {
  const out = cloneImageData(source);
  const src = source.data, dst = out.data;
  const w = source.width, h = source.height;
  const b = regionBounds(source, selection);
  radius = Math.max(1, Math.min(2, Math.round(Number(radius) || 1)));
  const valuesR = [], valuesG = [], valuesB = [];

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      valuesR.length = valuesG.length = valuesB.length = 0;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(w - 1, x + radius); xx++) {
          const si = (yy * w + xx) * 4;
          valuesR.push(src[si]); valuesG.push(src[si + 1]); valuesB.push(src[si + 2]);
        }
      }
      const di = (y * w + x) * 4;
      if (mode === "min") {
        dst[di] = Math.min(...valuesR); dst[di + 1] = Math.min(...valuesG); dst[di + 2] = Math.min(...valuesB);
      } else if (mode === "max") {
        dst[di] = Math.max(...valuesR); dst[di + 1] = Math.max(...valuesG); dst[di + 2] = Math.max(...valuesB);
      } else {
        valuesR.sort((a,b)=>a-b); valuesG.sort((a,b)=>a-b); valuesB.sort((a,b)=>a-b);
        const mid = Math.floor(valuesR.length / 2);
        dst[di] = valuesR[mid]; dst[di + 1] = valuesG[mid]; dst[di + 2] = valuesB[mid];
      }
    }
  }
  return out;
}

export function denoiseImageData(source, level = 1, selection = null) {
  level = Math.max(1, Math.min(5, Math.round(Number(level) || 1)));
  let current = source;
  for (let pass = 0; pass < Math.ceil(level / 2); pass++) {
    current = neighborhoodStatisticImageData(current, "median", level >= 4 ? 2 : 1, selection);
  }
  return current;
}

export function densityExtractImageData(source, mode = "median", selection = null) {
  return neighborhoodStatisticImageData(source, mode, 1, selection);
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
