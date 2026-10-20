// Input recognition only. HEIC decoding is enabled separately after the P0 codec gate.
// An extension or MIME type is a hint, never a proof that the file is decodable.
const HEIC_MIME = new Set([
  "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"
]);
const HEIC_EXTENSION = /\.(?:heic|heif)$/i;
const HEVC_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"
]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIF_CONTAINER_BRANDS = new Set(["mif1", "msf1"]);

function candidateName(candidate) {
  return typeof candidate === "string" ? candidate : candidate?.name || "";
}

export function isHeicCandidate(candidate) {
  if (!candidate) return false;
  const type = typeof candidate === "string" ? "" : String(candidate.type || "").toLowerCase();
  return HEIC_MIME.has(type) || HEIC_EXTENSION.test(candidateName(candidate));
}

export function isSupportedInputImage(file) {
  if (!file) return false;
  return String(file.type || "").toLowerCase().startsWith("image/") || isHeicCandidate(file);
}

// Read only the ftyp box's brands. This does not perform full ISO-BMFF validation.
export function inspectHeifFtyp(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const empty = { family: "not-heif", brands: [] };
  if (data.length < 16) return empty;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const size = view.getUint32(0);
  if (size === 0 || size === 1 || size < 16 || size > data.length) return empty;
  if (String.fromCharCode(...data.subarray(4, 8)) !== "ftyp") return empty;
  const fourcc = (offset) => String.fromCharCode(...data.subarray(offset, offset + 4));
  const brands = [fourcc(8)];
  for (let offset = 16; offset + 4 <= size; offset += 4) brands.push(fourcc(offset));
  const has = (set) => brands.some(brand => set.has(brand));
  return {
    family: has(HEVC_BRANDS) ? "hevc" : has(AVIF_BRANDS) ? "avif" : has(HEIF_CONTAINER_BRANDS) ? "heif-unknown" : "not-heif",
    brands
  };
}

export async function inspectHeifFile(file, { maxHeaderBytes = 4096 } = {}) {
  if (!file || typeof file.slice !== "function") return { family: "not-heif", brands: [] };
  const first = await file.slice(0, Math.max(16, maxHeaderBytes)).arrayBuffer();
  return inspectHeifFtyp(first);
}
