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
