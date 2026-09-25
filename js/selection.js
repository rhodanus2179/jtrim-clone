export class SelectionController {
  constructor({ canvas, overlay, state, onStatus }) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.state = state;
    this.onStatus = onStatus;
    this.drag = null;

    overlay.addEventListener("pointerdown", e => this.pointerDown(e));
    overlay.addEventListener("pointermove", e => this.pointerMove(e));
    overlay.addEventListener("pointerup", e => this.pointerUp(e));
    overlay.addEventListener("pointercancel", e => this.pointerUp(e));
    overlay.addEventListener("pointerleave", e => this.reportPointer(e));
  }

  syncSize() {
    this.overlay.width = this.canvas.width;
    this.overlay.height = this.canvas.height;
    this.render();
  }

  pointFromEvent(event) {
    const rect = this.overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(this.canvas.width, (event.clientX - rect.left) * this.canvas.width / rect.width)),
      y: Math.max(0, Math.min(this.canvas.height, (event.clientY - rect.top) * this.canvas.height / rect.height))
    };
  }

  reportPointer(event) {
    if (!this.state.document) return;
    const p = this.pointFromEvent(event);
    const x = Math.max(0, Math.min(this.canvas.width - 1, Math.floor(p.x)));
    const y = Math.max(0, Math.min(this.canvas.height - 1, Math.floor(p.y)));
    const pixel = this.canvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    this.onStatus?.({ x, y, rgba: pixel });
  }

  hitTest(point) {
    const s = this.state.selection;
    if (!s) return "new";
    const z = this.state.zoom || 1;
    const t = 9 / z;
    const corners = {
      nw: [s.x, s.y],
      ne: [s.x + s.width, s.y],
      sw: [s.x, s.y + s.height],
      se: [s.x + s.width, s.y + s.height]
    };
    for (const [name, [x, y]] of Object.entries(corners)) {
      if (Math.abs(point.x - x) <= t && Math.abs(point.y - y) <= t) return name;
    }
    if (point.x >= s.x && point.x <= s.x + s.width && point.y >= s.y && point.y <= s.y + s.height) return "move";
    return "new";
  }

  pointerDown(event) {
    if (!this.state.document || event.button !== 0) return;
    event.preventDefault();
    this.overlay.setPointerCapture(event.pointerId);
    const p = this.pointFromEvent(event);
    const hit = this.hitTest(p);
    const original = this.state.selection ? { ...this.state.selection } : null;
    this.drag = { hit, start: p, original };
    if (hit === "new") this.state.setSelection({ x: p.x, y: p.y, width: 0, height: 0 });
  }

  pointerMove(event) {
    if (!this.state.document) return;
    this.reportPointer(event);
    if (!this.drag) return;
    const p = this.pointFromEvent(event);
    const { hit, start, original } = this.drag;

    if (hit === "new") {
      this.state.setSelection(normalizeRect(start.x, start.y, p.x, p.y, this.canvas.width, this.canvas.height));
      return;
    }
    if (!original) return;

    if (hit === "move") {
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      const x = clamp(original.x + dx, 0, this.canvas.width - original.width);
      const y = clamp(original.y + dy, 0, this.canvas.height - original.height);
      this.state.setSelection({ ...original, x, y });
      return;
    }

    let x1 = original.x;
    let y1 = original.y;
    let x2 = original.x + original.width;
    let y2 = original.y + original.height;
    if (hit.includes("w")) x1 = p.x;
    if (hit.includes("e")) x2 = p.x;
    if (hit.includes("n")) y1 = p.y;
    if (hit.includes("s")) y2 = p.y;
    this.state.setSelection(normalizeRect(x1, y1, x2, y2, this.canvas.width, this.canvas.height));
  }

  pointerUp(event) {
    if (!this.drag) return;
    try { this.overlay.releasePointerCapture(event.pointerId); } catch {}
    this.drag = null;
    const s = this.state.selection;
    if (s && (s.width < 1 || s.height < 1)) this.state.clearSelection();
  }

  handleKeyboard(event) {
    const s = this.state.selection;
    if (!s) return false;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return false;
    if (!event.ctrlKey && !event.shiftKey) return false;
    event.preventDefault();

    const next = { ...s };
    const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (event.ctrlKey) {
      next.x = clamp(next.x + dx, 0, this.canvas.width - next.width);
      next.y = clamp(next.y + dy, 0, this.canvas.height - next.height);
    } else if (event.shiftKey) {
      next.width = clamp(next.width + dx, 1, this.canvas.width - next.x);
      next.height = clamp(next.height + dy, 1, this.canvas.height - next.y);
    }
    this.state.setSelection(next);
    return true;
  }

  selectAllOrClear() {
    const s = this.state.selection;
    if (s && Math.round(s.x) === 0 && Math.round(s.y) === 0 &&
        Math.round(s.width) === this.canvas.width && Math.round(s.height) === this.canvas.height) {
      this.state.clearSelection();
    } else {
      this.state.setSelection({ x: 0, y: 0, width: this.canvas.width, height: this.canvas.height });
    }
  }

  render() {
    const ctx = this.overlay.getContext("2d");
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const s = this.state.selection;
    if (!s || !this.state.document) return;
    const zoom = this.state.zoom || 1;
    const lineWidth = 1 / zoom;
    const handle = 7 / zoom;

    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    ctx.strokeStyle = "#ffffff";
    ctx.strokeRect(s.x, s.y, s.width, s.height);
    ctx.lineDashOffset = 4 / zoom;
    ctx.strokeStyle = "#111827";
    ctx.strokeRect(s.x, s.y, s.width, s.height);
    ctx.setLineDash([]);

    const corners = [
      [s.x, s.y], [s.x + s.width, s.y], [s.x, s.y + s.height], [s.x + s.width, s.y + s.height]
    ];
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1f2937";
    for (const [x, y] of corners) {
      ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
      ctx.strokeRect(x - handle / 2, y - handle / 2, handle, handle);
    }
    ctx.restore();
  }
}

function normalizeRect(x1, y1, x2, y2, maxW, maxH) {
  const left = clamp(Math.min(x1, x2), 0, maxW);
  const top = clamp(Math.min(y1, y2), 0, maxH);
  const right = clamp(Math.max(x1, x2), 0, maxW);
  const bottom = clamp(Math.max(y1, y2), 0, maxH);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
