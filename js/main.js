import { AppState } from "./state.js";
import { HistoryManager } from "./history.js";
import { CommandRegistry } from "./commands.js";
import { SelectionController } from "./selection.js";
import { createBlankCanvas, decodeFileToCanvas, saveCanvas } from "./io/files.js";
import {
  cropCanvas, rotate90, rotateArbitrary, flipCanvas, addMargin,
  grayscale, sepia, invert, drawText
} from "./engine/operations.js";
import { ImageWorkerClient } from "./worker/client.js";

const state = new AppState();
const history = new HistoryManager(16);
const commands = new CommandRegistry();
const imageWorker = new ImageWorkerClient();

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
let previewScale = 1;
let previewGeneration = 0;

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
  previewGeneration++;
  previewCanvas.hidden = true;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewSource = null;
  previewSelection = null;
  previewScale = 1;
}

function beginPreview(maxPixels = 650_000) {
  const pixels = canvas.width * canvas.height;
  previewScale = Number.isFinite(maxPixels) && pixels > maxPixels
    ? Math.sqrt(maxPixels / pixels)
    : 1;

  const width = Math.max(1, Math.round(canvas.width * previewScale));
  const height = Math.max(1, Math.round(canvas.height * previewScale));
  previewCanvas.width = width;
  previewCanvas.height = height;
  previewCtx.clearRect(0, 0, width, height);
  previewCtx.imageSmoothingEnabled = true;
  previewCtx.imageSmoothingQuality = "medium";
  previewCtx.drawImage(canvas, 0, 0, width, height);
  previewSource = previewCtx.getImageData(0, 0, width, height);
  previewSelection = state.selection ? {
    x: state.selection.x * previewScale,
    y: state.selection.y * previewScale,
    width: state.selection.width * previewScale,
    height: state.selection.height * previewScale
  } : null;
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
    .register("image.rotateArbitrary", {
      enabled: documentReady,
      run: () => $("#rotateDialog").showModal()
    })
    .register("image.flipH", {
      enabled: documentReady,
      run: () => mutate("ミラー", () => flipCanvas(canvas, "horizontal"))
    })
    .register("image.flipV", {
      enabled: documentReady,
      run: () => mutate("フリップ", () => flipCanvas(canvas, "vertical"))
    })
    .register("image.margin", {
      enabled: documentReady,
      run: () => $("#marginDialog").showModal()
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
    .register("color.rgb", {
      enabled: documentReady,
      run: openRgbDialog
    })
    .register("color.gamma", {
      enabled: documentReady,
      run: openGammaDialog
    })
    .register("color.hsv", {
      enabled: documentReady,
      run: openHsvDialog
    })
    .register("color.posterize", {
      enabled: documentReady,
      run: openPosterizeDialog
    })
    .register("color.solarize", {
      enabled: documentReady,
      run: openSolarizeDialog
    })
    .register("color.threshold", {
      enabled: documentReady,
      run: openThresholdDialog
    })
    .register("filter.sharpen", {
      enabled: documentReady,
      run: openSharpenDialog
    })
    .register("filter.emboss", {
      enabled: documentReady,
      run: openEmbossDialog
    })
    .register("filter.edgeEnhance", {
      enabled: documentReady,
      run: openEdgeEnhanceDialog
    })
    .register("filter.gaussianBlur", {
      enabled: documentReady,
      run: openBlurDialog
    })
    .register("filter.mosaic", {
      enabled: documentReady,
      run: openMosaicDialog
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
    await mutate("リサイズ", async () => {
      const source = imageCtx.getImageData(0, 0, canvas.width, canvas.height);
      const result = await imageWorker.run("resize", source, {
        width: targetW,
        height: targetH,
        method,
        resample
      });
      canvas.width = result.width;
      canvas.height = result.height;
      imageCtx.putImageData(result, 0, 0);
    }, { clearSelection: true });
  });
}

function openAdjustDialog() {
  $("#brightnessRange").value = $("#brightnessNumber").value = 0;
  $("#contrastRange").value = $("#contrastNumber").value = 0;
  beginPreview();
  $("#adjustDialog").showModal();
}

let adjustmentTimer = null;
function renderAdjustmentPreview() {
  clearTimeout(adjustmentTimer);
  const generation = ++previewGeneration;
  adjustmentTimer = setTimeout(async () => {
    if (!previewSource || generation !== previewGeneration) return;
    try {
      const result = await imageWorker.run("brightnessContrast", previewSource, {
        brightness: Number($("#brightnessNumber").value),
        contrast: Number($("#contrastNumber").value),
        selection: previewSelection
      });
      if (generation !== previewGeneration) return;
      previewCtx.putImageData(result, 0, 0);
    } catch (error) {
      console.error(error);
    }
  }, 45);
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
    clearTimeout(adjustmentTimer);
    const brightness = Number($("#brightnessNumber").value);
    const contrast = Number($("#contrastNumber").value);
    hidePreview();
    $("#adjustDialog").close();
    await mutate("明るさ／コントラスト", async () => {
      const source = imageCtx.getImageData(0, 0, canvas.width, canvas.height);
      const result = await imageWorker.run("brightnessContrast", source, {
        brightness,
        contrast,
        selection: state.selection
      });
      imageCtx.putImageData(result, 0, 0);
    });
  });
  $("#adjustDialog").addEventListener("close", hidePreview);
  $("#adjustDialog").addEventListener("cancel", hidePreview);
}

function openBlurDialog() {
  $("#blurRange").value = $("#blurNumber").value = 3;
  beginPreview(360_000);
  renderBlurPreview();
  $("#blurDialog").showModal();
}

let blurTimer = null;
function renderBlurPreview() {
  clearTimeout(blurTimer);
  const generation = ++previewGeneration;
  blurTimer = setTimeout(async () => {
    if (!previewSource || generation !== previewGeneration) return;
    setMessage("ぼかしをプレビューしています…");
    try {
      const result = await imageWorker.run("gaussianBlur", previewSource, {
        level: Number($("#blurNumber").value),
        selection: previewSelection
      });
      if (generation !== previewGeneration) return;
      previewCtx.putImageData(result, 0, 0);
      setMessage("プレビュー");
    } catch (error) {
      console.error(error);
    }
  }, 120);
}

function setupBlurDialog() {
  bindRangeAndNumber("#blurRange", "#blurNumber", renderBlurPreview);
  $("#blurOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(blurTimer);
    const level = Number($("#blurNumber").value);
    hidePreview();
    $("#blurDialog").close();
    await mutate("ガウスぼかし", async () => {
      const source = imageCtx.getImageData(0, 0, canvas.width, canvas.height);
      const result = await imageWorker.run("gaussianBlur", source, {
        level,
        selection: state.selection
      });
      imageCtx.putImageData(result, 0, 0);
    });
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
  if (previewCanvas.hidden) return;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.drawImage(canvas, 0, 0);
  drawText(previewCanvas, currentTextOptions());
}

function openTextDialog() {
  const s = state.selection;
  $("#textX").value = Math.round(s?.x ?? 20);
  $("#textY").value = Math.round(s?.y ?? 20);
  $("#textValue").value = "";
  previewCanvas.width = canvas.width;
  previewCanvas.height = canvas.height;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.drawImage(canvas, 0, 0);
  previewCanvas.hidden = false;
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


let genericPreviewTimer = null;

function scheduleWorkerPreview(operation, params, delay = 70) {
  clearTimeout(genericPreviewTimer);
  const generation = ++previewGeneration;
  genericPreviewTimer = setTimeout(async () => {
    if (!previewSource || generation !== previewGeneration) return;
    try {
      const result = await imageWorker.run(operation, previewSource, {
        ...params,
        selection: previewSelection
      });
      if (generation !== previewGeneration) return;
      previewCtx.putImageData(result, 0, 0);
      setMessage("プレビュー");
    } catch (error) {
      console.error(error);
    }
  }, delay);
}

async function applyWorkerOperation(label, operation, params, { clearSelection = false } = {}) {
  hidePreview();
  await mutate(label, async () => {
    const source = imageCtx.getImageData(0, 0, canvas.width, canvas.height);
    const result = await imageWorker.run(operation, source, {
      ...params,
      selection: state.selection
    });
    imageCtx.putImageData(result, 0, 0);
  }, { clearSelection });
}

function setupRotateDialog() {
  bindRangeAndNumber("#rotateRange", "#rotateNumber", () => {});
  $("#rotateOk").addEventListener("click", async event => {
    event.preventDefault();
    const degrees = Number($("#rotateNumber").value);
    const background = $("#rotateBackground").value;
    const expand = $("#rotateExpand").checked;
    $("#rotateDialog").close();
    await mutate("任意角度回転", () => rotateArbitrary(canvas, degrees, background, expand), { clearSelection: true });
  });
}

function setupMarginDialog() {
  $("#marginSame").addEventListener("click", () => {
    const value = Math.max(0, Number($("#marginTop").value) || 0);
    $("#marginRight").value = $("#marginBottom").value = $("#marginLeft").value = value;
  });
  $("#marginOk").addEventListener("click", async event => {
    event.preventDefault();
    const options = {
      top: Number($("#marginTop").value),
      right: Number($("#marginRight").value),
      bottom: Number($("#marginBottom").value),
      left: Number($("#marginLeft").value),
      color: $("#marginColor").value
    };
    $("#marginDialog").close();
    await mutate("余白作成", () => addMargin(canvas, options), { clearSelection: true });
  });
}

function openGammaDialog() {
  $("#gammaRange").value = 100;
  $("#gammaNumber").value = "1.00";
  beginPreview();
  $("#gammaDialog").showModal();
}

function setupGammaDialog() {
  const range = $("#gammaRange");
  const number = $("#gammaNumber");
  const render = () => scheduleWorkerPreview("gamma", { gamma: Number(number.value) }, 55);
  range.addEventListener("input", () => {
    number.value = (Number(range.value) / 100).toFixed(2);
    render();
  });
  number.addEventListener("input", () => {
    const value = Math.max(.2, Math.min(5, Number(number.value) || 1));
    range.value = Math.round(value * 100);
    render();
  });
  $("#gammaOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const gamma = Number(number.value);
    $("#gammaDialog").close();
    await applyWorkerOperation("ガンマ補正", "gamma", { gamma });
  });
  $("#gammaDialog").addEventListener("close", hidePreview);
  $("#gammaDialog").addEventListener("cancel", hidePreview);
}

function openRgbDialog() {
  for (const channel of ["R", "G", "B"]) {
    $("#rgb" + channel + "Range").value = 0;
    $("#rgb" + channel + "Number").value = 0;
  }
  beginPreview();
  $("#rgbDialog").showModal();
}

function setupRgbDialog() {
  const render = () => scheduleWorkerPreview("rgbAdjust", {
    red: Number($("#rgbRNumber").value),
    green: Number($("#rgbGNumber").value),
    blue: Number($("#rgbBNumber").value)
  });
  bindRangeAndNumber("#rgbRRange", "#rgbRNumber", render);
  bindRangeAndNumber("#rgbGRange", "#rgbGNumber", render);
  bindRangeAndNumber("#rgbBRange", "#rgbBNumber", render);
  $("#rgbOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      red: Number($("#rgbRNumber").value),
      green: Number($("#rgbGNumber").value),
      blue: Number($("#rgbBNumber").value)
    };
    $("#rgbDialog").close();
    await applyWorkerOperation("RGBの度合い", "rgbAdjust", params);
  });
  $("#rgbDialog").addEventListener("close", hidePreview);
  $("#rgbDialog").addEventListener("cancel", hidePreview);
}

function openHsvDialog() {
  for (const channel of ["H", "S", "V"]) {
    $("#hsv" + channel + "Range").value = 0;
    $("#hsv" + channel + "Number").value = 0;
  }
  beginPreview();
  $("#hsvDialog").showModal();
}

function setupHsvDialog() {
  const render = () => scheduleWorkerPreview("hsvAdjust", {
    hue: Number($("#hsvHNumber").value),
    saturation: Number($("#hsvSNumber").value),
    value: Number($("#hsvVNumber").value)
  }, 80);
  bindRangeAndNumber("#hsvHRange", "#hsvHNumber", render);
  bindRangeAndNumber("#hsvSRange", "#hsvSNumber", render);
  bindRangeAndNumber("#hsvVRange", "#hsvVNumber", render);
  $("#hsvOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      hue: Number($("#hsvHNumber").value),
      saturation: Number($("#hsvSNumber").value),
      value: Number($("#hsvVNumber").value)
    };
    $("#hsvDialog").close();
    await applyWorkerOperation("HSVカラー調整", "hsvAdjust", params);
  });
  $("#hsvDialog").addEventListener("close", hidePreview);
  $("#hsvDialog").addEventListener("cancel", hidePreview);
}

function openSharpenDialog() {
  $("#sharpenRange").value = $("#sharpenNumber").value = 3;
  beginPreview(420_000);
  scheduleWorkerPreview("sharpen", { level: 3 }, 90);
  $("#sharpenDialog").showModal();
}

function setupSharpenDialog() {
  const render = () => scheduleWorkerPreview("sharpen", { level: Number($("#sharpenNumber").value) }, 90);
  bindRangeAndNumber("#sharpenRange", "#sharpenNumber", render);
  $("#sharpenOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const level = Number($("#sharpenNumber").value);
    $("#sharpenDialog").close();
    await applyWorkerOperation("シャープにする", "sharpen", { level });
  });
  $("#sharpenDialog").addEventListener("close", hidePreview);
  $("#sharpenDialog").addEventListener("cancel", hidePreview);
}

function openMosaicDialog() {
  $("#mosaicRange").value = $("#mosaicNumber").value = 10;
  beginPreview(500_000);
  scheduleWorkerPreview("mosaic", { blockSize: 10 }, 50);
  $("#mosaicDialog").showModal();
}

function setupMosaicDialog() {
  const render = () => scheduleWorkerPreview("mosaic", { blockSize: Number($("#mosaicNumber").value) }, 50);
  bindRangeAndNumber("#mosaicRange", "#mosaicNumber", render);
  $("#mosaicOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const blockSize = Number($("#mosaicNumber").value);
    $("#mosaicDialog").close();
    await applyWorkerOperation("モザイク", "mosaic", { blockSize });
  });
  $("#mosaicDialog").addEventListener("close", hidePreview);
  $("#mosaicDialog").addEventListener("cancel", hidePreview);
}


function openPosterizeDialog() {
  $("#posterizeRange").value = $("#posterizeNumber").value = 8;
  beginPreview(500_000);
  scheduleWorkerPreview("posterize", { levels: 8 }, 55);
  $("#posterizeDialog").showModal();
}

function setupPosterizeDialog() {
  const render = () => scheduleWorkerPreview("posterize", { levels: Number($("#posterizeNumber").value) }, 55);
  bindRangeAndNumber("#posterizeRange", "#posterizeNumber", render);
  $("#posterizeOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const levels = Number($("#posterizeNumber").value);
    $("#posterizeDialog").close();
    await applyWorkerOperation("ポスタライズ", "posterize", { levels });
  });
  $("#posterizeDialog").addEventListener("close", hidePreview);
  $("#posterizeDialog").addEventListener("cancel", hidePreview);
}

function openSolarizeDialog() {
  $("#solarizeRange").value = $("#solarizeNumber").value = 128;
  beginPreview(500_000);
  scheduleWorkerPreview("solarize", { threshold: 128 }, 55);
  $("#solarizeDialog").showModal();
}

function setupSolarizeDialog() {
  const render = () => scheduleWorkerPreview("solarize", { threshold: Number($("#solarizeNumber").value) }, 55);
  bindRangeAndNumber("#solarizeRange", "#solarizeNumber", render);
  $("#solarizeOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const threshold = Number($("#solarizeNumber").value);
    $("#solarizeDialog").close();
    await applyWorkerOperation("ソラリゼーション", "solarize", { threshold });
  });
  $("#solarizeDialog").addEventListener("close", hidePreview);
  $("#solarizeDialog").addEventListener("cancel", hidePreview);
}

function openThresholdDialog() {
  $("#thresholdRange").value = $("#thresholdNumber").value = 128;
  beginPreview(500_000);
  scheduleWorkerPreview("threshold", { threshold: 128 }, 55);
  $("#thresholdDialog").showModal();
}

function setupThresholdDialog() {
  const render = () => scheduleWorkerPreview("threshold", { threshold: Number($("#thresholdNumber").value) }, 55);
  bindRangeAndNumber("#thresholdRange", "#thresholdNumber", render);
  $("#thresholdOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const threshold = Number($("#thresholdNumber").value);
    $("#thresholdDialog").close();
    await applyWorkerOperation("2階調化", "threshold", { threshold });
  });
  $("#thresholdDialog").addEventListener("close", hidePreview);
  $("#thresholdDialog").addEventListener("cancel", hidePreview);
}

function openEmbossDialog() {
  $("#embossRange").value = $("#embossNumber").value = 3;
  $("#embossColor").checked = false;
  beginPreview(360_000);
  scheduleWorkerPreview("emboss", { level: 3, color: false }, 90);
  $("#embossDialog").showModal();
}

function setupEmbossDialog() {
  const render = () => scheduleWorkerPreview("emboss", {
    level: Number($("#embossNumber").value),
    color: $("#embossColor").checked
  }, 90);
  bindRangeAndNumber("#embossRange", "#embossNumber", render);
  $("#embossColor").addEventListener("change", render);
  $("#embossOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = { level: Number($("#embossNumber").value), color: $("#embossColor").checked };
    $("#embossDialog").close();
    await applyWorkerOperation("エンボス", "emboss", params);
  });
  $("#embossDialog").addEventListener("close", hidePreview);
  $("#embossDialog").addEventListener("cancel", hidePreview);
}

function openEdgeEnhanceDialog() {
  $("#edgeEnhanceRange").value = $("#edgeEnhanceNumber").value = 3;
  beginPreview(360_000);
  scheduleWorkerPreview("edgeEnhance", { level: 3 }, 90);
  $("#edgeEnhanceDialog").showModal();
}

function setupEdgeEnhanceDialog() {
  const render = () => scheduleWorkerPreview("edgeEnhance", { level: Number($("#edgeEnhanceNumber").value) }, 90);
  bindRangeAndNumber("#edgeEnhanceRange", "#edgeEnhanceNumber", render);
  $("#edgeEnhanceOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const level = Number($("#edgeEnhanceNumber").value);
    $("#edgeEnhanceDialog").close();
    await applyWorkerOperation("エッジの強調", "edgeEnhance", { level });
  });
  $("#edgeEnhanceDialog").addEventListener("close", hidePreview);
  $("#edgeEnhanceDialog").addEventListener("cancel", hidePreview);
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
setupRotateDialog();
setupMarginDialog();
setupGammaDialog();
setupRgbDialog();
setupHsvDialog();
setupSharpenDialog();
setupMosaicDialog();
setupPosterizeDialog();
setupSolarizeDialog();
setupThresholdDialog();
setupEmbossDialog();
setupEdgeEnhanceDialog();
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
