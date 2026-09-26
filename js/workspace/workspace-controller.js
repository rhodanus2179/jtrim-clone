import {
  listDirectory,
  populateFileMetadata,
  queryHandlePermission
} from "../io/file-system-access.js";

function compareText(a, b) {
  return a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" });
}

export class WorkspaceController {
  constructor() {
    this.mode = "legacy";
    this.rootHandle = null;
    this.currentHandle = null;
    this.breadcrumbs = [];
    this.entries = [];
    this.permission = {
      read: "unsupported",
      readwrite: "unsupported"
    };
    this.sort = { field: "name", direction: "asc" };
    this.filter = { query: "", imageOnly: true };
  }

  get active() {
    return this.mode === "directory-handle" && Boolean(this.currentHandle);
  }

  get rootName() {
    return this.rootHandle?.name || "";
  }

  get currentName() {
    return this.currentHandle?.name || "";
  }

  get pathLabel() {
    return this.breadcrumbs.map(item => item.name).join(" / ");
  }

  async openRoot(handle) {
    if (!handle || handle.kind !== "directory") throw new TypeError("DirectoryHandle が必要です。");
    this.mode = "directory-handle";
    this.rootHandle = handle;
    this.currentHandle = handle;
    this.breadcrumbs = [{ name: handle.name, handle }];
    await this.refreshPermissions();
    return await this.refresh();
  }

  useLegacyMode() {
    this.mode = "legacy";
    this.rootHandle = null;
    this.currentHandle = null;
    this.breadcrumbs = [];
    this.entries = [];
  }

  async refreshPermissions() {
    if (!this.currentHandle) {
      this.permission.read = "unsupported";
      this.permission.readwrite = "unsupported";
      return this.permission;
    }
    this.permission.read = await queryHandlePermission(this.currentHandle, { write: false });
    this.permission.readwrite = await queryHandlePermission(this.currentHandle, { write: true });
    return this.permission;
  }

  async refresh() {
    if (!this.currentHandle) {
      this.entries = [];
      return [];
    }
    this.entries = await listDirectory(this.currentHandle);
    return this.entries;
  }

  async enterDirectory(entry) {
    const handle = entry?.handle || entry;
    if (!handle || handle.kind !== "directory") throw new TypeError("DirectoryHandle が必要です。");
    this.currentHandle = handle;
    this.breadcrumbs.push({ name: handle.name, handle });
    await this.refreshPermissions();
    return await this.refresh();
  }

  async navigateToBreadcrumb(index) {
    const target = this.breadcrumbs[index];
    if (!target) throw new RangeError("Breadcrumb index が不正です。");
    this.currentHandle = target.handle;
    this.breadcrumbs = this.breadcrumbs.slice(0, index + 1);
    await this.refreshPermissions();
    return await this.refresh();
  }

  setSort(field, direction = this.sort.direction) {
    this.sort = {
      field: ["name", "date", "size", "type"].includes(field) ? field : "name",
      direction: direction === "desc" ? "desc" : "asc"
    };
  }

  setFilter({ query = this.filter.query, imageOnly = this.filter.imageOnly } = {}) {
    this.filter = {
      query: String(query || "").trim().toLocaleLowerCase("ja"),
      imageOnly: Boolean(imageOnly)
    };
  }

  async ensureMetadataForSort() {
    if (!["date", "size", "type"].includes(this.sort.field)) return;
    await Promise.all(this.entries
      .filter(entry => entry.kind === "file")
      .map(entry => populateFileMetadata(entry).catch(() => entry)));
  }

  async visibleEntries(isImageName) {
    await this.ensureMetadataForSort();
    const query = this.filter.query;
    const imageOnly = this.filter.imageOnly;
    const direction = this.sort.direction === "desc" ? -1 : 1;

    return this.entries
      .filter(entry => {
        if (query && !entry.name.toLocaleLowerCase("ja").includes(query)) return false;
        if (imageOnly && entry.kind === "file" && !isImageName(entry.name)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
        let result = 0;
        switch (this.sort.field) {
          case "date":
            result = (a.lastModified || 0) - (b.lastModified || 0);
            break;
          case "size":
            result = (a.size || 0) - (b.size || 0);
            break;
          case "type":
            result = compareText(a.mimeType || a.name.split(".").pop() || "", b.mimeType || b.name.split(".").pop() || "");
            break;
          default:
            result = compareText(a.name, b.name);
        }
        return result * direction;
      });
  }
}
