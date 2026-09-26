import assert from "node:assert/strict";
import {
  getFileSystemCapabilities,
  isLikelyImageName,
  listDirectory,
  getFileFromHandle,
  queryHandlePermission,
  walkDirectory,
  createFileSnapshot,
  fileSnapshotChanged
} from "../js/io/file-system-access.js";
import { WorkspaceController } from "../js/workspace/workspace-controller.js";
import { recentHandleStoreAvailable } from "../js/io/handle-store.js";

class FakeFileHandle {
  constructor(name, { size = 100, lastModified = 1, type = "image/jpeg" } = {}) {
    this.kind = "file";
    this.name = name;
    this.file = { name, size, lastModified, type };
  }
  async getFile() { return this.file; }
  async queryPermission() { return "granted"; }
  async isSameEntry(other) { return this === other; }
}

class FakeDirectoryHandle {
  constructor(name, entries = []) {
    this.kind = "directory";
    this.name = name;
    this.entries = entries;
  }
  async *values() {
    for (const entry of this.entries) yield entry;
  }
  async queryPermission({ mode } = {}) {
    return mode === "readwrite" ? "prompt" : "granted";
  }
  async isSameEntry(other) { return this === other; }
}

assert.equal(isLikelyImageName("photo.JPG"), true);
assert.equal(isLikelyImageName("notes.txt"), false);

const capabilities = getFileSystemCapabilities({});
assert.equal(capabilities.directoryPicker, false);
assert.equal(recentHandleStoreAvailable(), false);

const sub = new FakeDirectoryHandle("sub", [
  new FakeFileHandle("z.png", { size: 20, lastModified: 300, type: "image/png" })
]);
const root = new FakeDirectoryHandle("Pictures", [
  new FakeFileHandle("b.jpg", { size: 200, lastModified: 200 }),
  new FakeFileHandle("a.jpg", { size: 100, lastModified: 100 }),
  new FakeFileHandle("readme.txt", { size: 10, lastModified: 50, type: "text/plain" }),
  sub
]);

const listed = await listDirectory(root);
assert.equal(listed.length, 4);
assert.equal(await queryHandlePermission(root), "granted");
assert.equal((await getFileFromHandle(root.entries[0])).name, "b.jpg");

const recursive = await walkDirectory(root, { recursive: true, imageOnly: true });
assert.deepEqual(recursive.map(item => item.relativePath), ["b.jpg", "a.jpg", "sub/z.png"]);

const recursiveWithoutSub = await walkDirectory(root, {
  recursive: true,
  imageOnly: true,
  excludeHandles: [sub]
});
assert.deepEqual(recursiveWithoutSub.map(item => item.relativePath), ["b.jpg", "a.jpg"]);

const sampleBlob = new Blob(["abcdef"]);
Object.defineProperty(sampleBlob, "lastModified", { value: 1234 });
const snapshotA = await createFileSnapshot(sampleBlob, { sampleBytes: 3 });
const snapshotB = await createFileSnapshot(sampleBlob, { sampleBytes: 3 });
assert.equal(fileSnapshotChanged(snapshotA, snapshotB), false);

const changedBlob = new Blob(["abcdeg"]);
Object.defineProperty(changedBlob, "lastModified", { value: 1234 });
const snapshotC = await createFileSnapshot(changedBlob, { sampleBytes: 3 });
assert.equal(fileSnapshotChanged(snapshotA, snapshotC), true);

const workspace = new WorkspaceController();
await workspace.openRoot(root);
assert.equal(workspace.active, true);
assert.equal(workspace.pathLabel, "Pictures");
assert.equal(workspace.permission.read, "granted");
assert.equal(workspace.permission.readwrite, "prompt");

let visible = await workspace.visibleEntries(isLikelyImageName);
assert.deepEqual(visible.map(x => x.name), ["sub", "a.jpg", "b.jpg"]);

workspace.setFilter({ query: "b" });
visible = await workspace.visibleEntries(isLikelyImageName);
assert.deepEqual(visible.map(x => x.name), ["sub", "b.jpg"]);

workspace.setFilter({ query: "", imageOnly: false });
workspace.setSort("size", "desc");
visible = await workspace.visibleEntries(isLikelyImageName);
assert.equal(visible[0].name, "sub");
assert.deepEqual(visible.slice(1).map(x => x.name), ["b.jpg", "a.jpg", "readme.txt"]);

await workspace.enterDirectory(sub);
assert.equal(workspace.pathLabel, "Pictures / sub");
visible = await workspace.visibleEntries(isLikelyImageName);
assert.deepEqual(visible.map(x => x.name), ["z.png"]);

await workspace.navigateToBreadcrumb(0);
assert.equal(workspace.pathLabel, "Pictures");

console.log("File System Access smoke tests passed");
