export class AppState {
  constructor() {
    this.document = null;
    this.selection = null;
    this.zoom = 1;
    this.busy = false;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this);
  }

  setDocument(meta) {
    this.document = meta;
    this.selection = null;
    this.emit();
  }

  markModified(modified = true) {
    if (this.document) this.document.modified = modified;
    this.emit();
  }

  setSelection(selection) {
    this.selection = selection;
    this.emit();
  }

  clearSelection() {
    if (!this.selection) return;
    this.selection = null;
    this.emit();
  }

  setZoom(zoom) {
    this.zoom = zoom;
    this.emit();
  }

  setBusy(busy) {
    this.busy = busy;
    this.emit();
  }
}