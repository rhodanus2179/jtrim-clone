import { extractExifSegment, injectExif } from "./jpeg-exif.js";
export async function decodeFileToCanvas(file, canvas) {
  const exifSegment = await extractExifSegment(file);
  const bitmap = await createImageBitmap(file);
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return {
    fileName: file.name || "image",
    sourceFormat: file.type || "image/unknown",
    width: canvas.width,
    height: canvas.height,
    modified: false,
    exifSegment
  };
}

export function createBlankCanvas(canvas, width, height, color = "#ffffff") {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return {
    fileName: "新規画像",
    sourceFormat: "image/png",
    width,
    height,
    modified: true,
    exifSegment: null
  };
}

function compositeForJpeg(canvas) {
  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  const ctx = temp.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.drawImage(canvas, 0, 0);
  return temp;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("画像をエンコードできませんでした")), type, quality);
  });
}

function extensionForType(type) {
  return type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
}

export async function encodeCanvas(canvas, type = "image/png", quality = .92, {
  exifSegment = null
} = {}) {
  const source = type === "image/jpeg" ? compositeForJpeg(canvas) : canvas;
  const blob = await canvasToBlob(source, type, quality);
  return type === "image/jpeg" && exifSegment
    ? await injectExif(blob, exifSegment, canvas.width, canvas.height)
    : blob;
}

export async function encodeJpegToTargetSize(canvas, targetBytes, {
  minQuality = .01,
  maxQuality = 1,
  iterations = 8,
  exifSegment = null
} = {}) {
  const source = compositeForJpeg(canvas);
  targetBytes = Math.max(1, Math.round(Number(targetBytes) || 1));

  const encodeCandidate = async quality => {
    const blob = await encodeCandidate(quality);
    return exifSegment ? await injectExif(blob, exifSegment, canvas.width, canvas.height) : blob;
  };

  const minimum = await encodeCandidate(minQuality);
  if (minimum.size > targetBytes) {
    return { blob: minimum, quality: minQuality, targetMet: false };
  }

  const maximum = await encodeCandidate(maxQuality);
  if (maximum.size <= targetBytes) {
    return { blob: maximum, quality: maxQuality, targetMet: true };
  }

  let low = minQuality;
  let high = maxQuality;
  let bestBlob = minimum;
  let bestQuality = minQuality;

  for (let i = 0; i < iterations; i++) {
    const quality = (low + high) / 2;
    const blob = await canvasToBlob(source, "image/jpeg", quality);
    if (blob.size <= targetBytes) {
      low = quality;
      bestBlob = blob;
      bestQuality = quality;
    } else {
      high = quality;
    }
  }

  return { blob: bestBlob, quality: bestQuality, targetMet: true };
}

export function downloadBlob(blob, baseName = "image", type = blob.type || "image/png") {
  const extension = extensionForType(type);
  const safeBase = (baseName || "image").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_") || "image";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeBase}.${extension}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function saveCanvas(canvas, type = "image/png", quality = .92, baseName = "image", options = {}) {
  const blob = await encodeCanvas(canvas, type, quality, options);
  downloadBlob(blob, baseName, type);
  return blob;
}