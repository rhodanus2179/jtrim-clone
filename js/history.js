function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("スナップショットを作成できませんでした")), "image/png");
  });
}

async function restoreBlob(blob, canvas) {
  const bitmap = await createImageBitmap(blob);
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
}

export class HistoryManager {
  constructor(limit = 16) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  async snapshot(canvas, label = "編集") {
    const blob = await canvasToBlob(canvas);
    this.undoStack.push({ blob, label, width: canvas.width, height: canvas.height });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  async undo(canvas) {
    if (!this.canUndo) return null;
    const current = await canvasToBlob(canvas);
    const target = this.undoStack.pop();
    this.redoStack.push({ blob: current, label: target.label, width: canvas.width, height: canvas.height });
    await restoreBlob(target.blob, canvas);
    return target;
  }

  async redo(canvas) {
    if (!this.canRedo) return null;
    const current = await canvasToBlob(canvas);
    const target = this.redoStack.pop();
    this.undoStack.push({ blob: current, label: target.label, width: canvas.width, height: canvas.height });
    await restoreBlob(target.blob, canvas);
    return target;
  }
}