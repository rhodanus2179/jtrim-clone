import { AppState } from "./state.js";
import { HistoryManager } from "./history.js";
import { CommandRegistry } from "./commands.js";
import { SelectionController } from "./selection.js";
import { createBlankCanvas, decodeFileToCanvas, saveCanvas } from "./io/files.js";
import {
  cropCanvas, rotate90, rotateArbitrary, flipCanvas, addMargin,
  copyRegion, clearRegion, pasteCanvas, compositeCanvas, joinCanvas,
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
let internalClipboard = null;
let joinSourceCanvas = null;
let compositeSourceCanvas = null;
let histogramResult = null;

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

async function fileToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const out = document.createElement("canvas");
  out.width = bitmap.width;
  out.height = bitmap.height;
  out.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return out;
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
    .register("edit.copy", {
      enabled: documentReady,
      run: () => {
        internalClipboard = copyRegion(canvas, state.selection);
        setMessage(state.selection ? "選択範囲をコピーしました" : "画像全体をコピーしました");
        refreshUI();
      }
    })
    .register("edit.cut", {
      enabled: documentReady,
      run: async () => {
        internalClipboard = copyRegion(canvas, state.selection);
        await mutate("切り取り", () => clearRegion(canvas, state.selection, "#ffffff"));
      }
    })
    .register("edit.paste", {
      enabled: () => documentReady() && Boolean(internalClipboard),
      run: async () => {
        const x = Math.round(state.selection?.x ?? 0);
        const y = Math.round(state.selection?.y ?? 0);
        await mutate("貼り付け", () => pasteCanvas(canvas, internalClipboard, x, y, 1));
      }
    })
    .register("edit.erase", {
      enabled: () => documentReady() && Boolean(state.selection),
      run: () => mutate("消去", () => clearRegion(canvas, state.selection, "#ffffff"))
    })
    .register("edit.fill", {
      enabled: documentReady,
      run: openFillDialog
    })
    .register("edit.join", {
      enabled: documentReady,
      run: openJoinDialog
    })
    .register("edit.composite", {
      enabled: documentReady,
      run: openCompositeDialog
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
    .register("color.histogram", {
      enabled: documentReady,
      run: openHistogramDialog
    })
    .register("color.normalize", {
      enabled: documentReady,
      run: () => applyWorkerOperation("ノーマライズ", "normalize", {})
    })
    .register("color.equalize", {
      enabled: documentReady,
      run: () => applyWorkerOperation("イコライズ", "equalize", {})
    })
    .register("filter.soften", {
      enabled: documentReady,
      run: () => applyWorkerOperation("ソフトにする", "soften", {})
    })
    .register("filter.softLens", {
      enabled: documentReady,
      run: openSoftLensDialog
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
    .register("filter.edgeExtract", {
      enabled: documentReady,
      run: openEdgeExtractDialog
    })
    .register("filter.gaussianBlur", {
      enabled: documentReady,
      run: openBlurDialog
    })
    .register("filter.motionBlur", {
      enabled: documentReady,
      run: openMotionBlurDialog
    })
    .register("filter.bevel", {
      enabled: documentReady,
      run: openBevelDialog
    })
    .register("filter.mosaic", {
      enabled: documentReady,
      run: openMosaicDialog
    })
    .register("filter.noise", {
      enabled: documentReady,
      run: openNoiseDialog
    })
    .register("filter.diffuse", {
      enabled: documentReady,
      run: openDiffuseDialog
    })
    .register("filter.glass", {
      enabled: documentReady,
      run: openGlassDialog
    })
    .register("filter.pencil", {
      enabled: documentReady,
      run: () => applyWorkerOperation("鉛筆画", "pencil", {})
    })
    .register("filter.wave", {
      enabled: documentReady,
      run: openWaveDialog
    })
    .register("filter.block", {
      enabled: documentReady,
      run: openBlockDialog
    })
    .register("filter.fade", {
      enabled: documentReady,
      run: openFadeDialog
    })
    .register("filter.oilPaint", {
      enabled: documentReady,
      run: openOilPaintDialog
    })
    .register("filter.swirl", {
      enabled: documentReady,
      run: openSwirlDialog
    })
    .register("filter.punch", {
      enabled: documentReady,
      run: () => openRadialWarpDialog("punch")
    })
    .register("filter.pinch", {
      enabled: documentReady,
      run: () => openRadialWarpDialog("pinch")
    })
    .register("filter.spotlight", {
      enabled: documentReady,
      run: openSpotlightDialog
    })
    .register("filter.blinds", {
      enabled: documentReady,
      run: openBlindsDialog
    })
    .register("filter.supernova", {
      enabled: documentReady,
      run: openSupernovaDialog
    })
    .register("filter.silkScreen", {
      enabled: documentReady,
      run: openSilkScreenDialog
    })
    .register("filter.ripple", {
      enabled: documentReady,
      run: openRippleDialog
    })
    .register("filter.newspaper", {
      enabled: documentReady,
      run: openNewspaperDialog
    })
    .register("filter.custom", {
      enabled: documentReady,
      run: openCustomFilterDialog
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


function openFillDialog() {
  const s = state.selection;
  $("#fillX").value = Math.round(s?.x ?? 0);
  $("#fillY").value = Math.round(s?.y ?? 0);
  $("#fillToleranceRange").value = $("#fillToleranceNumber").value = 20;
  $("#fillOpacityRange").value = $("#fillOpacityNumber").value = 100;
  $("#fillDialog").showModal();
}

function setupFillDialog() {
  bindRangeAndNumber("#fillToleranceRange", "#fillToleranceNumber", () => {});
  bindRangeAndNumber("#fillOpacityRange", "#fillOpacityNumber", () => {});
  $("#fillOk").addEventListener("click", async event => {
    event.preventDefault();
    const params = {
      x: Number($("#fillX").value),
      y: Number($("#fillY").value),
      color: $("#fillColor").value,
      tolerance: Number($("#fillToleranceNumber").value),
      opacity: Number($("#fillOpacityNumber").value) / 100
    };
    $("#fillDialog").close();
    await applyWorkerOperation("塗りつぶし", "floodFill", params);
  });
}

function openJoinDialog() {
  joinSourceCanvas = null;
  $("#joinFileName").textContent = "未選択";
  $("#joinSpacing").value = 0;
  $("#joinOffset").value = 0;
  $("#joinDialog").showModal();
}

function setupJoinDialog() {
  $("#joinChooseFile").addEventListener("click", () => $("#joinFileInput").click());
  $("#joinFileInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      joinSourceCanvas = await fileToCanvas(file);
      $("#joinFileName").textContent = `${file.name} (${joinSourceCanvas.width}×${joinSourceCanvas.height})`;
    } catch (error) {
      alert("画像を読み込めませんでした。");
    } finally {
      event.target.value = "";
    }
  });
  $("#joinOk").addEventListener("click", async event => {
    event.preventDefault();
    if (!joinSourceCanvas) {
      alert("連結する画像を選択してください。");
      return;
    }
    const options = {
      direction: $("#joinDirection").value,
      spacing: Number($("#joinSpacing").value),
      offset: Number($("#joinOffset").value),
      color: $("#joinColor").value
    };
    $("#joinDialog").close();
    await mutate("連結", () => joinCanvas(canvas, joinSourceCanvas, options), { clearSelection: true });
  });
}

function openCompositeDialog() {
  compositeSourceCanvas = internalClipboard;
  $("#compositeSourceName").textContent = internalClipboard
    ? `内部クリップボード (${internalClipboard.width}×${internalClipboard.height})`
    : "未選択";
  $("#compositeX").value = Math.round(state.selection?.x ?? 0);
  $("#compositeY").value = Math.round(state.selection?.y ?? 0);
  $("#compositeOpacityRange").value = $("#compositeOpacityNumber").value = 100;
  $("#compositeDialog").showModal();
}

function setupCompositeDialog() {
  bindRangeAndNumber("#compositeOpacityRange", "#compositeOpacityNumber", () => {});
  $("#compositeUseClipboard").addEventListener("click", () => {
    if (!internalClipboard) {
      alert("内部クリップボードは空です。先にコピーしてください。");
      return;
    }
    compositeSourceCanvas = internalClipboard;
    $("#compositeSourceName").textContent = `内部クリップボード (${internalClipboard.width}×${internalClipboard.height})`;
  });
  $("#compositeChooseFile").addEventListener("click", () => $("#compositeFileInput").click());
  $("#compositeFileInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      compositeSourceCanvas = await fileToCanvas(file);
      $("#compositeSourceName").textContent = `${file.name} (${compositeSourceCanvas.width}×${compositeSourceCanvas.height})`;
    } catch (error) {
      alert("画像を読み込めませんでした。");
    } finally {
      event.target.value = "";
    }
  });
  $("#compositeOk").addEventListener("click", async event => {
    event.preventDefault();
    if (!compositeSourceCanvas) {
      alert("合成する画像を選択してください。");
      return;
    }
    const options = {
      x: Number($("#compositeX").value),
      y: Number($("#compositeY").value),
      opacity: Number($("#compositeOpacityNumber").value) / 100,
      mode: $("#compositeMode").value
    };
    $("#compositeDialog").close();
    await mutate("合成", () => compositeCanvas(canvas, compositeSourceCanvas, options));
  });
}

function drawHistogram() {
  if (!histogramResult) return;
  const channel = $("#histogramChannel").value;
  const values = histogramResult[channel];
  const graph = $("#histogramCanvas");
  const ctx = graph.getContext("2d");
  const w = graph.width, h = graph.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#d5dbe3";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = Math.round(h * i / 4) + .5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  const max = Math.max(1, ...values);
  ctx.fillStyle = channel === "red" ? "#d33" : channel === "green" ? "#27964b" : channel === "blue" ? "#2878d8" : "#555";
  const barW = w / 256;
  for (let i = 0; i < 256; i++) {
    const bh = values[i] / max * (h - 10);
    ctx.fillRect(i * barW, h - bh, Math.max(1, barW), bh);
  }
  $("#histogramStats").textContent = `対象画素数: ${histogramResult.pixels.toLocaleString()} / 最大頻度: ${max.toLocaleString()}`;
}

async function openHistogramDialog() {
  try {
    setMessage("ヒストグラムを計算しています…");
    const source = imageCtx.getImageData(0, 0, canvas.width, canvas.height);
    histogramResult = await imageWorker.run("histogram", source, { selection: state.selection });
    $("#histogramChannel").value = "luma";
    $("#histogramDialog").showModal();
    drawHistogram();
    setMessage("ヒストグラム");
  } catch (error) {
    console.error(error);
    alert("ヒストグラムを計算できませんでした。");
  }
}

function setupHistogramDialog() {
  $("#histogramChannel").addEventListener("change", drawHistogram);
}

function openEdgeExtractDialog() {
  $("#edgeExtractRange").value = $("#edgeExtractNumber").value = 3;
  beginPreview(360_000);
  scheduleWorkerPreview("edgeExtract", { level: 3 }, 90);
  $("#edgeExtractDialog").showModal();
}

function setupEdgeExtractDialog() {
  const render = () => scheduleWorkerPreview("edgeExtract", { level: Number($("#edgeExtractNumber").value) }, 90);
  bindRangeAndNumber("#edgeExtractRange", "#edgeExtractNumber", render);
  $("#edgeExtractOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const level = Number($("#edgeExtractNumber").value);
    $("#edgeExtractDialog").close();
    await applyWorkerOperation("エッジを抽出", "edgeExtract", { level });
  });
  $("#edgeExtractDialog").addEventListener("close", hidePreview);
  $("#edgeExtractDialog").addEventListener("cancel", hidePreview);
}

function openNoiseDialog() {
  $("#noiseRange").value = $("#noiseNumber").value = 15;
  $("#noiseColor").checked = false;
  beginPreview(360_000);
  scheduleWorkerPreview("noise", { amount: 15, color: false }, 100);
  $("#noiseDialog").showModal();
}

function setupNoiseDialog() {
  const render = () => scheduleWorkerPreview("noise", {
    amount: Number($("#noiseNumber").value),
    color: $("#noiseColor").checked
  }, 110);
  bindRangeAndNumber("#noiseRange", "#noiseNumber", render);
  $("#noiseColor").addEventListener("change", render);
  $("#noiseOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = { amount: Number($("#noiseNumber").value), color: $("#noiseColor").checked };
    $("#noiseDialog").close();
    await applyWorkerOperation("ノイズ付加", "noise", params);
  });
  $("#noiseDialog").addEventListener("close", hidePreview);
  $("#noiseDialog").addEventListener("cancel", hidePreview);
}

function openDiffuseDialog() {
  $("#diffuseRange").value = $("#diffuseNumber").value = 4;
  beginPreview(360_000);
  scheduleWorkerPreview("diffuse", { radius: 4 }, 100);
  $("#diffuseDialog").showModal();
}

function setupDiffuseDialog() {
  const render = () => scheduleWorkerPreview("diffuse", { radius: Number($("#diffuseNumber").value) }, 110);
  bindRangeAndNumber("#diffuseRange", "#diffuseNumber", render);
  $("#diffuseOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const radius = Number($("#diffuseNumber").value);
    $("#diffuseDialog").close();
    await applyWorkerOperation("拡散", "diffuse", { radius });
  });
  $("#diffuseDialog").addEventListener("close", hidePreview);
  $("#diffuseDialog").addEventListener("cancel", hidePreview);
}

function openGlassDialog() {
  $("#glassRange").value = $("#glassNumber").value = 6;
  $("#glassDirection").value = "both";
  beginPreview(360_000);
  scheduleWorkerPreview("glass", { size: 6, direction: "both" }, 80);
  $("#glassDialog").showModal();
}

function setupGlassDialog() {
  const render = () => scheduleWorkerPreview("glass", {
    size: Number($("#glassNumber").value),
    direction: $("#glassDirection").value
  }, 80);
  bindRangeAndNumber("#glassRange", "#glassNumber", render);
  $("#glassDirection").addEventListener("change", render);
  $("#glassOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = { size: Number($("#glassNumber").value), direction: $("#glassDirection").value };
    $("#glassDialog").close();
    await applyWorkerOperation("ガラス処理", "glass", params);
  });
  $("#glassDialog").addEventListener("close", hidePreview);
  $("#glassDialog").addEventListener("cancel", hidePreview);
}



function openSoftLensDialog() {
  $("#softLensRange").value = $("#softLensNumber").value = 5;
  beginPreview(260_000);
  scheduleWorkerPreview("softLens", { strength: 5 }, 100);
  $("#softLensDialog").showModal();
}

function setupSoftLensDialog() {
  const render = () => scheduleWorkerPreview("softLens", { strength: Number($("#softLensNumber").value) }, 100);
  bindRangeAndNumber("#softLensRange", "#softLensNumber", render);
  $("#softLensOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const strength = Number($("#softLensNumber").value);
    $("#softLensDialog").close();
    await applyWorkerOperation("ソフトレンズ", "softLens", { strength });
  });
  $("#softLensDialog").addEventListener("close", hidePreview);
  $("#softLensDialog").addEventListener("cancel", hidePreview);
}

function openMotionBlurDialog() {
  $("#motionDistanceRange").value = $("#motionDistanceNumber").value = 8;
  $("#motionAngleRange").value = $("#motionAngleNumber").value = 0;
  beginPreview(220_000);
  scheduleWorkerPreview("motionBlur", { distance: 8 * previewScale, angle: 0 }, 120);
  $("#motionBlurDialog").showModal();
}

function setupMotionBlurDialog() {
  const render = () => scheduleWorkerPreview("motionBlur", {
    distance: Math.max(1, Number($("#motionDistanceNumber").value) * previewScale),
    angle: Number($("#motionAngleNumber").value)
  }, 120);
  bindRangeAndNumber("#motionDistanceRange", "#motionDistanceNumber", render);
  bindRangeAndNumber("#motionAngleRange", "#motionAngleNumber", render);
  $("#motionBlurOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      distance: Number($("#motionDistanceNumber").value),
      angle: Number($("#motionAngleNumber").value)
    };
    $("#motionBlurDialog").close();
    await applyWorkerOperation("ぶれ", "motionBlur", params);
  });
  $("#motionBlurDialog").addEventListener("close", hidePreview);
  $("#motionBlurDialog").addEventListener("cancel", hidePreview);
}

function openBevelDialog() {
  $("#bevelWidthRange").value = $("#bevelWidthNumber").value = 8;
  $("#bevelInset").checked = false;
  beginPreview(360_000);
  scheduleWorkerPreview("bevel", { width: Math.max(1, 8 * previewScale), inset: false }, 60);
  $("#bevelDialog").showModal();
}

function setupBevelDialog() {
  const render = () => scheduleWorkerPreview("bevel", {
    width: Math.max(1, Number($("#bevelWidthNumber").value) * previewScale),
    inset: $("#bevelInset").checked
  }, 60);
  bindRangeAndNumber("#bevelWidthRange", "#bevelWidthNumber", render);
  $("#bevelInset").addEventListener("change", render);
  $("#bevelOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = { width: Number($("#bevelWidthNumber").value), inset: $("#bevelInset").checked };
    $("#bevelDialog").close();
    await applyWorkerOperation("立体枠をつける", "bevel", params);
  });
  $("#bevelDialog").addEventListener("close", hidePreview);
  $("#bevelDialog").addEventListener("cancel", hidePreview);
}

function openSilkScreenDialog() {
  $("#silkCellRange").value = $("#silkCellNumber").value = 5;
  $("#silkAngleRange").value = $("#silkAngleNumber").value = 45;
  beginPreview(360_000);
  scheduleWorkerPreview("silkScreen", { cellSize: Math.max(2, 5 * previewScale), angle: 45 }, 60);
  $("#silkScreenDialog").showModal();
}

function setupSilkScreenDialog() {
  const render = () => scheduleWorkerPreview("silkScreen", {
    cellSize: Math.max(2, Number($("#silkCellNumber").value) * previewScale),
    angle: Number($("#silkAngleNumber").value)
  }, 60);
  bindRangeAndNumber("#silkCellRange", "#silkCellNumber", render);
  bindRangeAndNumber("#silkAngleRange", "#silkAngleNumber", render);
  $("#silkScreenOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = { cellSize: Number($("#silkCellNumber").value), angle: Number($("#silkAngleNumber").value) };
    $("#silkScreenDialog").close();
    await applyWorkerOperation("シルクスクリーン", "silkScreen", params);
  });
  $("#silkScreenDialog").addEventListener("close", hidePreview);
  $("#silkScreenDialog").addEventListener("cancel", hidePreview);
}

function openWaveDialog() {
  $("#waveAmplitudeRange").value = $("#waveAmplitudeNumber").value = 12;
  $("#waveLengthRange").value = $("#waveLengthNumber").value = 48;
  $("#waveDirection").value = "horizontal";
  beginPreview(300_000);
  scheduleWorkerPreview("wave", { amplitude: 12, wavelength: 48, direction: "horizontal" }, 90);
  $("#waveDialog").showModal();
}

function setupWaveDialog() {
  const render = () => scheduleWorkerPreview("wave", {
    amplitude: Number($("#waveAmplitudeNumber").value) * previewScale,
    wavelength: Math.max(2, Number($("#waveLengthNumber").value) * previewScale),
    direction: $("#waveDirection").value
  }, 90);
  bindRangeAndNumber("#waveAmplitudeRange", "#waveAmplitudeNumber", render);
  bindRangeAndNumber("#waveLengthRange", "#waveLengthNumber", render);
  $("#waveDirection").addEventListener("change", render);
  $("#waveOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      amplitude: Number($("#waveAmplitudeNumber").value),
      wavelength: Number($("#waveLengthNumber").value),
      direction: $("#waveDirection").value
    };
    $("#waveDialog").close();
    await applyWorkerOperation("ウェーブ", "wave", params);
  });
  $("#waveDialog").addEventListener("close", hidePreview);
  $("#waveDialog").addEventListener("cancel", hidePreview);
}

function openBlockDialog() {
  $("#blockSizeRange").value = $("#blockSizeNumber").value = 12;
  $("#blockStagger").checked = false;
  $("#blockBorder").checked = false;
  beginPreview(360_000);
  scheduleWorkerPreview("block", { size: 12, stagger: false, border: false }, 70);
  $("#blockDialog").showModal();
}

function setupBlockDialog() {
  const render = () => scheduleWorkerPreview("block", {
    size: Math.max(2, Number($("#blockSizeNumber").value) * previewScale),
    stagger: $("#blockStagger").checked,
    border: $("#blockBorder").checked
  }, 70);
  bindRangeAndNumber("#blockSizeRange", "#blockSizeNumber", render);
  $("#blockStagger").addEventListener("change", render);
  $("#blockBorder").addEventListener("change", render);
  $("#blockOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      size: Number($("#blockSizeNumber").value),
      stagger: $("#blockStagger").checked,
      border: $("#blockBorder").checked
    };
    $("#blockDialog").close();
    await applyWorkerOperation("ブロック", "block", params);
  });
  $("#blockDialog").addEventListener("close", hidePreview);
  $("#blockDialog").addEventListener("cancel", hidePreview);
}

function openFadeDialog() {
  $("#fadeStrengthRange").value = $("#fadeStrengthNumber").value = 100;
  $("#fadeShape").value = "ellipse";
  beginPreview(360_000);
  scheduleWorkerPreview("fade", { strength: 100, shape: "ellipse", color: $("#fadeColor").value }, 60);
  $("#fadeDialog").showModal();
}

function setupFadeDialog() {
  const render = () => scheduleWorkerPreview("fade", {
    strength: Number($("#fadeStrengthNumber").value),
    shape: $("#fadeShape").value,
    color: $("#fadeColor").value
  }, 60);
  bindRangeAndNumber("#fadeStrengthRange", "#fadeStrengthNumber", render);
  $("#fadeShape").addEventListener("change", render);
  $("#fadeColor").addEventListener("input", render);
  $("#fadeOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      strength: Number($("#fadeStrengthNumber").value),
      shape: $("#fadeShape").value,
      color: $("#fadeColor").value
    };
    $("#fadeDialog").close();
    await applyWorkerOperation("フェードアウト", "fade", params);
  });
  $("#fadeDialog").addEventListener("close", hidePreview);
  $("#fadeDialog").addEventListener("cancel", hidePreview);
}

function openOilPaintDialog() {
  $("#oilRadiusRange").value = $("#oilRadiusNumber").value = 3;
  $("#oilLevelsRange").value = $("#oilLevelsNumber").value = 24;
  beginPreview(160_000);
  scheduleWorkerPreview("oilPaint", { radius: 3, levels: 24 }, 150);
  $("#oilPaintDialog").showModal();
}

function setupOilPaintDialog() {
  const render = () => scheduleWorkerPreview("oilPaint", {
    radius: Number($("#oilRadiusNumber").value),
    levels: Number($("#oilLevelsNumber").value)
  }, 180);
  bindRangeAndNumber("#oilRadiusRange", "#oilRadiusNumber", render);
  bindRangeAndNumber("#oilLevelsRange", "#oilLevelsNumber", render);
  $("#oilPaintOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      radius: Number($("#oilRadiusNumber").value),
      levels: Number($("#oilLevelsNumber").value)
    };
    $("#oilPaintDialog").close();
    await applyWorkerOperation("オイルペイント", "oilPaint", params);
  });
  $("#oilPaintDialog").addEventListener("close", hidePreview);
  $("#oilPaintDialog").addEventListener("cancel", hidePreview);
}

function openSwirlDialog() {
  $("#swirlRange").value = $("#swirlNumber").value = 180;
  beginPreview(300_000);
  scheduleWorkerPreview("swirl", { degrees: 180 }, 90);
  $("#swirlDialog").showModal();
}

function setupSwirlDialog() {
  const render = () => scheduleWorkerPreview("swirl", { degrees: Number($("#swirlNumber").value) }, 90);
  bindRangeAndNumber("#swirlRange", "#swirlNumber", render);
  $("#swirlOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const degrees = Number($("#swirlNumber").value);
    $("#swirlDialog").close();
    await applyWorkerOperation("渦巻き", "swirl", { degrees });
  });
  $("#swirlDialog").addEventListener("close", hidePreview);
  $("#swirlDialog").addEventListener("cancel", hidePreview);
}

function openRadialWarpDialog(mode) {
  $("#radialWarpDialog").dataset.mode = mode;
  $("#radialWarpTitle").textContent = mode === "pinch" ? "つまむ" : "パンチ";
  $("#radialWarpRange").value = $("#radialWarpNumber").value = 50;
  beginPreview(300_000);
  scheduleWorkerPreview("radialWarp", { strength: mode === "pinch" ? -50 : 50 }, 90);
  $("#radialWarpDialog").showModal();
}

function setupRadialWarpDialog() {
  const render = () => {
    const mode = $("#radialWarpDialog").dataset.mode || "punch";
    const value = Number($("#radialWarpNumber").value);
    scheduleWorkerPreview("radialWarp", { strength: mode === "pinch" ? -value : value }, 90);
  };
  bindRangeAndNumber("#radialWarpRange", "#radialWarpNumber", render);
  $("#radialWarpOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const mode = $("#radialWarpDialog").dataset.mode || "punch";
    const value = Number($("#radialWarpNumber").value);
    $("#radialWarpDialog").close();
    await applyWorkerOperation(mode === "pinch" ? "つまむ" : "パンチ", "radialWarp", {
      strength: mode === "pinch" ? -value : value
    });
  });
  $("#radialWarpDialog").addEventListener("close", hidePreview);
  $("#radialWarpDialog").addEventListener("cancel", hidePreview);
}

function activeRegionCenter() {
  const b = state.selection || { x: 0, y: 0, width: canvas.width, height: canvas.height };
  return {
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
    radius: Math.max(10, Math.min(b.width, b.height) / 3)
  };
}

function openSpotlightDialog() {
  const c = activeRegionCenter();
  $("#spotX").value = Math.round(c.x);
  $("#spotY").value = Math.round(c.y);
  $("#spotRadiusRange").value = $("#spotRadiusNumber").value = Math.round(c.radius);
  $("#spotStrengthRange").value = $("#spotStrengthNumber").value = 60;
  beginPreview(300_000);
  scheduleWorkerPreview("spotlight", {
    centerX: c.x * previewScale, centerY: c.y * previewScale,
    radius: c.radius * previewScale, strength: 60
  }, 70);
  $("#spotlightDialog").showModal();
}

function setupSpotlightDialog() {
  const render = () => scheduleWorkerPreview("spotlight", {
    centerX: Number($("#spotX").value) * previewScale,
    centerY: Number($("#spotY").value) * previewScale,
    radius: Number($("#spotRadiusNumber").value) * previewScale,
    strength: Number($("#spotStrengthNumber").value)
  }, 70);
  bindRangeAndNumber("#spotRadiusRange", "#spotRadiusNumber", render);
  bindRangeAndNumber("#spotStrengthRange", "#spotStrengthNumber", render);
  $("#spotX").addEventListener("input", render);
  $("#spotY").addEventListener("input", render);
  $("#spotlightOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      centerX: Number($("#spotX").value),
      centerY: Number($("#spotY").value),
      radius: Number($("#spotRadiusNumber").value),
      strength: Number($("#spotStrengthNumber").value)
    };
    $("#spotlightDialog").close();
    await applyWorkerOperation("スポットライト", "spotlight", params);
  });
  $("#spotlightDialog").addEventListener("close", hidePreview);
  $("#spotlightDialog").addEventListener("cancel", hidePreview);
}

function openBlindsDialog() {
  $("#blindsWidthRange").value = $("#blindsWidthNumber").value = 10;
  $("#blindsOpacityRange").value = $("#blindsOpacityNumber").value = 30;
  $("#blindsDirection").value = "horizontal";
  beginPreview(360_000);
  scheduleWorkerPreview("blinds", {
    width: 10, color: $("#blindsColor").value, opacity: 30, direction: "horizontal"
  }, 60);
  $("#blindsDialog").showModal();
}

function setupBlindsDialog() {
  const render = () => scheduleWorkerPreview("blinds", {
    width: Math.max(2, Number($("#blindsWidthNumber").value) * previewScale),
    color: $("#blindsColor").value,
    opacity: Number($("#blindsOpacityNumber").value),
    direction: $("#blindsDirection").value
  }, 60);
  bindRangeAndNumber("#blindsWidthRange", "#blindsWidthNumber", render);
  bindRangeAndNumber("#blindsOpacityRange", "#blindsOpacityNumber", render);
  $("#blindsColor").addEventListener("input", render);
  $("#blindsDirection").addEventListener("change", render);
  $("#blindsOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      width: Number($("#blindsWidthNumber").value),
      color: $("#blindsColor").value,
      opacity: Number($("#blindsOpacityNumber").value),
      direction: $("#blindsDirection").value
    };
    $("#blindsDialog").close();
    await applyWorkerOperation("ブラインド", "blinds", params);
  });
  $("#blindsDialog").addEventListener("close", hidePreview);
  $("#blindsDialog").addEventListener("cancel", hidePreview);
}

function openSupernovaDialog() {
  const c = activeRegionCenter();
  $("#supernovaX").value = Math.round(c.x);
  $("#supernovaY").value = Math.round(c.y);
  $("#supernovaRadiusRange").value = $("#supernovaRadiusNumber").value = Math.round(c.radius);
  $("#supernovaRaysRange").value = $("#supernovaRaysNumber").value = 24;
  $("#supernovaRandomHue").checked = false;
  beginPreview(300_000);
  scheduleWorkerPreview("supernova", {
    centerX: c.x * previewScale, centerY: c.y * previewScale,
    radius: c.radius * previewScale, rays: 24,
    color: $("#supernovaColor").value, randomHue: false
  }, 80);
  $("#supernovaDialog").showModal();
}

function setupSupernovaDialog() {
  const render = () => scheduleWorkerPreview("supernova", {
    centerX: Number($("#supernovaX").value) * previewScale,
    centerY: Number($("#supernovaY").value) * previewScale,
    radius: Number($("#supernovaRadiusNumber").value) * previewScale,
    rays: Number($("#supernovaRaysNumber").value),
    color: $("#supernovaColor").value,
    randomHue: $("#supernovaRandomHue").checked
  }, 80);
  bindRangeAndNumber("#supernovaRadiusRange", "#supernovaRadiusNumber", render);
  bindRangeAndNumber("#supernovaRaysRange", "#supernovaRaysNumber", render);
  ["#supernovaX","#supernovaY","#supernovaColor"].forEach(id => $(id).addEventListener("input", render));
  $("#supernovaRandomHue").addEventListener("change", render);
  $("#supernovaOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      centerX: Number($("#supernovaX").value),
      centerY: Number($("#supernovaY").value),
      radius: Number($("#supernovaRadiusNumber").value),
      rays: Number($("#supernovaRaysNumber").value),
      color: $("#supernovaColor").value,
      randomHue: $("#supernovaRandomHue").checked
    };
    $("#supernovaDialog").close();
    await applyWorkerOperation("超新星", "supernova", params);
  });
  $("#supernovaDialog").addEventListener("close", hidePreview);
  $("#supernovaDialog").addEventListener("cancel", hidePreview);
}

function openRippleDialog() {
  $("#rippleAmplitudeRange").value = $("#rippleAmplitudeNumber").value = 8;
  $("#rippleLengthRange").value = $("#rippleLengthNumber").value = 28;
  beginPreview(300_000);
  scheduleWorkerPreview("ripple", { amplitude: 8, wavelength: 28 }, 90);
  $("#rippleDialog").showModal();
}

function setupRippleDialog() {
  const render = () => scheduleWorkerPreview("ripple", {
    amplitude: Number($("#rippleAmplitudeNumber").value) * previewScale,
    wavelength: Math.max(2, Number($("#rippleLengthNumber").value) * previewScale)
  }, 90);
  bindRangeAndNumber("#rippleAmplitudeRange", "#rippleAmplitudeNumber", render);
  bindRangeAndNumber("#rippleLengthRange", "#rippleLengthNumber", render);
  $("#rippleOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      amplitude: Number($("#rippleAmplitudeNumber").value),
      wavelength: Number($("#rippleLengthNumber").value)
    };
    $("#rippleDialog").close();
    await applyWorkerOperation("波紋", "ripple", params);
  });
  $("#rippleDialog").addEventListener("close", hidePreview);
  $("#rippleDialog").addEventListener("cancel", hidePreview);
}

function openNewspaperDialog() {
  $("#newspaperRange").value = $("#newspaperNumber").value = 4;
  beginPreview(360_000);
  scheduleWorkerPreview("newspaper", { cellSize: Math.max(1, 4 * previewScale) }, 50);
  $("#newspaperDialog").showModal();
}

function setupNewspaperDialog() {
  const render = () => scheduleWorkerPreview("newspaper", {
    cellSize: Math.max(1, Number($("#newspaperNumber").value) * previewScale)
  }, 50);
  bindRangeAndNumber("#newspaperRange", "#newspaperNumber", render);
  $("#newspaperOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const cellSize = Number($("#newspaperNumber").value);
    $("#newspaperDialog").close();
    await applyWorkerOperation("新聞写真風", "newspaper", { cellSize });
  });
  $("#newspaperDialog").addEventListener("close", hidePreview);
  $("#newspaperDialog").addEventListener("cancel", hidePreview);
}

function setCustomKernel(values, divisor = 1, offset = 0) {
  [...document.querySelectorAll("#customKernel .kernel")].forEach((input, index) => {
    input.value = values[index] ?? 0;
  });
  $("#customDivisor").value = divisor;
  $("#customOffset").value = offset;
}

function currentCustomFilterParams() {
  return {
    kernel: [...document.querySelectorAll("#customKernel .kernel")].map(input => Number(input.value) || 0),
    divisor: Number($("#customDivisor").value) || 1,
    offset: Number($("#customOffset").value) || 0
  };
}

function openCustomFilterDialog() {
  setCustomKernel([0,-1,0,-1,5,-1,0,-1,0], 1, 0);
  beginPreview(280_000);
  scheduleWorkerPreview("customFilter", currentCustomFilterParams(), 80);
  $("#customFilterDialog").showModal();
}

function setupCustomFilterDialog() {
  const render = () => scheduleWorkerPreview("customFilter", currentCustomFilterParams(), 90);
  [...document.querySelectorAll("#customKernel .kernel")].forEach(input => input.addEventListener("input", render));
  $("#customDivisor").addEventListener("input", render);
  $("#customOffset").addEventListener("input", render);
  $("#customPresetSharpen").addEventListener("click", () => { setCustomKernel([0,-1,0,-1,5,-1,0,-1,0],1,0); render(); });
  $("#customPresetEdge").addEventListener("click", () => { setCustomKernel([0,-1,0,-1,4,-1,0,-1,0],1,128); render(); });
  $("#customPresetEmboss").addEventListener("click", () => { setCustomKernel([-2,-1,0,-1,1,1,0,1,2],1,128); render(); });
  $("#customFilterOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = currentCustomFilterParams();
    $("#customFilterDialog").close();
    await applyWorkerOperation("カスタムフィルタ", "customFilter", params);
  });
  $("#customFilterDialog").addEventListener("close", hidePreview);
  $("#customFilterDialog").addEventListener("cancel", hidePreview);
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
    else if (ctrl && key === "c") command = "edit.copy";
    else if (ctrl && key === "v") command = "edit.paste";
    else if (ctrl && key === "x") command = "edit.cut";
    else if (!ctrl && event.key === "Delete") command = "edit.erase";
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
setupFillDialog();
setupJoinDialog();
setupCompositeDialog();
setupHistogramDialog();
setupEdgeExtractDialog();
setupNoiseDialog();
setupDiffuseDialog();
setupGlassDialog();
setupSoftLensDialog();
setupMotionBlurDialog();
setupBevelDialog();
setupSilkScreenDialog();
setupWaveDialog();
setupBlockDialog();
setupFadeDialog();
setupOilPaintDialog();
setupSwirlDialog();
setupRadialWarpDialog();
setupSpotlightDialog();
setupBlindsDialog();
setupSupernovaDialog();
setupRippleDialog();
setupNewspaperDialog();
setupCustomFilterDialog();
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
