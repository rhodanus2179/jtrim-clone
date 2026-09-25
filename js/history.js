async function canvasToSnapshot(canvas) {
  const bitmap = await createImageBitmap(canvas);
  return {
    bitmap,
    width: canvas.width,
    height: canvas.height,
    bytes: canvas.width * canvas.height * 4
  };
}

function release(entry) {
  entry?.bitmap?.close?.();
}

function restoreSnapshot(entry, canvas) {
  canvas.width = entry.width;
  canvas.height = entry.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(entry.bitmap, 0, 0);
}

export class HistoryManager {
  constructor(limit = 16, memoryBudget = 256 * 1024 * 1024) {
    this.limit = limit;
    this.memoryBudget = memoryBudget;
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  clearStack(stack) {
    for (const entry of stack) release(entry);
    stack.length = 0;
  }

  clear() {
    this.clearStack(this.undoStack);
    this.clearStack(this.redoStack);
  }

  totalBytes() {
    return [...this.undoStack, ...this.redoStack].reduce((sum, entry) => sum + (entry.bytes || 0), 0);
  }

  trim() {
    while (this.undoStack.length > this.limit) release(this.undoStack.shift());
    while (this.redoStack.length > this.limit) release(this.redoStack.shift());

    // Large photographs can make 16 raw snapshots excessive. Prefer responsiveness
    // and keep as many recent states as fit in the memory budget.
    while (this.totalBytes() > this.memoryBudget && this.undoStack.length > 1) {
      release(this.undoStack.shift());
    }
    while (this.totalBytes() > this.memoryBudget && this.redoStack.length > 1) {
      release(this.redoStack.shift());
    }
  }

  async snapshot(canvas, label = "編集") {
    const snap = await canvasToSnapshot(canvas);
    this.undoStack.push({ ...snap, label });
    this.clearStack(this.redoStack);
    this.trim();
  }

  async undo(canvas) {
    if (!this.canUndo) return null;
    const current = await canvasToSnapshot(canvas);
    const target = this.undoStack.pop();
    this.redoStack.push({ ...current, label: target.label });
    restoreSnapshot(target, canvas);
    release(target);
    this.trim();
    return target;
  }

  async redo(canvas) {
    if (!this.canRedo) return null;
    const current = await canvasToSnapshot(canvas);
    const target = this.redoStack.pop();
    this.undoStack.push({ ...current, label: target.label });
    restoreSnapshot(target, canvas);
    release(target);
    this.trim();
    return target;
  }
}
