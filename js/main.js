import { AppState } from "./state.js";
import { HistoryManager } from "./history.js";
import { CommandRegistry } from "./commands.js";
import { SelectionController } from "./selection.js";
import { createBlankCanvas, decodeFileToCanvas, saveCanvas } from "./io/files.js";
import {
  resizeCanvas, cropCanvas, rotate90, flipCanvas,
  grayscale, sepia, invert,
  brightnessContrastImageData, gaussianBlurImageData, drawText
} from "./engine/operations.js";

const state = new AppState();
const history = new HistoryManager(16);
const commands = new CommandRegistry();

const $ = selector => document.querySelector(selector);
const canvas = $("#imageCanvas");
const previewCanvas = $("#previewCanvas");
const overlayCanvas = $("#overlayCanvas");
const imageCtx = canvas.getContext("2d", { willReadFrequently: true });
const previewCtx = previewCanvas.getContext("2d", { willReadFrequently: true });
const stage = $("#canvasStage");
const scroller = $("#canvasScroller");
const workspace = $("#workspace");
const emptyState = $("#emptyState");
const fileInput = $("#fileInput");

let previewSource = null;
let previewSelection = null;

const selection = new SelectionController({
  canvas,
  overlay: overlayCanvas,
  state,
  onStatus: ({ x, y, rgba }) => {
    $("#statusPosition").textContent = `x: ${x}, y: ${y}`;
    $("#statusColor").textContent = `RGB: ${rgba[0]}, ${rgba[1]}, ${rgba[2]}${rgba[3] < 255 ? ` / A:${rgba[3]}` : ""}`;
  }
});

function setMessage(message) {
  $("#statusMessage").textContent = message;
}

function documentReady() {
  return Boolean(state.document) && !state.busy;
}

function updateDocumentDimensions() {
  if (!state.document) return;
  state.document.width = canvas.width;
  state.document.height = canvas.height;
}

function syncLayers() {
  if (!state.document) return;
  previewCanvas.width = canvas.width;
  previewCanvas.height = canvas.height;
  overlayCanvas.width = canvas.width;
  overlayCanvas.height = canvas.height;
  applyZoom(state.zoom);
  selection.render();
  updateDocumentDimensions();
  refreshUI();
}

function showDocument() {
  emptyState.hidden = true;
  scroller.hidden = false;
  syncLayers();
}

function refreshUI() {
  const doc = state.document;
  $("#statusFile").textContent = doc ? `${doc.fileName}${doc.modified ? " *" : ""}` : "画像未読込";
  $("#statusSize").textContent = doc ? `${canvas.width} × ${canvas.height} px` : "—";
  $("#statusZoom").textContent = `${Math.round(state.zoom * 100)}%`;

  const s = state.selection;
  $("#statusSelection").textContent = s
    ? `選択: ${Math.round(s.x)},${Math.round(s.y)} / ${Math.round(s.width)}×${Math.round(s.height)}`
    : "選択なし";

  commands.refresh();
  selection.render();
}

function applyZoom(zoom) {
  if (!state.document) return;
  state.zoom = zoom;
  const width = Math.max(1, Math.round(canvas.width * zoom));
  const height = Math.max(1, Math.round(canvas.height * zoom));
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  for (const c of [canvas, previewCanvas, overlayCanvas]) {
    c.style.width = "100%";
    c.style.height = "100%";
  }
  const select = $("#zoomSelect");
  const exact = [...select.options].find(o => Number(o.value) === zoom);
  if (exact) select.value = exact.value;
  $("#statusZoom").textContent = `${Math.round(zoom * 100)}%`;
  selection.render();
}

function zoomFit() {
  if (!state.document) return;
  const availableW = Math.max(80, workspace.clientWidth - 64);
  const availableH = Math.max(80, workspace.clientHeight - 64);
  const zoom = Math.min(1, availableW / canvas.width, availableH / canvas.height);
  applyZoom(Math.max(.02, zoom));
  $("#zoomSelect").value = "fit";
}

function zoomStep(direction) {
  if (!state.document) return;
  const stops = [.1, .125, .25, .5, .75, 1, 1.25, 1.5, 2, 3, 4, 5, 8, 10];
  const current = state.zoom;
  if (direction > 0) {
    applyZoom(stops.find(v => v > current + .001) || stops.at(-1));
  } else {
    applyZoom([...stops].reverse().find(v => v < current - .001) || stops[0]);
  }
}

function hidePreview() {
  previewCanvas.hidden = true;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewSource = null;
  previewSelection = null;
}

function beginPreview() {
  previewCanvas.width = canvas.width;
  previewCanvas.height = canvas.height;
  previewSource = imageCtx.getImageData(0, 0, canvas.width, canvas.height);
  previewSelection = state.selection ? { ...state.selection } : null;
  previewCtx.putImageData(previewSource, 0, 0);
  previewCanvas.hidden = false;
}

async function commitPreview(label) {
  if (!previewSource || previewCanvas.hidden) return;
  await history.snapshot(canvas, label);
  imageCtx.clearRect(0, 0, canvas.width, canvas.height);
  imageCtx.drawImage(previewCanvas, 0, 0);
  hidePreview();
  state.markModified(true);
  setMessage(`${label}を適用しました`);
}

async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setMessage("画像ファイルを選択してください");
    return;
  }
  try {
    state.setBusy(true);
    setMessage("画像を読み込んでいます…");
    hidePreview();
    const meta = await decodeFileToCanvas(file, canvas);
    history.clear();
    state.setDocument(meta);
    showDocument();
    applyZoom(1);
    if (canvas.width > workspace.clientWidth || canvas.height > workspace.clientHeight) zoomFit();
    setMessage(`${file.name} を開きました`);
  } catch (error) {
    console.error(error);
    setMessage("画像を読み込めませんでした");
    alert(`画像を読み込めませんでした。\n${error.message || error}`);
  } finally {
    state.setBusy(false);
    refreshUI();
  }
}

async function mutate(label, operation, { clearSelection = false } = {}) {
  if (!documentReady()) return;
  try {
    state.setBusy(true);
    setMessage(`${label}を処理しています…`);
    await history.snapshot(canvas, label);
    await operation();
    if (clearSelection) state.clearSelection();
    state.markModified(true);
    syncLayers();
    setMessage(`${label}を適用しました`);
  } catch (error) {
    console.error(error);
    setMessage(`${label}に失敗しました`);
    alert(`${label}に失敗しました。\n${error.message || error}`);
  } finally {
    state.setBusy(false);
    refreshUI();
  }
}

function setupCommands() {
  commands
    .register("file.new", {
      run: () => $("#newDialog").showModal(),
      enabled: () => !state.busy
    })
    .register("file.open", {
      run: () => fileInput.click(),
      enabled: () => !state.busy
    })
    .register("file.save", {
      run: () => $("#saveDialog").showModal(),
      enabled: documentReady
    })
    .register("edit.undo", {
      enabled: () => documentReady() && history.canUndo,
      run: async () => {
        state.setBusy(true);
        hidePreview();
        await history.undo(canvas);
        state.clearSelection();
        state.markModified(true);
        syncLayers();
        state.setBusy(false);
        setMessage("元に戻しました");
      }
    })
    .register("edit.redo", {
      enabled: () => documentReady() && history.canRedo,
      run: async () => {
        state.setBusy(true);
        hidePreview();
        await history.redo(canvas);
        state.clearSelection();
        state.markModified(true);
        syncLayers();
        state.setBusy(false);
        setMessage("やり直しました");
      }
    })
    .register("edit.selectAll", {
      enabled: documentReady,
      run: () => selection.selectAllOrClear()
    })
    .register("edit.clearSelection", {
      enabled: () => documentReady() && Boolean(state.selection),
      run: () => state.clearSelection()
    })
    .register("view.fit", { enabled: documentReady, run: zoomFit })
    .register("view.actual", { enabled: documentReady, run: () => applyZoom(1) })
    .register("view.zoomIn", { enabled: documentReady, run: () => zoomStep(1) })
    .register("view.zoomOut", { enabled: documentReady, run: () => zoomStep(-1) })
    .register("image.crop", {
      enabled: () => documentReady() && Boolean(state.selection?.width && state.selection?.height),
      run: () => mutate("切り抜き", () => cropCanvas(canvas, state.selection), { clearSelection: true })
    })
    .register("image.resize", {
      enabled: documentReady,
      run: openResizeDialog
    })
    .register("image.rotateLeft", {
      enabled: documentReady,
      run: () => mutate("左へ90度回転", () => rotate90(canvas, "left"), { clearSelection: true })
    })
    .register("image.rotateRight", {
      enabled: documentReady,
      run: () => mutate("右へ90度回転", () => rotate90(canvas, "right"), { clearSelection: true })
    })
    .register("image.flipH", {
      enabled: documentReady,
      run: () => mutate("ミラー", () => flipCanvas(canvas, "horizontal"))
    })
    .register("image.flipV", {
      enabled: documentReady,
      run: () => mutate("フリップ", () => flipCanvas(canvas, "vertical"))
    })
    .register("color.grayscale", {
      enabled: documentReady,
      run: () => mutate("グレースケール変換", () => grayscale(canvas, state.selection))
    })
    .register("color.sepia", {
      enabled: documentReady,
      run: () => mutate("セピア色変換", () => sepia(canvas, state.selection))
    })
    .register("color.invert", {
      enabled: documentReady,
      run: () => mutate("ネガポジ反転", () => invert(canvas, state.selection))
    })
    .register("color.brightnessContrast", {
      enabled: documentReady,
      run: openAdjustDialog
    })
    .register("filter.gaussianBlur", {
      enabled: documentReady,
      run: openBlurDialog
    })
    .register("edit.text", {
      enabled: documentReady,
      run: openTextDialog
    })
    .register("help.about", {
      run: () => $("#aboutDialog").showModal()
    });
}

function setupMenus() {
  const menus = [...document.querySelectorAll(".menu")];

  document.querySelectorAll(".menu-trigger").forEach(trigger => {
    trigger.addEventListener("click", event => {
      event.stopPropagation();
      const menu = trigger.closest(".menu");
      const open = menu.classList.contains("open");
      menus.forEach(m => m.classList.remove("open"));
      if (!open) menu.classList.add("open");
    });
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".menu-popup")) menus.forEach(m => m.classList.remove("open"));
    if (event.target.closest("[data-command]")) menus.forEach(m => m.classList.remove("open"));
  });
}

function openResizeDialog() {
  $("#resizeCurrent").textContent = `${canvas.width} × ${canvas.height}`;
  $("#resizeWidth").value = canvas.width;
  $("#resizeHeight").value = canvas.height;
  $("#resizePercentX").value = 100;
  $("#resizePercentY").value = 100;
  $("#resizeDialog").showModal();
}

function resizeMode() {
  return document.querySelector('input[name="resizeMode"]:checked').value;
}

function setupResizeDialog() {
  const width = $("#resizeWidth");
  const height = $("#resizeHeight");
  const px = $("#resizePercentX");
  const py = $("#resizePercentY");
  const keep = $("#resizeKeepAspect");
  let lock = false;

  function updateFromSize(source) {
    if (lock) return;
    lock = true;
    if (keep.checked) {
      if (source === width) height.value = Math.max(1, Math.round(Number(width.value) * canvas.height / canvas.width));
      else width.value = Math.max(1, Math.round(Number(height.value) * canvas.width / canvas.height));
    }
    px.value = Math.max(1, Math.round(Number(width.value) / canvas.width * 100));
    py.value = Math.max(1, Math.round(Number(height.value) / canvas.height * 100));
    lock = false;
  }

  function updateFromPercent(source) {
    if (lock) return;
    lock = true;
    if (keep.checked) {
      if (source === px) py.value = px.value;
      else px.value = py.value;
    }
    width.value = Math.max(1, Math.round(canvas.width * Number(px.value) / 100));
    height.value = Math.max(1, Math.round(canvas.height * Number(py.value) / 100));
    lock = false;
  }

  width.addEventListener("input", () => updateFromSize(width));
  height.addEventListener("input", () => updateFromSize(height));
  px.addEventListener("input", () => updateFromPercent(px));
  py.addEventListener("input", () => updateFromPercent(py));

  $("#resizeOk").addEventListener("click", async event => {
    event.preventDefault();
    let targetW, targetH;
    if (resizeMode() === "size") {
      targetW = Math.max(1, Math.round(Number(width.value)));
      targetH = Math.max(1, Math.round(Number(height.value)));
    } else {
      targetW = Math.max(1, Math.round(canvas.width * Number(px.value) / 100));
      targetH = Math.max(1, Math.round(canvas.height * Number(py.value) / 100));
    }
    if (targetW > 30000 || targetH > 30000 || targetW * targetH > 180_000_000) {
      alert("指定された画像サイズが大きすぎます。");
      return;
    }

    const method = $("#resizeMethod").value;
    const resample = $("#resizeResample").checked;
    $("#resizeDialog").close();
    await mutate("リサイズ", () => resizeCanvas(canvas, targetW, targetH, method, resample), { clearSelection: true });
  });
}

function openAdjustDialog() {
  $("#brightnessRange").value = $("#brightnessNumber").value = 0;
  $("#contrastRange").value = $("#contrastNumber").value = 0;
  beginPreview();
  $("#adjustDialog").showModal();
}

function renderAdjustmentPreview() {
  if (!previewSource) return;
  const result = brightnessContrastImageData(
    previewSource,
    Number($("#brightnessNumber").value),
    Number($("#contrastNumber").value),
    previewSelection
  );
  previewCtx.putImageData(result, 0, 0);
}

function bindRangeAndNumber(rangeSelector, numberSelector, onInput) {
  const range = $(rangeSelector);
  const number = $(numberSelector);
  range.addEventListener("input", () => {
    number.value = range.value;
    onInput();
  });
  number.addEventListener("input", () => {
    const min = Number(number.min);
    const max = Number(number.max);
    const value = Math.max(min, Math.min(max, Number(number.value)));
    range.value = value;
    onInput();
  });
}

function setupAdjustDialog() {
  bindRangeAndNumber("#brightnessRange", "#brightnessNumber", renderAdjustmentPreview);
  bindRangeAndNumber("#contrastRange", "#contrastNumber", renderAdjustmentPreview);
  $("#adjustOk").addEventListener("click", async event => {
    event.preventDefault();
    await commitPreview("明るさ／コントラスト");
    $("#adjustDialog").close();
    refreshUI();
  });
  $("#adjustDialog").addEventListener("close", hidePreview);
  $("#adjustDialog").addEventListener("cancel", hidePreview);
}

function openBlurDialog() {
  $("#blurRange").value = $("#blurNumber").value = 3;
  beginPreview();
  renderBlurPreview();
  $("#blurDialog").showModal();
}

let blurTimer = null;
function renderBlurPreview() {
  clearTimeout(blurTimer);
  blurTimer = setTimeout(() => {
    if (!previewSource) return;
    setMessage("ぼかしをプレビューしています…");
    const result = gaussianBlurImageData(previewSource, Number($("#blurNumber").value), previewSelection);
    previewCtx.putImageData(result, 0, 0);
    setMessage("プレビュー");
  }, 60);
}

function setupBlurDialog() {
  bindRangeAndNumber("#blurRange", "#blurNumber", renderBlurPreview);
  $("#blurOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(blurTimer);
    if (previewSource) {
      const result = gaussianBlurImageData(previewSource, Number($("#blurNumber").value), previewSelection);
      previewCtx.putImageData(result, 0, 0);
    }
    await commitPreview("ガウスぼかし");
    $("#blurDialog").close();
    refreshUI();
  });
  $("#blurDialog").addEventListener("close", () => {
    clearTimeout(blurTimer);
    hidePreview();
  });
  $("#blurDialog").addEventListener("cancel", hidePreview);
}

function currentTextOptions() {
  return {
    text: $("#textValue").value,
    x: Number($("#textX").value),
    y: Number($("#textY").value),
    fontFamily: $("#textFont").value,
    fontSize: Math.max(6, Number($("#textSize").value)),
    bold: $("#textBold").checked,
    italic: $("#textItalic").checked,
    underline: $("#textUnderline").checked,
    color: $("#textColor").value,
    opacity: Number($("#textOpacity").value) / 100
  };
}

function renderTextPreview() {
  if (!previewSource) return;
  previewCtx.putImageData(previewSource, 0, 0);
  drawText(previewCanvas, currentTextOptions());
}

function openTextDialog() {
  const s = state.selection;
  $("#textX").value = Math.round(s?.x ?? 20);
  $("#textY").value = Math.round(s?.y ?? 20);
  $("#textValue").value = "";
  beginPreview();
  $("#textDialog").showModal();
  $("#textValue").focus();
}

function setupTextDialog() {
  ["#textValue", "#textFont", "#textSize", "#textBold", "#textItalic", "#textUnderline", "#textColor", "#textOpacity", "#textX", "#textY"]
    .forEach(selector => $(selector).addEventListener("input", renderTextPreview));

  $("#textOk").addEventListener("click", async event => {
    event.preventDefault();
    if (!$("#textValue").value) {
      $("#textDialog").close();
      return;
    }
    await history.snapshot(canvas, "文字入れ");
    drawText(canvas, currentTextOptions());
    hidePreview();
    state.markModified(true);
    $("#textDialog").close();
    setMessage("文字を追加しました");
    refreshUI();
  });
  $("#textDialog").addEventListener("close", hidePreview);
  $("#textDialog").addEventListener("cancel", hidePreview);
}

function setupNewDialog() {
  $("#newOk").addEventListener("click", event => {
    event.preventDefault();
    const width = Math.max(1, Math.min(20000, Math.round(Number($("#newWidth").value))));
    const height = Math.max(1, Math.min(20000, Math.round(Number($("#newHeight").value))));
    const color = $("#newColor").value;
    if (width * height > 180_000_000) {
      alert("指定された画像サイズが大きすぎます。");
      return;
    }
    hidePreview();
    const meta = createBlankCanvas(canvas, width, height, color);
    history.clear();
    state.setDocument(meta);
    showDocument();
    applyZoom(1);
    if (width > workspace.clientWidth || height > workspace.clientHeight) zoomFit();
    $("#newDialog").close();
    setMessage("新しい画像を作成しました");
  });
}

function setupSaveDialog() {
  $("#saveQuality").addEventListener("input", event => {
    $("#saveQualityOutput").value = event.target.value;
  });
  $("#saveOk").addEventListener("click", event => {
    event.preventDefault();
    const type = $("#saveType").value;
    const quality = Number($("#saveQuality").value) / 100;
    saveCanvas(canvas, type, quality, state.document?.fileName || "image");
    $("#saveDialog").close();
    setMessage("保存ファイルを作成しました");
  });
}

function setupFileInput() {
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (file) await loadFile(file);
    fileInput.value = "";
  });

  workspace.addEventListener("dragover", event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  workspace.addEventListener("drop", async event => {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find(f => f.type.startsWith("image/"));
    if (file) await loadFile(file);
  });
}

function setupZoom() {
  $("#zoomSelect").addEventListener("change", event => {
    if (event.target.value === "fit") zoomFit();
    else applyZoom(Number(event.target.value));
  });
  window.addEventListener("resize", () => {
    if ($("#zoomSelect").value === "fit" && state.document) zoomFit();
  });
}

function setupKeyboard() {
  document.addEventListener("keydown", event => {
    const active = document.activeElement;
    if (active?.matches("input, textarea, select") || active?.closest("dialog[open]")) return;
    if (selection.handleKeyboard(event)) return;

    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let command = null;

    if (ctrl && event.shiftKey && key === "a") command = "file.save";
    else if (ctrl && key === "n") command = "file.new";
    else if (ctrl && key === "o") command = "file.open";
    else if (ctrl && key === "z") command = "edit.undo";
    else if (ctrl && key === "y") command = "edit.redo";
    else if (ctrl && key === "a") command = "edit.selectAll";
    else if (ctrl && key === "r") command = "image.resize";
    else if (ctrl && key === "t") command = "image.crop";
    else if (ctrl && key === "m") command = "image.flipH";
    else if (ctrl && key === "f") command = "image.flipV";
    else if (ctrl && key === "g") command = "color.grayscale";
    else if (ctrl && (event.key === "+" || event.key === "=")) command = "view.zoomIn";
    else if (ctrl && event.key === "-") command = "view.zoomOut";

    if (command) {
      event.preventDefault();
      commands.execute(command);
    }
  });
}

function setupBeforeUnload() {
  window.addEventListener("beforeunload", event => {
    if (state.document?.modified) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

setupCommands();
commands.bind();
setupMenus();
setupResizeDialog();
setupAdjustDialog();
setupBlurDialog();
setupTextDialog();
setupNewDialog();
setupSaveDialog();
setupFileInput();
setupZoom();
setupKeyboard();
setupBeforeUnload();

state.subscribe(() => refreshUI());
refreshUI();
setMessage("準備完了");
