import { isHeicCandidate } from "./image-format.js";

// Never permit direct overwrite of HEIC/HEIF even if the browser mislabels
// its MIME type as image/jpeg. This guard precedes all writable MIME checks.
export function writableImageType(type, fileName = "") {
  if (isHeicCandidate({ name: fileName, type })) return null;
  if (["image/jpeg", "image/png", "image/webp"].includes(type)) return type;
  const lower = String(fileName || "").toLowerCase();
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.webp$/.test(lower)) return "image/webp";
  return null;
}
