export async function decodeFileToCanvas(file, canvas) {
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
    modified: false
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
    modified: true
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

export function saveCanvas(canvas, type = "image/png", quality = .92, baseName = "image") {
  const source = type === "image/jpeg" ? compositeForJpeg(canvas) : canvas;
  const extension = type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
  const safeBase = (baseName || "image").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_") || "image";
  source.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeBase}.${extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }, type, quality);
}