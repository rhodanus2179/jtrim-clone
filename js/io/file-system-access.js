const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "ico"
]);

export function getFileSystemCapabilities(scope = globalThis) {
  const win = scope?.window || scope;
  const handleProto = scope?.FileSystemHandle?.prototype;
  return {
    directoryPicker: typeof win?.showDirectoryPicker === "function",
    openFilePicker: typeof win?.showOpenFilePicker === "function",
    saveFilePicker: typeof win?.showSaveFilePicker === "function",
    permissionQuery: typeof handleProto?.queryPermission === "function",
    permissionRequest: typeof handleProto?.requestPermission === "function"
  };
}

export function isLikelyImageName(name) {
  const match = /\.([^.]+)$/.exec(String(name || "").toLowerCase());
  return Boolean(match && IMAGE_EXTENSIONS.has(match[1]));
}

export async function pickWorkspaceDirectory({
  mode = "read",
  id = "jtrim-workspace",
  startIn = "pictures"
} = {}) {
  if (typeof window?.showDirectoryPicker !== "function") {
    throw new Error("File System Access API はこのブラウザでは利用できません。");
  }
  return await window.showDirectoryPicker({ mode, id, startIn });
}

export async function pickSaveFileHandle({
  suggestedName = "image.png",
  type = "image/png",
  id = "jtrim-save"
} = {}) {
  if (typeof window?.showSaveFilePicker !== "function") {
    throw new Error("showSaveFilePicker() はこのブラウザでは利用できません。");
  }

  const extensions = type === "image/jpeg"
    ? [".jpg", ".jpeg"]
    : type === "image/webp"
      ? [".webp"]
      : [".png"];
  const description = type === "image/jpeg"
    ? "JPEG画像"
    : type === "image/webp"
      ? "WebP画像"
      : "PNG画像";

  return await window.showSaveFilePicker({
    id,
    suggestedName,
    types: [{
      description,
      accept: { [type]: extensions }
    }]
  });
}

export async function pickOutputDirectory({
  id = "jtrim-output",
  startIn = "pictures"
} = {}) {
  return await pickWorkspaceDirectory({ mode: "readwrite", id, startIn });
}

export async function queryHandlePermission(handle, { write = false } = {}) {
  if (!handle) return "denied";
  const mode = write ? "readwrite" : "read";
  if (typeof handle.queryPermission !== "function") return "unsupported";
  try {
    return await handle.queryPermission({ mode });
  } catch {
    return "denied";
  }
}

export async function ensureHandlePermission(handle, {
  write = false,
  request = false
} = {}) {
  if (!handle) return false;
  const mode = write ? "readwrite" : "read";
  if (typeof handle.queryPermission !== "function") return true;

  try {
    const current = await handle.queryPermission({ mode });
    if (current === "granted") return true;
    if (!request || typeof handle.requestPermission !== "function") return false;
    return (await handle.requestPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

export async function listDirectory(directoryHandle, {
  includeFiles = true,
  includeDirectories = true
} = {}) {
  if (!directoryHandle || directoryHandle.kind !== "directory") {
    throw new TypeError("DirectoryHandle が必要です。");
  }

  const entries = [];
  for await (const entry of directoryHandle.values()) {
    if (entry.kind === "file" && !includeFiles) continue;
    if (entry.kind === "directory" && !includeDirectories) continue;
    entries.push({
      kind: entry.kind,
      name: entry.name,
      handle: entry,
      size: null,
      lastModified: null,
      mimeType: null,
      thumbnailUrl: null
    });
  }
  return entries;
}

export async function getFileFromHandle(fileHandle) {
  if (!fileHandle || fileHandle.kind !== "file") {
    throw new TypeError("FileHandle が必要です。");
  }
  return await fileHandle.getFile();
}

export async function populateFileMetadata(entry) {
  if (!entry || entry.kind !== "file") return entry;
  if (entry.size != null && entry.lastModified != null) return entry;
  const file = await getFileFromHandle(entry.handle);
  entry.size = file.size;
  entry.lastModified = file.lastModified;
  entry.mimeType = file.type;
  return entry;
}

export async function writeBlobToFileHandle(fileHandle, blob) {
  if (!(await ensureHandlePermission(fileHandle, { write: true, request: true }))) {
    throw new DOMException("書き込み権限がありません。", "NotAllowedError");
  }
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch {}
    throw error;
  }
}

export async function createFileInDirectory(directoryHandle, name, blob, {
  overwrite = false
} = {}) {
  if (!(await ensureHandlePermission(directoryHandle, { write: true, request: true }))) {
    throw new DOMException("フォルダへの書き込み権限がありません。", "NotAllowedError");
  }

  if (!overwrite) {
    try {
      await directoryHandle.getFileHandle(name);
      throw new DOMException("同名ファイルが既に存在します。", "InvalidModificationError");
    } catch (error) {
      if (error?.name !== "NotFoundError") throw error;
    }
  }

  const handle = await directoryHandle.getFileHandle(name, { create: true });
  await writeBlobToFileHandle(handle, blob);
  return handle;
}

export async function getOrCreateDirectory(parentHandle, name) {
  if (!(await ensureHandlePermission(parentHandle, { write: true, request: true }))) {
    throw new DOMException("フォルダへの書き込み権限がありません。", "NotAllowedError");
  }
  return await parentHandle.getDirectoryHandle(name, { create: true });
}


export async function getDroppedFileSystemHandles(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const handles = [];
  for (const item of items) {
    if (item.kind !== "file" || typeof item.getAsFileSystemHandle !== "function") continue;
    try {
      const handle = await item.getAsFileSystemHandle();
      if (handle) handles.push(handle);
    } catch {
      // Fall back to DataTransfer.files in the caller.
    }
  }
  return handles;
}

export async function walkDirectory(directoryHandle, {
  recursive = true,
  imageOnly = false,
  excludeHandles = [],
  maxFiles = 20000
} = {}) {
  if (!directoryHandle || directoryHandle.kind !== "directory") {
    throw new TypeError("DirectoryHandle が必要です。");
  }

  const results = [];
  const excluded = excludeHandles.filter(Boolean);

  async function isExcluded(handle) {
    for (const candidate of excluded) {
      if (await isSameHandle(handle, candidate)) return true;
    }
    return false;
  }

  async function visit(dirHandle, pathParts) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "directory") {
        if (!recursive || await isExcluded(entry)) continue;
        await visit(entry, [...pathParts, entry.name]);
        continue;
      }

      if (entry.kind !== "file") continue;
      if (imageOnly && !isLikelyImageName(entry.name)) continue;
      results.push({
        kind: "file",
        name: entry.name,
        handle: entry,
        parentHandle: dirHandle,
        relativePath: [...pathParts, entry.name].join("/")
      });
      if (results.length >= maxFiles) {
        throw new Error(`対象ファイルが${maxFiles.toLocaleString()}件を超えました。対象フォルダを分けてください。`);
      }
    }
  }

  await visit(directoryHandle, []);
  return results;
}

export async function getOrCreateDirectoryPath(rootHandle, pathParts = []) {
  let current = rootHandle;
  for (const rawName of pathParts) {
    const name = String(rawName || "").trim();
    if (!name || name === "." || name === ".." || /[\\/:*?"<>|]/.test(name)) {
      throw new Error(`出力フォルダ名が不正です: ${rawName}`);
    }
    current = await getOrCreateDirectory(current, name);
  }
  return current;
}

async function digestBytes(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map(v => v.toString(16).padStart(2, "0")).join("");
}

export async function createFileSnapshot(file, {
  sampleBytes = 65536
} = {}) {
  if (!file) return null;
  const size = file.size ?? 0;
  const headEnd = Math.min(size, sampleBytes);
  const tailStart = Math.max(headEnd, size - sampleBytes);
  const [head, tail] = await Promise.all([
    file.slice(0, headEnd).arrayBuffer(),
    tailStart < size ? file.slice(tailStart, size).arrayBuffer() : Promise.resolve(new ArrayBuffer(0))
  ]);
  const combined = new Uint8Array(head.byteLength + tail.byteLength + 16);
  combined.set(new Uint8Array(head), 0);
  combined.set(new Uint8Array(tail), head.byteLength);
  const view = new DataView(combined.buffer);
  const meta = head.byteLength + tail.byteLength;
  view.setBigUint64(meta, BigInt(size), true);
  view.setBigUint64(meta + 8, BigInt(file.lastModified || 0), true);

  return {
    size,
    lastModified: file.lastModified || 0,
    fingerprint: await digestBytes(combined)
  };
}

export function fileSnapshotChanged(previous, current) {
  if (!previous || !current) return false;
  if (previous.size !== current.size || previous.lastModified !== current.lastModified) return true;
  if (previous.fingerprint && current.fingerprint) {
    return previous.fingerprint !== current.fingerprint;
  }
  return false;
}

export async function isSameHandle(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (typeof a.isSameEntry !== "function") return false;
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
}
