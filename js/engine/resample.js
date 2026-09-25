const kernels = {
  box: {
    support: 0.5,
    fn: x => Math.abs(x) <= 0.5 ? 1 : 0
  },
  hermite: {
    support: 1,
    fn: x => {
      x = Math.abs(x);
      if (x >= 1) return 0;
      return (2 * x - 3) * x * x + 1;
    }
  },
  triangle: {
    support: 1,
    fn: x => {
      x = Math.abs(x);
      return x < 1 ? 1 - x : 0;
    }
  },
  bell: {
    support: 1.5,
    fn: x => {
      x = Math.abs(x);
      if (x < 0.5) return 0.75 - x * x;
      if (x < 1.5) {
        const t = x - 1.5;
        return 0.5 * t * t;
      }
      return 0;
    }
  },
  mitchell: {
    support: 2,
    fn: x => {
      const B = 1 / 3;
      const C = 1 / 3;
      x = Math.abs(x);
      const x2 = x * x;
      const x3 = x2 * x;
      if (x < 1) {
        return ((12 - 9 * B - 6 * C) * x3 + (-18 + 12 * B + 6 * C) * x2 + (6 - 2 * B)) / 6;
      }
      if (x < 2) {
        return ((-B - 6 * C) * x3 + (6 * B + 30 * C) * x2 + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6;
      }
      return 0;
    }
  },
  bspline: {
    support: 2,
    fn: x => {
      x = Math.abs(x);
      if (x < 1) return (4 + x * x * (-6 + 3 * x)) / 6;
      if (x < 2) {
        const t = 2 - x;
        return t * t * t / 6;
      }
      return 0;
    }
  },
  lanczos3: {
    support: 3,
    fn: x => {
      x = Math.abs(x);
      if (x === 0) return 1;
      if (x >= 3) return 0;
      const pix = Math.PI * x;
      return (Math.sin(pix) / pix) * (Math.sin(pix / 3) / (pix / 3));
    }
  }
};

function buildContributors(srcSize, dstSize, kernel) {
  const scale = dstSize / srcSize;
  const filterScale = Math.min(1, scale);
  const radius = kernel.support / filterScale;
  const out = new Array(dstSize);

  for (let d = 0; d < dstSize; d++) {
    const center = (d + 0.5) / scale - 0.5;
    const left = Math.ceil(center - radius);
    const right = Math.floor(center + radius);
    const merged = new Map();
    let total = 0;

    for (let s = left; s <= right; s++) {
      const clamped = Math.max(0, Math.min(srcSize - 1, s));
      const weight = kernel.fn((center - s) * filterScale);
      if (weight === 0) continue;
      merged.set(clamped, (merged.get(clamped) || 0) + weight);
      total += weight;
    }

    if (total === 0) {
      const nearest = Math.max(0, Math.min(srcSize - 1, Math.round(center)));
      out[d] = { indices: [nearest], weights: [1] };
      continue;
    }

    const indices = [];
    const weights = [];
    for (const [index, weight] of merged) {
      indices.push(index);
      weights.push(weight / total);
    }
    out[d] = { indices, weights };
  }
  return out;
}

export function nearestNeighborResize(source, dstWidth, dstHeight) {
  const srcWidth = source.width;
  const srcHeight = source.height;
  const src = source.data;
  const out = new ImageData(dstWidth, dstHeight);
  const dst = out.data;

  for (let y = 0; y < dstHeight; y++) {
    const sy = Math.min(srcHeight - 1, Math.floor((y + 0.5) * srcHeight / dstHeight));
    for (let x = 0; x < dstWidth; x++) {
      const sx = Math.min(srcWidth - 1, Math.floor((x + 0.5) * srcWidth / dstWidth));
      const si = (sy * srcWidth + sx) * 4;
      const di = (y * dstWidth + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return out;
}

export function resizeImageData(source, dstWidth, dstHeight, method = "lanczos3") {
  dstWidth = Math.max(1, Math.round(dstWidth));
  dstHeight = Math.max(1, Math.round(dstHeight));
  if (source.width === dstWidth && source.height === dstHeight) {
    return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  }

  const kernel = kernels[method] || kernels.lanczos3;
  const xContrib = buildContributors(source.width, dstWidth, kernel);
  const yContrib = buildContributors(source.height, dstHeight, kernel);
  const horizontal = new Float32Array(dstWidth * source.height * 4);
  const src = source.data;

  for (let y = 0; y < source.height; y++) {
    for (let dx = 0; dx < dstWidth; dx++) {
      const c = xContrib[dx];
      const di = (y * dstWidth + dx) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < c.indices.length; k++) {
        const si = (y * source.width + c.indices[k]) * 4;
        const w = c.weights[k];
        r += src[si] * w;
        g += src[si + 1] * w;
        b += src[si + 2] * w;
        a += src[si + 3] * w;
      }
      horizontal[di] = r;
      horizontal[di + 1] = g;
      horizontal[di + 2] = b;
      horizontal[di + 3] = a;
    }
  }

  const output = new ImageData(dstWidth, dstHeight);
  const dst = output.data;

  for (let dy = 0; dy < dstHeight; dy++) {
    const c = yContrib[dy];
    for (let x = 0; x < dstWidth; x++) {
      const di = (dy * dstWidth + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < c.indices.length; k++) {
        const si = (c.indices[k] * dstWidth + x) * 4;
        const w = c.weights[k];
        r += horizontal[si] * w;
        g += horizontal[si + 1] * w;
        b += horizontal[si + 2] * w;
        a += horizontal[si + 3] * w;
      }
      dst[di] = Math.max(0, Math.min(255, Math.round(r)));
      dst[di + 1] = Math.max(0, Math.min(255, Math.round(g)));
      dst[di + 2] = Math.max(0, Math.min(255, Math.round(b)));
      dst[di + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }

  return output;
}

export const resamplingMethods = Object.keys(kernels);
