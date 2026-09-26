const STD_LUMA = [
  16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,
  14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,
  18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,
  49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99
];

const ZIGZAG = [
  0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,
  12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,
  35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,
  58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63
];

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function estimateQuality(table) {
  if (!table || table.length !== 64) return null;
  const scales = [];
  for (let i = 0; i < 64; i++) {
    if (!STD_LUMA[i]) continue;
    scales.push((table[i] * 100) / STD_LUMA[ZIGZAG[i]]);
  }
  const scale = median(scales);
  if (!scale || !Number.isFinite(scale)) return null;
  const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
  return Math.max(1, Math.min(100, Math.round(quality)));
}

function samplingName(components) {
  if (!components || components.length < 3) return null;
  const y = components[0];
  const cb = components[1];
  const cr = components[2];
  if (!y || !cb || !cr) return null;
  const yH = y.h, yV = y.v;
  if (cb.h === 1 && cb.v === 1 && cr.h === 1 && cr.v === 1) {
    if (yH === 1 && yV === 1) return "4:4:4";
    if (yH === 2 && yV === 1) return "4:2:2";
    if (yH === 2 && yV === 2) return "4:2:0";
    if (yH === 1 && yV === 2) return "4:4:0";
  }
  return `Y ${yH}x${yV} / Cb ${cb.h}x${cb.v} / Cr ${cr.h}x${cr.v}`;
}

export function jpegSubsamplingCode(info) {
  if (!info) return null;
  if (info.componentCount === 1) return "gray";
  switch (info.sampling) {
    case "4:4:4": return "444";
    case "4:2:2": return "422";
    case "4:2:0": return "420";
    case "4:4:0": return "440";
    default: return null;
  }
}

export async function parseJpegInfo(blob) {
  if (!blob?.arrayBuffer) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const info = {
    size: bytes.length,
    width: null,
    height: null,
    precision: null,
    components: [],
    componentCount: null,
    progressive: false,
    arithmetic: false,
    sofMarker: null,
    sampling: null,
    restartInterval: null,
    quantizationTables: {},
    estimatedQuality: null,
    hasExif: false,
    hasIcc: false,
    comments: []
  };

  let pos = 2;
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) { pos++; continue; }
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;
    const marker = bytes[pos++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > bytes.length) break;
    const length = (bytes[pos] << 8) | bytes[pos + 1];
    if (length < 2 || pos + length > bytes.length) break;
    const start = pos + 2;
    const end = pos + length;

    if (marker === 0xe1 && end - start >= 6 &&
        bytes[start] === 0x45 && bytes[start+1] === 0x78 && bytes[start+2] === 0x69 && bytes[start+3] === 0x66) {
      info.hasExif = true;
    } else if (marker === 0xe2 && end - start >= 12) {
      const text = String.fromCharCode(...bytes.slice(start, Math.min(end, start + 12)));
      if (text.startsWith("ICC_PROFILE")) info.hasIcc = true;
    } else if (marker === 0xfe) {
      try { info.comments.push(new TextDecoder("latin1").decode(bytes.slice(start, end))); } catch {}
    } else if (marker === 0xdb) {
      let p = start;
      while (p < end) {
        const pqTq = bytes[p++];
        const precision = pqTq >> 4;
        const id = pqTq & 0x0f;
        const table = [];
        for (let i = 0; i < 64 && p < end; i++) {
          if (precision === 0) table.push(bytes[p++]);
          else {
            if (p + 1 >= end) break;
            table.push((bytes[p] << 8) | bytes[p + 1]);
            p += 2;
          }
        }
        if (table.length === 64) info.quantizationTables[id] = table;
      }
    } else if (marker === 0xdd && end - start >= 2) {
      info.restartInterval = (bytes[start] << 8) | bytes[start + 1];
    } else if (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
      marker === 0xc5 || marker === 0xc6 || marker === 0xc7 ||
      marker === 0xc9 || marker === 0xca || marker === 0xcb ||
      marker === 0xcd || marker === 0xce || marker === 0xcf
    ) {
      info.sofMarker = marker;
      info.progressive = marker === 0xc2 || marker === 0xca;
      info.arithmetic = marker >= 0xc9;
      if (end - start >= 6) {
        info.precision = bytes[start];
        info.height = (bytes[start+1] << 8) | bytes[start+2];
        info.width = (bytes[start+3] << 8) | bytes[start+4];
        info.componentCount = bytes[start+5];
        info.components = [];
        let p = start + 6;
        for (let i = 0; i < info.componentCount && p + 2 < end; i++, p += 3) {
          const sampling = bytes[p+1];
          info.components.push({
            id: bytes[p],
            h: sampling >> 4,
            v: sampling & 0x0f,
            quantTable: bytes[p+2]
          });
        }
        info.sampling = samplingName(info.components);
      }
    }
    pos = end;
  }

  info.estimatedQuality = estimateQuality(info.quantizationTables[0] || null);
  return info;
}
