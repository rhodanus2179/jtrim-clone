function isExifPayload(bytes, payloadStart) {
  return bytes[payloadStart] === 0x45 &&
    bytes[payloadStart + 1] === 0x78 &&
    bytes[payloadStart + 2] === 0x69 &&
    bytes[payloadStart + 3] === 0x66 &&
    bytes[payloadStart + 4] === 0 &&
    bytes[payloadStart + 5] === 0;
}

export async function extractExifSegment(blob) {
  if (!blob?.arrayBuffer) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;

    const marker = bytes[pos++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > bytes.length) break;

    const length = (bytes[pos] << 8) | bytes[pos + 1];
    if (length < 2 || pos + length > bytes.length) break;
    const markerStart = pos - 2;
    const payloadStart = pos + 2;

    if (marker === 0xe1 && length >= 8 && isExifPayload(bytes, payloadStart)) {
      return bytes.slice(markerStart, pos + length);
    }
    pos += length;
  }
  return null;
}

function tiffView(segment) {
  if (!segment || segment.length < 18 || segment[0] !== 0xff || segment[1] !== 0xe1) return null;
  if (!isExifPayload(segment, 4)) return null;
  const tiffStart = 10;
  const byte0 = segment[tiffStart];
  const byte1 = segment[tiffStart + 1];
  const littleEndian = byte0 === 0x49 && byte1 === 0x49;
  const bigEndian = byte0 === 0x4d && byte1 === 0x4d;
  if (!littleEndian && !bigEndian) return null;
  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;
  return { view, tiffStart, littleEndian };
}

function entryValueOffset(entry, type, count, view, littleEndian, tiffStart) {
  const byteSize = type === 3 ? 2 : type === 4 ? 4 : 0;
  if (!byteSize) return null;
  if (byteSize * count <= 4) return entry + 8;
  const relative = view.getUint32(entry + 8, littleEndian);
  const absolute = tiffStart + relative;
  return absolute >= 0 && absolute + byteSize * count <= view.byteLength ? absolute : null;
}

function updateDimensionTag(view, entry, type, count, value, littleEndian, tiffStart) {
  if (count !== 1) return;
  const valueOffset = entryValueOffset(entry, type, count, view, littleEndian, tiffStart);
  if (valueOffset == null) return;
  if (type === 3) view.setUint16(valueOffset, Math.max(0, Math.min(65535, value)), littleEndian);
  else if (type === 4) view.setUint32(valueOffset, Math.max(0, value) >>> 0, littleEndian);
}

function walkIfd(segment, ifdRelativeOffset, callback) {
  const info = tiffView(segment);
  if (!info) return null;
  const { view, tiffStart, littleEndian } = info;
  const ifd = tiffStart + ifdRelativeOffset;
  if (ifd < 0 || ifd + 2 > view.byteLength) return null;
  const count = view.getUint16(ifd, littleEndian);
  if (ifd + 2 + count * 12 > view.byteLength) return null;

  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    const tag = view.getUint16(entry, littleEndian);
    const type = view.getUint16(entry + 2, littleEndian);
    const itemCount = view.getUint32(entry + 4, littleEndian);
    callback({ view, tiffStart, littleEndian, entry, tag, type, count: itemCount });
  }
  return true;
}

export function readExifOrientation(segment) {
  if (!segment) return 1;
  const info = tiffView(segment);
  if (!info) return 1;
  const { view, tiffStart, littleEndian } = info;
  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  let orientation = 1;
  walkIfd(segment, ifd0Offset, item => {
    if (item.tag !== 0x0112 || item.type !== 3 || item.count !== 1) return;
    const off = entryValueOffset(item.entry, item.type, item.count, view, littleEndian, tiffStart);
    if (off == null) return;
    const value = view.getUint16(off, littleEndian);
    if (value >= 1 && value <= 8) orientation = value;
  });
  return orientation;
}

export function prepareExifSegment(segment, width, height) {
  if (!segment) return null;
  const copy = new Uint8Array(segment);
  const info = tiffView(copy);
  if (!info) return copy;
  const { view, tiffStart, littleEndian } = info;
  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  let exifIfdOffset = null;

  walkIfd(copy, ifd0Offset, item => {
    const { entry, tag, type, count } = item;
    if (tag === 0x0112 && type === 3 && count === 1) {
      const off = entryValueOffset(entry, type, count, view, littleEndian, tiffStart);
      if (off != null) view.setUint16(off, 1, littleEndian);
    } else if (tag === 0x0100) {
      updateDimensionTag(view, entry, type, count, width, littleEndian, tiffStart);
    } else if (tag === 0x0101) {
      updateDimensionTag(view, entry, type, count, height, littleEndian, tiffStart);
    } else if (tag === 0x8769 && type === 4 && count === 1) {
      const off = entryValueOffset(entry, type, count, view, littleEndian, tiffStart);
      if (off != null) exifIfdOffset = view.getUint32(off, littleEndian);
    }
  });

  if (exifIfdOffset != null) {
    walkIfd(copy, exifIfdOffset, item => {
      const { entry, tag, type, count } = item;
      if (tag === 0xa002) updateDimensionTag(view, entry, type, count, width, littleEndian, tiffStart);
      if (tag === 0xa003) updateDimensionTag(view, entry, type, count, height, littleEndian, tiffStart);
    });
  }
  return copy;
}

function stripExifSegments(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const chunks = [bytes.slice(0, 2)];
  let pos = 2;
  let rawStart = pos;

  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const markerStart = pos;
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;
    const marker = bytes[pos++];

    if (marker === 0xda || marker === 0xd9) {
      chunks.push(bytes.slice(rawStart));
      return concatBytes(chunks);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > bytes.length) break;
    const length = (bytes[pos] << 8) | bytes[pos + 1];
    if (length < 2 || pos + length > bytes.length) break;
    const payloadStart = pos + 2;
    const end = pos + length;

    if (marker === 0xe1 && length >= 8 && isExifPayload(bytes, payloadStart)) {
      if (markerStart > rawStart) chunks.push(bytes.slice(rawStart, markerStart));
      rawStart = end;
    }
    pos = end;
  }

  chunks.push(bytes.slice(rawStart));
  return concatBytes(chunks);
}

function findExifInsertionPoint(bytes) {
  let pos = 2;
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const markerStart = pos;
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    const marker = bytes[pos++];
    if (marker !== 0xe0) return markerStart;
    if (pos + 2 > bytes.length) return markerStart;
    const length = (bytes[pos] << 8) | bytes[pos + 1];
    if (length < 2 || pos + length > bytes.length) return markerStart;
    pos += length;
  }
  return pos;
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function injectExif(blob, exifSegment, width, height) {
  if (!exifSegment || blob?.type !== "image/jpeg") return blob;
  const prepared = prepareExifSegment(exifSegment, width, height);
  if (!prepared) return blob;

  const original = new Uint8Array(await blob.arrayBuffer());
  const bytes = stripExifSegments(original);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return blob;

  const insertion = findExifInsertionPoint(bytes);
  const merged = concatBytes([
    bytes.slice(0, insertion),
    prepared,
    bytes.slice(insertion)
  ]);
  return new Blob([merged], { type: "image/jpeg" });
}
