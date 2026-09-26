import { AppState } from "./state.js";
import { HistoryManager } from "./history.js";
import { CommandRegistry } from "./commands.js";
import { SelectionController } from "./selection.js";
import {
  createBlankCanvas, decodeFileToCanvas, saveCanvas, encodeCanvas,
  encodeJpegToTargetSize, downloadBlob
} from "./io/files.js";
import {
  cropCanvas, coordinateCrop, circularCrop, roundedCrop,
  rotate90, rotateArbitrary, flipCanvas, shiftCanvas, addMargin, addShadow, applyTexture,
  copyRegion, clearRegion, pasteCanvas, compositeCanvas, joinCanvas,
  grayscale, sepia, invert, drawText
} from "./engine/operations.js";
import { ImageWorkerClient } from "./worker/client.js";
import { createZip } from "./io/zip.js";
import {
  getFileSystemCapabilities,
  pickWorkspaceDirectory,
  pickOutputDirectory,
  pickSaveFileHandle,
  queryHandlePermission,
  ensureHandlePermission,
  writeBlobToFileHandle,
  createFileInDirectory,
  getOrCreateDirectory,
  getFileFromHandle,
  getDroppedFileSystemHandles,
  walkDirectory,
  getOrCreateDirectoryPath,
  createFileSnapshot,
  fileSnapshotChanged,
  isSameHandle,
  isLikelyImageName
} from "./io/file-system-access.js";
import { WorkspaceController } from "./workspace/workspace-controller.js";
import { readPreference, writePreference } from "./preferences.js";
import {
  DEFAULT_PRINT_SETTINGS,
  normalizePrintSettings,
  pageSizeMm,
  resolvedOrientation,
  printCss
} from "./io/print.js";
import { parseJpegInfo } from "./io/jpeg-info.js";
import {
  recentHandleStoreAvailable,
  listRecentDirectories,
  saveRecentDirectory,
  removeRecentDirectory,
  clearRecentDirectories
} from "./io/handle-store.js";

const state = new AppState();
const history = new HistoryManager(16);
const commands = new CommandRegistry();
const imageWorker = new ImageWorkerClient();
const folderWorkspace = new WorkspaceController();
const fsCapabilities = getFileSystemCapabilities();

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
let showTransparency = false;
let textureSourceCanvas = null;
let batchItems = [];
let batchSourceMode = "legacy";
let galleryItems = [];
let galleryPendingAction = null;
let slideshowIndex = 0;
let slideshowTimer = null;
let selectedGalleryIndex = -1;
let selectedGalleryIndices = new Set();
let lastSelectedGalleryIndex = -1;
let thumbnailObserver = null;
let slideshowGeneration = 0;
let slideshowOrder = [];
let slideshowCursor = 0;
let galleryLoadMoreObserver = null;
let renderedGalleryCount = 0;
let printPreviewUrl = null;
let printOutputUrl = null;
let reopenPrintPreviewAfterSettings = false;

const DEFAULT_SAVE_OPTIONS = Object.freeze({
  jpegMode: "quality",
  jpegQuality: 92,
  targetKb: 500,
  preserveExif: true,
  confirmExif: false,
  webpQuality: 92
});

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


function canvasToPngBlob(sourceCanvas) {
  return new Promise((resolve, reject) => {
    sourceCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNGを作成できませんでした")), "image/png");
  });
}

async function writeSystemClipboard(sourceCanvas) {
  if (!sourceCanvas || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  try {
    const blob = await canvasToPngBlob(sourceCanvas);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch (error) {
    console.debug("System clipboard write unavailable:", error);
    return false;
  }
}

async function readSystemClipboardImage() {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(value => value.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      return await fileToCanvas(blob);
    }
  } catch (error) {
    console.debug("System clipboard read unavailable:", error);
  }
  return null;
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

async function loadFile(file, sourceContext = null) {
  if (!file || !file.type.startsWith("image/")) {
    setMessage("画像ファイルを選択してください");
    return;
  }
  try {
    state.setBusy(true);
    setMessage("画像を読み込んでいます…");
    hidePreview();
    const meta = await decodeFileToCanvas(file, canvas);
    if (sourceContext?.fileHandle) {
      meta.fileHandle = sourceContext.fileHandle;
      meta.parentDirectoryHandle = sourceContext.parentDirectoryHandle || null;
      meta.workspaceRelativePath = sourceContext.workspaceRelativePath || file.name;
      meta.sourceSnapshot = await createFileSnapshot(file);
    } else {
      meta.fileHandle = null;
      meta.parentDirectoryHandle = null;
      meta.workspaceRelativePath = null;
      meta.sourceSnapshot = null;
    }
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
    .register("file.reload", {
      run: reloadCurrentDocument,
      enabled: () => documentReady() && Boolean(state.document?.fileHandle || state.document?.sourceFile)
    })
    .register("file.openFolder", {
      run: openWorkspaceFolder,
      enabled: () => !state.busy && fsCapabilities.directoryPicker
    })
    .register("file.recentFolders", {
      run: openRecentFoldersDialog,
      enabled: () => !state.busy && fsCapabilities.directoryPicker && recentHandleStoreAvailable()
    })
    .register("file.overwrite", {
      run: overwriteCurrentDocument,
      enabled: documentReady
    })
    .register("file.save", {
      run: openSaveDialog,
      enabled: documentReady
    })
    .register("file.saveOptions", {
      run: openSaveOptionsDialog,
      enabled: () => !state.busy
    })
    .register("file.printSetup", {
      run: openPrintSettingsDialog,
      enabled: documentReady
    })
    .register("file.print", {
      run: printCurrentDocument,
      enabled: documentReady
    })
    .register("file.printPreview", {
      run: openPrintPreview,
      enabled: documentReady
    })
    .register("file.thumbnails", {
      run: () => requestGallery("thumbnails"),
      enabled: () => !state.busy
    })
    .register("file.batch", {
      run: openBatchDialog,
      enabled: () => !state.busy
    })
    .register("file.slideshow", {
      run: () => requestGallery("slideshow"),
      enabled: () => !state.busy
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
      run: async () => {
        internalClipboard = copyRegion(canvas, state.selection);
        const system = await writeSystemClipboard(internalClipboard);
        setMessage(
          (state.selection ? "選択範囲" : "画像全体") +
          (system ? "をシステムクリップボードへコピーしました" : "を内部クリップボードへコピーしました")
        );
        refreshUI();
      }
    })
    .register("edit.cut", {
      enabled: documentReady,
      run: async () => {
        internalClipboard = copyRegion(canvas, state.selection);
        await writeSystemClipboard(internalClipboard);
        await mutate("切り取り", () => clearRegion(canvas, state.selection, "#ffffff"));
      }
    })
    .register("edit.paste", {
      enabled: documentReady,
      run: async () => {
        const systemClipboard = await readSystemClipboardImage();
        const source = systemClipboard || internalClipboard;
        if (!source) {
          setMessage("貼り付け可能な画像がクリップボードにありません");
          return;
        }
        internalClipboard = source;
        const x = Math.round(state.selection?.x ?? 0);
        const y = Math.round(state.selection?.y ?? 0);
        await mutate("貼り付け", () => pasteCanvas(canvas, source, x, y, 1));
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
    .register("edit.clearHistory", {
      enabled: () => !state.busy && (history.canUndo || history.canRedo),
      run: () => {
        history.clear();
        setMessage("アンドゥ／リドゥ履歴をクリアしました");
        refreshUI();
      }
    })
    .register("edit.clearClipboard", {
      enabled: () => !state.busy,
      run: clearApplicationClipboard
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
    .register("image.circleCrop", {
      enabled: documentReady,
      run: () => openShapeCropDialog("ellipse")
    })
    .register("image.roundedCrop", {
      enabled: documentReady,
      run: () => openShapeCropDialog("rounded")
    })
    .register("image.coordinateCrop", {
      enabled: documentReady,
      run: openCoordinateCropDialog
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
    .register("image.shift", {
      enabled: documentReady,
      run: () => $("#shiftDialog").showModal()
    })
    .register("image.margin", {
      enabled: documentReady,
      run: () => $("#marginDialog").showModal()
    })
    .register("image.shadow", {
      enabled: documentReady,
      run: () => $("#shadowDialog").showModal()
    })
    .register("image.texture", {
      enabled: documentReady,
      run: openTextureDialog
    })
    .register("image.capture", {
      enabled: () => !state.busy && Boolean(navigator.mediaDevices?.getDisplayMedia),
      run: () => $("#captureDialog").showModal()
    })
    .register("image.denoise", {
      enabled: documentReady,
      run: openDenoiseDialog
    })
    .register("image.densityMin", {
      enabled: documentReady,
      run: () => applyWorkerOperation("最小濃度抽出", "densityExtract", { mode: "min" })
    })
    .register("image.densityMedian", {
      enabled: documentReady,
      run: () => applyWorkerOperation("中間濃度抽出", "densityExtract", { mode: "median" })
    })
    .register("image.densityMax", {
      enabled: documentReady,
      run: () => applyWorkerOperation("最大濃度抽出", "densityExtract", { mode: "max" })
    })
    .register("image.jpegInfo", {
      enabled: documentReady,
      run: openJpegInfoDialog
    })
    .register("image.transparentColor", {
      enabled: documentReady,
      run: openTransparentColorDialog
    })
    .register("image.toggleTransparency", {
      enabled: documentReady,
      run: () => {
        showTransparency = !showTransparency;
        stage.classList.toggle("show-transparency", showTransparency);
        setMessage(showTransparency ? "透過状態を表示します" : "透過状態表示を解除しました");
      }
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
    .register("color.colorScale", {
      enabled: documentReady,
      run: openColorScaleDialog
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
    .register("color.rgbExchange", {
      enabled: documentReady,
      run: () => applyWorkerOperation("RGB交換", "rgbExchange", {})
    })
    .register("color.xor", {
      enabled: documentReady,
      run: () => applyWorkerOperation("XORカラー変換", "xorColor", {})
    })
    .register("color.gradient", {
      enabled: documentReady,
      run: openGradientDialog
    })
    .register("color.shadowHighlight", {
      enabled: documentReady,
      run: openShadowHighlightDialog
    })
    .register("color.redEye", {
      enabled: documentReady,
      run: openRedEyeDialog
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
    .register("color.usedCount", {
      enabled: documentReady,
      run: showUsedColorCount
    })
    .register("color.depth", {
      enabled: documentReady,
      run: () => $("#colorDepthDialog").showModal()
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




function openShapeCropDialog(mode) {
  $("#shapeCropDialog").dataset.mode = mode;
  $("#shapeCropTitle").textContent = mode === "ellipse" ? "円形切り抜き" : "角丸切り抜き";
  $("#shapeRadiusRow").hidden = mode === "ellipse";
  $("#shapeRadiusRange").value = $("#shapeRadiusNumber").value = 24;
  $("#shapeBorder").checked = false;
  $("#shapeShadow").checked = false;
  $("#shapeCropDialog").showModal();
}

function setupShapeCropDialog() {
  bindRangeAndNumber("#shapeRadiusRange", "#shapeRadiusNumber", () => {});
  $("#shapeCropOk").addEventListener("click", async event => {
    event.preventDefault();
    const mode = $("#shapeCropDialog").dataset.mode || "ellipse";
    const options = {
      background: $("#shapeBackground").value,
      radius: Number($("#shapeRadiusNumber").value),
      border: $("#shapeBorder").checked,
      borderWidth: Number($("#shapeBorderWidth").value),
      borderColor: $("#shapeBorderColor").value,
      shadow: $("#shapeShadow").checked,
      shadowOffsetX: Number($("#shapeShadowX").value),
      shadowOffsetY: Number($("#shapeShadowY").value),
      shadowBlur: Number($("#shapeShadowBlur").value),
      shadowOpacity: Number($("#shapeShadowOpacity").value),
      shadowColor: $("#shapeShadowColor").value
    };
    $("#shapeCropDialog").close();
    await mutate(mode === "ellipse" ? "円形切り抜き" : "角丸切り抜き", () => {
      if (mode === "ellipse") circularCrop(canvas, state.selection, options);
      else roundedCrop(canvas, state.selection, options);
    }, { clearSelection: true });
  });
}

function openCoordinateCropDialog() {
  const r = state.selection || { x: 0, y: 0, width: canvas.width, height: canvas.height };
  $("#coordX").value = Math.round(r.x);
  $("#coordY").value = Math.round(r.y);
  $("#coordWidth").value = Math.round(r.width);
  $("#coordHeight").value = Math.round(r.height);
  $("#coordinateCropDialog").showModal();
}

function setupCoordinateCropDialog() {
  $("#coordinateCropOk").addEventListener("click", async event => {
    event.preventDefault();
    const params = {
      x: Number($("#coordX").value),
      y: Number($("#coordY").value),
      width: Number($("#coordWidth").value),
      height: Number($("#coordHeight").value)
    };
    $("#coordinateCropDialog").close();
    await mutate("座標指定切り抜き", () => coordinateCrop(canvas, params.x, params.y, params.width, params.height), { clearSelection: true });
  });
}

function setupShiftDialog() {
  $("#shiftOk").addEventListener("click", async event => {
    event.preventDefault();
    const dx = Number($("#shiftX").value);
    const dy = Number($("#shiftY").value);
    $("#shiftDialog").close();
    await mutate("シフト", () => shiftCanvas(canvas, dx, dy), { clearSelection: true });
  });
}

function setupShadowDialog() {
  bindRangeAndNumber("#shadowOpacityRange", "#shadowOpacityNumber", () => {});
  $("#shadowOk").addEventListener("click", async event => {
    event.preventDefault();
    const options = {
      offsetX: Number($("#shadowX").value),
      offsetY: Number($("#shadowY").value),
      blur: Number($("#shadowBlur").value),
      opacity: Number($("#shadowOpacityNumber").value),
      color: $("#shadowColor").value
    };
    $("#shadowDialog").close();
    await mutate("影をつける", () => addShadow(canvas, state.selection, options));
  });
}

function openTransparentColorDialog() {
  $("#transparentToleranceRange").value = $("#transparentToleranceNumber").value = 0;
  $("#transparentColorDialog").showModal();
}

function setupTransparentColorDialog() {
  bindRangeAndNumber("#transparentToleranceRange", "#transparentToleranceNumber", () => {});
  $("#transparentColorOk").addEventListener("click", async event => {
    event.preventDefault();
    const params = {
      color: $("#transparentColor").value,
      tolerance: Number($("#transparentToleranceNumber").value)
    };
    $("#transparentColorDialog").close();
    await applyWorkerOperation("透過色設定", "transparentColor", params);
    showTransparency = true;
    stage.classList.add("show-transparency");
  });
}



function openTextureDialog() {
  textureSourceCanvas = null;
  $("#textureFileName").textContent = "未選択";
  $("#textureOpacityRange").value = $("#textureOpacityNumber").value = 100;
  $("#textureScaleRange").value = $("#textureScaleNumber").value = 100;
  $("#textureOffsetX").value = $("#textureOffsetY").value = 0;
  $("#textureDialog").showModal();
}

function setupTextureDialog() {
  bindRangeAndNumber("#textureOpacityRange", "#textureOpacityNumber", () => {});
  bindRangeAndNumber("#textureScaleRange", "#textureScaleNumber", () => {});
  $("#textureChooseFile").addEventListener("click", () => $("#textureFileInput").click());
  $("#textureFileInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      textureSourceCanvas = await fileToCanvas(file);
      $("#textureFileName").textContent = `${file.name} (${textureSourceCanvas.width}×${textureSourceCanvas.height})`;
    } catch (error) {
      console.error(error);
      alert("テクスチャ画像を読み込めませんでした。");
    } finally {
      event.target.value = "";
    }
  });
  $("#textureOk").addEventListener("click", async event => {
    event.preventDefault();
    if (!textureSourceCanvas) {
      alert("テクスチャ画像を選択してください。");
      return;
    }
    const options = {
      opacity: Number($("#textureOpacityNumber").value),
      scale: Number($("#textureScaleNumber").value),
      offsetX: Number($("#textureOffsetX").value),
      offsetY: Number($("#textureOffsetY").value)
    };
    $("#textureDialog").close();
    await mutate("テクスチャ", () => applyTexture(canvas, textureSourceCanvas, state.selection, options));
  });
}

async function captureDisplay(delaySeconds = 0) {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    if (delaySeconds > 0) {
      setMessage(`${delaySeconds}秒後にキャプチャします…`);
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error("共有画面のサイズを取得できませんでした");

    canvas.width = width;
    canvas.height = height;
    imageCtx.drawImage(video, 0, 0, width, height);
    history.clear();
    state.setDocument({
      fileName: "画面キャプチャ.png",
      sourceFormat: "image/png",
      width,
      height,
      modified: true
    });
    showDocument();
    applyZoom(1);
    if (width > workspace.clientWidth || height > workspace.clientHeight) zoomFit();
    syncLayers();
    setMessage("画面をキャプチャしました");
  } finally {
    stream?.getTracks().forEach(track => track.stop());
  }
}

function setupCaptureDialog() {
  $("#captureOk").addEventListener("click", async event => {
    event.preventDefault();
    if (state.document?.modified && !confirm("現在の画像を画面キャプチャで置き換えます。保存していない変更は失われます。続けますか？")) {
      return;
    }
    const delay = Number($("#captureDelay").value) || 0;
    $("#captureDialog").close();
    try {
      state.setBusy(true);
      setMessage("共有する画面を選択してください…");
      await captureDisplay(delay);
    } catch (error) {
      console.error(error);
      if (error?.name !== "NotAllowedError") alert(`画面キャプチャに失敗しました。\n${error.message || error}`);
      setMessage(error?.name === "NotAllowedError" ? "画面キャプチャをキャンセルしました" : "画面キャプチャに失敗しました");
    } finally {
      state.setBusy(false);
      refreshUI();
    }
  });
}

function openDenoiseDialog() {
  $("#denoiseRange").value = $("#denoiseNumber").value = 1;
  beginPreview(180_000);
  scheduleWorkerPreview("denoise", { level: 1 }, 160);
  $("#denoiseDialog").showModal();
}

function setupDenoiseDialog() {
  const render = () => scheduleWorkerPreview("denoise", { level: Number($("#denoiseNumber").value) }, 180);
  bindRangeAndNumber("#denoiseRange", "#denoiseNumber", render);
  $("#denoiseOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const level = Number($("#denoiseNumber").value);
    $("#denoiseDialog").close();
    await applyWorkerOperation("ノイズ除去", "denoise", { level });
  });
  $("#denoiseDialog").addEventListener("close", hidePreview);
  $("#denoiseDialog").addEventListener("cancel", hidePreview);
}

function openRedEyeDialog() {
  $("#redEyeRange").value = $("#redEyeNumber").value = 80;
  beginPreview(400_000);
  scheduleWorkerPreview("redEye", { strength: 80 }, 70);
  $("#redEyeDialog").showModal();
}

function setupRedEyeDialog() {
  const render = () => scheduleWorkerPreview("redEye", { strength: Number($("#redEyeNumber").value) }, 70);
  bindRangeAndNumber("#redEyeRange", "#redEyeNumber", render);
  $("#redEyeOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const strength = Number($("#redEyeNumber").value);
    $("#redEyeDialog").close();
    await applyWorkerOperation("赤目補正", "redEye", { strength });
  });
  $("#redEyeDialog").addEventListener("close", hidePreview);
  $("#redEyeDialog").addEventListener("cancel", hidePreview);
}

function openColorScaleDialog() {
  beginPreview(500_000);
  scheduleWorkerPreview("colorScale", { color: $("#colorScaleColor").value }, 50);
  $("#colorScaleDialog").showModal();
}

function setupColorScaleDialog() {
  $("#colorScaleColor").addEventListener("input", () => scheduleWorkerPreview("colorScale", { color: $("#colorScaleColor").value }, 50));
  $("#colorScaleOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const color = $("#colorScaleColor").value;
    $("#colorScaleDialog").close();
    await applyWorkerOperation("単色カラースケール", "colorScale", { color });
  });
  $("#colorScaleDialog").addEventListener("close", hidePreview);
  $("#colorScaleDialog").addEventListener("cancel", hidePreview);
}

function openGradientDialog() {
  $("#gradientOpacityRange").value = $("#gradientOpacityNumber").value = 50;
  beginPreview(500_000);
  scheduleWorkerPreview("gradient", {
    startColor: $("#gradientStart").value,
    endColor: $("#gradientEnd").value,
    direction: $("#gradientDirection").value,
    opacity: 50
  }, 50);
  $("#gradientDialog").showModal();
}

function setupGradientDialog() {
  const render = () => scheduleWorkerPreview("gradient", {
    startColor: $("#gradientStart").value,
    endColor: $("#gradientEnd").value,
    direction: $("#gradientDirection").value,
    opacity: Number($("#gradientOpacityNumber").value)
  }, 50);
  bindRangeAndNumber("#gradientOpacityRange", "#gradientOpacityNumber", render);
  $("#gradientStart").addEventListener("input", render);
  $("#gradientEnd").addEventListener("input", render);
  $("#gradientDirection").addEventListener("change", render);
  $("#gradientOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      startColor: $("#gradientStart").value,
      endColor: $("#gradientEnd").value,
      direction: $("#gradientDirection").value,
      opacity: Number($("#gradientOpacityNumber").value)
    };
    $("#gradientDialog").close();
    await applyWorkerOperation("グラデーション", "gradient", params);
  });
  $("#gradientDialog").addEventListener("close", hidePreview);
  $("#gradientDialog").addEventListener("cancel", hidePreview);
}

function openShadowHighlightDialog() {
  $("#shadowsRange").value = $("#shadowsNumber").value = 0;
  $("#highlightsRange").value = $("#highlightsNumber").value = 0;
  beginPreview(500_000);
  $("#shadowHighlightDialog").showModal();
}

function setupShadowHighlightDialog() {
  const render = () => scheduleWorkerPreview("shadowHighlight", {
    shadows: Number($("#shadowsNumber").value),
    highlights: Number($("#highlightsNumber").value)
  }, 60);
  bindRangeAndNumber("#shadowsRange", "#shadowsNumber", render);
  bindRangeAndNumber("#highlightsRange", "#highlightsNumber", render);
  $("#shadowHighlightOk").addEventListener("click", async event => {
    event.preventDefault();
    clearTimeout(genericPreviewTimer);
    const params = {
      shadows: Number($("#shadowsNumber").value),
      highlights: Number($("#highlightsNumber").value)
    };
    $("#shadowHighlightDialog").close();
    await applyWorkerOperation("シャドウ・ハイライトの明るさ", "shadowHighlight", params);
  });
  $("#shadowHighlightDialog").addEventListener("close", hidePreview);
  $("#shadowHighlightDialog").addEventListener("cancel", hidePreview);
}

async function showUsedColorCount() {
  try {
    setMessage("使用色数を計算しています…");
    const source = imageCtx.getImageData(0, 0, canvas.width, canvas.height);
    const count = await imageWorker.run("usedColorCount", source, {});
    setMessage(`使用色数: ${count.toLocaleString()}`);
    alert(`使用色数: ${count.toLocaleString()} 色`);
  } catch (error) {
    console.error(error);
    alert("使用色数を計算できませんでした。");
  }
}

function setupColorDepthDialog() {
  $("#colorDepthOk").addEventListener("click", async event => {
    event.preventDefault();
    const params = {
      mode: $("#colorDepthMode").value,
      dither: $("#colorDepthDither").checked
    };
    $("#colorDepthDialog").close();
    await applyWorkerOperation("色解像度の変更", "colorDepth", params, { clearSelection: true });
  });
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


function outputExtension(type) {
  return type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
}

function baseNameOf(name) {
  return String(name || "image").replace(/\.[^.]+$/, "") || "image";
}

function uniqueOutputName(fileName, type, usedNames) {
  const ext = outputExtension(type);
  const base = baseNameOf(fileName);
  let candidate = `${base}.${ext}`;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}_${index++}.${ext}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function computeBatchTarget(width, height, targetWidth, targetHeight, keepAspect) {
  targetWidth = Math.max(1, Math.round(Number(targetWidth) || width));
  targetHeight = Math.max(1, Math.round(Number(targetHeight) || height));
  if (!keepAspect) return { width: targetWidth, height: targetHeight };
  const scale = Math.min(targetWidth / width, targetHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function batchItemsFromWorkspace() {
  if (!folderWorkspace.active) return [];
  return folderWorkspace.entries
    .filter(entry => entry.kind === "file" && isLikelyImageName(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }))
    .map(entry => ({
      name: entry.name,
      handle: entry.handle,
      parentHandle: folderWorkspace.currentHandle,
      relativePath: entry.name,
      file: null
    }));
}

async function collectBatchWorkspaceItems({ recursive = false, excludeHandles = [] } = {}) {
  if (!folderWorkspace.active) return [];
  if (!recursive) return batchItemsFromWorkspace();

  const entries = await walkDirectory(folderWorkspace.currentHandle, {
    recursive: true,
    imageOnly: true,
    excludeHandles,
    maxFiles: 20000
  });
  return entries
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, "ja", { numeric: true }))
    .map(entry => ({
      name: entry.name,
      handle: entry.handle,
      parentHandle: entry.parentHandle,
      relativePath: entry.relativePath,
      file: null
    }));
}

function updateBatchSourceLabel() {
  const recursive = $("#batchRecursive")?.checked && batchSourceMode === "workspace";
  $("#batchFileCount").textContent = recursive && folderWorkspace.active
    ? "サブフォルダを含めて実行時に列挙"
    : `${batchItems.length}ファイル`;
  $("#batchStatus").textContent = batchItems.length || (recursive && folderWorkspace.active)
    ? "設定を確認して変換を開始してください。"
    : "ファイルを選択してください。";
}

function updateBatchOutputAvailability() {
  const subfolderRadio = document.querySelector('input[name="batchOutputMode"][value="subfolder"]');
  const folderRadio = document.querySelector('input[name="batchOutputMode"][value="folder"]');
  const supported = fsCapabilities.directoryPicker;
  subfolderRadio.disabled = !supported || !folderWorkspace.active;
  folderRadio.disabled = !supported;

  const recursive = $("#batchRecursive");
  const preserve = $("#batchPreserveStructure");
  if (recursive) recursive.disabled = batchSourceMode !== "workspace" || !folderWorkspace.active;
  if (preserve) preserve.disabled = !(recursive?.checked && batchSourceMode === "workspace");

  const selected = document.querySelector('input[name="batchOutputMode"]:checked');
  if (selected?.disabled) {
    document.querySelector('input[name="batchOutputMode"][value="zip"]').checked = true;
  }

  $("#batchOutputHint").textContent = !supported
    ? "このブラウザでは直接フォルダ出力を利用できないため、ZIPで保存します。"
    : folderWorkspace.active
      ? `現在のフォルダ: ${folderWorkspace.pathLabel}。再帰変換時は出力フォルダ自身を対象から除外します。`
      : "フォルダを開くと converted サブフォルダへ直接出力できます。任意の出力フォルダ選択は利用できます。";
}

function openBatchDialog() {
  $("#batchUseWorkspace").hidden = !folderWorkspace.active;
  if (folderWorkspace.active && (batchSourceMode === "workspace" || !batchItems.length)) {
    batchItems = batchItemsFromWorkspace();
    batchSourceMode = "workspace";
  }
  updateBatchSourceLabel();
  updateBatchOutputAvailability();
  $("#batchProgress").value = 0;
  $("#batchDialog").showModal();
}

async function applyBatchWorkerEffect(workCanvas, operation, params = {}) {
  const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
  const source = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height);
  const result = await imageWorker.run(operation, source, params);
  ctx.putImageData(result, 0, 0);
}

async function processBatchFile(file, options) {
  const workCanvas = document.createElement("canvas");
  const meta = await decodeFileToCanvas(file, workCanvas);
  const ctx = workCanvas.getContext("2d", { willReadFrequently: true });

  if (options.resize) {
    const target = computeBatchTarget(
      workCanvas.width, workCanvas.height,
      options.width, options.height,
      options.keepAspect
    );
    if (target.width !== workCanvas.width || target.height !== workCanvas.height) {
      const source = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height);
      const result = await imageWorker.run("resize", source, {
        width: target.width,
        height: target.height,
        method: options.resizeMethod,
        resample: true
      });
      workCanvas.width = result.width;
      workCanvas.height = result.height;
      workCanvas.getContext("2d", { willReadFrequently: true }).putImageData(result, 0, 0);
    }
  }

  if (options.grayscale) {
    await applyBatchWorkerEffect(workCanvas, "grayscale");
  }

  if (options.brightness !== 0 || options.contrast !== 0) {
    await applyBatchWorkerEffect(workCanvas, "brightnessContrast", {
      brightness: options.brightness,
      contrast: options.contrast
    });
  }

  if (options.histogramCorrection === "normalize") {
    await applyBatchWorkerEffect(workCanvas, "normalize");
  } else if (options.histogramCorrection === "equalize") {
    await applyBatchWorkerEffect(workCanvas, "equalize");
  }

  if (options.denoise > 0) {
    await applyBatchWorkerEffect(workCanvas, "denoise", { level: options.denoise });
  }

  if (options.margin) {
    addMargin(workCanvas, {
      top: options.marginTop,
      right: options.marginRight,
      bottom: options.marginBottom,
      left: options.marginLeft,
      color: options.marginColor
    });
  }

  return await encodeCanvas(workCanvas, options.type, options.quality, {
    exifSegment: options.type === "image/jpeg" && options.preserveExif ? meta.exifSegment : null
  });
}

async function getBatchItemFile(item) {
  if (item.file) return item.file;
  if (!item.handle) return null;
  item.file = await getFileFromHandle(item.handle);
  return item.file;
}

async function fileExistsInDirectory(directoryHandle, name) {
  try {
    await directoryHandle.getFileHandle(name);
    return true;
  } catch (error) {
    if (error?.name === "NotFoundError") return false;
    throw error;
  }
}

function nameWithSuffix(name, index) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}_${index}`;
  return `${name.slice(0, dot)}_${index}${name.slice(dot)}`;
}

async function resolveDirectOutputName(directoryHandle, desiredName, policy) {
  const exists = await fileExistsInDirectory(directoryHandle, desiredName);
  if (!exists || policy === "overwrite") return desiredName;
  if (policy === "skip") return null;

  for (let index = 2; index < 10000; index++) {
    const candidate = nameWithSuffix(desiredName, index);
    if (!(await fileExistsInDirectory(directoryHandle, candidate))) return candidate;
  }
  throw new Error(`${desiredName} の重複しない出力名を作成できませんでした。`);
}

async function resolveBatchOutputDirectory(mode) {
  if (mode === "zip") return null;

  if (mode === "subfolder") {
    if (!folderWorkspace.active) throw new Error("現在のフォルダがありません。先にフォルダを開いてください。");
    const name = $("#batchSubfolderName").value.trim();
    if (!name || /[\\/:*?"<>|]/.test(name) || name === "." || name === "..") {
      throw new Error("有効なサブフォルダ名を入力してください。");
    }
    return await getOrCreateDirectory(folderWorkspace.currentHandle, name);
  }

  if (mode === "folder") {
    return await pickOutputDirectory({
      id: "jtrim-output",
      startIn: folderWorkspace.currentHandle || "pictures"
    });
  }

  throw new Error("出力方法が不明です。");
}

function convertedRelativePath(item, type, preserveStructure) {
  const raw = preserveStructure ? (item.relativePath || item.name) : item.name;
  const parts = raw.split("/").filter(Boolean);
  const fileName = parts.pop() || item.name;
  const converted = `${baseNameOf(fileName)}.${outputExtension(type)}`;
  return preserveStructure ? [...parts, converted].join("/") : converted;
}

async function writeBatchOutput(outputRoot, item, blob, type, {
  preserveStructure,
  conflictPolicy
}) {
  const relative = convertedRelativePath(item, type, preserveStructure);
  const parts = relative.split("/").filter(Boolean);
  const fileName = parts.pop();
  const directory = preserveStructure && parts.length
    ? await getOrCreateDirectoryPath(outputRoot, parts)
    : outputRoot;
  const resolvedName = await resolveDirectOutputName(directory, fileName, conflictPolicy);
  if (resolvedName == null) return false;
  await createFileInDirectory(directory, resolvedName, blob, {
    overwrite: conflictPolicy === "overwrite"
  });
  return true;
}

function setupBatchDialog() {
  $("#batchChooseFiles").addEventListener("click", () => $("#batchFileInput").click());
  $("#batchUseWorkspace").addEventListener("click", () => {
    batchItems = batchItemsFromWorkspace();
    batchSourceMode = "workspace";
    updateBatchSourceLabel();
    updateBatchOutputAvailability();
  });

  $("#batchFileInput").addEventListener("change", event => {
    batchItems = [...(event.target.files || [])]
      .filter(file => file.type.startsWith("image/"))
      .map(file => ({
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
        file,
        handle: null
      }));
    batchSourceMode = "legacy";
    $("#batchRecursive").checked = false;
    updateBatchSourceLabel();
    updateBatchOutputAvailability();
    event.target.value = "";
  });

  document.querySelectorAll('input[name="batchOutputMode"]').forEach(input => {
    input.addEventListener("change", updateBatchOutputAvailability);
  });
  $("#batchRecursive").addEventListener("change", () => {
    updateBatchSourceLabel();
    updateBatchOutputAvailability();
  });

  $("#batchStart").addEventListener("click", async () => {
    if (!batchItems.length && !(batchSourceMode === "workspace" && folderWorkspace.active)) {
      $("#batchFileInput").click();
      return;
    }

    const options = {
      type: $("#batchType").value,
      quality: Math.max(.01, Math.min(1, Number($("#batchQuality").value) / 100)),
      preserveExif: $("#batchPreserveExif").checked,
      resize: $("#batchResize").checked,
      width: Number($("#batchWidth").value),
      height: Number($("#batchHeight").value),
      keepAspect: $("#batchKeepAspect").checked,
      resizeMethod: $("#batchResizeMethod").value,
      grayscale: $("#batchGrayscale").checked,
      brightness: Number($("#batchBrightness").value) || 0,
      contrast: Number($("#batchContrast").value) || 0,
      histogramCorrection: $("#batchHistogramCorrection").value,
      denoise: Number($("#batchDenoise").value) || 0,
      margin: $("#batchMargin").checked,
      marginTop: Number($("#batchMarginTop").value) || 0,
      marginRight: Number($("#batchMarginRight").value) || 0,
      marginBottom: Number($("#batchMarginBottom").value) || 0,
      marginLeft: Number($("#batchMarginLeft").value) || 0,
      marginColor: $("#batchMarginColor").value
    };
    const recursive = $("#batchRecursive").checked && batchSourceMode === "workspace";
    const preserveStructure = recursive && $("#batchPreserveStructure").checked;
    const outputMode = document.querySelector('input[name="batchOutputMode"]:checked')?.value || "zip";
    const conflictPolicy = $("#batchConflictPolicy").value;

    let outputDirectory = null;
    try {
      outputDirectory = await resolveBatchOutputDirectory(outputMode);
      if (batchSourceMode === "workspace") {
        batchItems = await collectBatchWorkspaceItems({
          recursive,
          excludeHandles: outputDirectory ? [outputDirectory] : []
        });
        updateBatchSourceLabel();
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        $("#batchStatus").textContent = "出力フォルダの選択をキャンセルしました。";
        return;
      }
      console.error(error);
      alert(error.message || error);
      return;
    }

    if (!batchItems.length) {
      $("#batchStatus").textContent = "変換対象の画像がありません。";
      return;
    }

    const startButton = $("#batchStart");
    startButton.disabled = true;
    const zipEntries = [];
    const zipUsedNames = new Set();
    let completed = 0;
    let skipped = 0;

    try {
      for (let i = 0; i < batchItems.length; i++) {
        const item = batchItems[i];
        $("#batchStatus").textContent = `${i + 1} / ${batchItems.length}: ${item.relativePath || item.name} を変換中…`;
        $("#batchProgress").value = i / batchItems.length * (outputMode === "zip" ? 90 : 100);

        const file = await getBatchItemFile(item);
        if (!file) throw new Error(`${item.name} を読み込めませんでした。`);
        const blob = await processBatchFile(file, options);

        if (outputMode === "zip") {
          let outputName = convertedRelativePath(item, options.type, preserveStructure);
          if (!preserveStructure) outputName = uniqueOutputName(item.name, options.type, zipUsedNames);
          zipEntries.push({ name: outputName, blob });
          completed++;
        } else {
          const written = await writeBatchOutput(outputDirectory, item, blob, options.type, {
            preserveStructure,
            conflictPolicy
          });
          if (written) completed++;
          else skipped++;
        }

        if (item.handle) item.file = null;
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (outputMode === "zip") {
        $("#batchStatus").textContent = "ZIPを作成しています…";
        $("#batchProgress").value = 94;
        const zip = await createZip(zipEntries);
        $("#batchProgress").value = 100;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        downloadBlob(zip, `jtrim-batch-${stamp}`, "application/zip");
        $("#batchStatus").textContent = `${completed}ファイルの変換が完了しました。ZIP: ${(zip.size / 1024 / 1024).toFixed(1)}MB`;
      } else {
        $("#batchProgress").value = 100;
        $("#batchStatus").textContent = `${completed}ファイルをフォルダへ保存しました${skipped ? `（${skipped}件スキップ）` : ""}。`;
        if (outputMode === "subfolder") {
          await folderWorkspace.refresh().catch(() => {});
        }
      }
    } catch (error) {
      console.error(error);
      $("#batchStatus").textContent = `一括変換に失敗しました: ${error.message || error}`;
      alert(`一括変換に失敗しました。\n${error.message || error}`);
    } finally {
      startButton.disabled = false;
    }
  });
}


function recentPermissionLabel(status) {
  if (status === "granted") return "許可済み";
  if (status === "prompt") return "再接続が必要";
  if (status === "denied") return "アクセスなし";
  return "状態不明";
}

async function renderRecentFolders() {
  const list = $("#recentFoldersList");
  const empty = $("#recentFoldersEmpty");
  list.replaceChildren();

  if (!recentHandleStoreAvailable()) {
    empty.hidden = false;
    empty.textContent = "このブラウザでは最近使ったフォルダを保存できません。";
    return;
  }

  let records = [];
  try {
    records = await listRecentDirectories();
  } catch (error) {
    console.error(error);
    empty.hidden = false;
    empty.textContent = "最近使ったフォルダを読み込めませんでした。";
    return;
  }

  empty.hidden = records.length > 0;
  empty.textContent = "最近使ったフォルダはありません。";

  for (const record of records) {
    const row = document.createElement("div");
    row.className = "recent-folder-row";

    const info = document.createElement("div");
    info.className = "recent-folder-info";
    const name = document.createElement("strong");
    name.textContent = record.name;
    const meta = document.createElement("span");
    meta.textContent = new Date(record.lastUsedAt).toLocaleString("ja-JP");
    info.append(name, meta);

    const status = await queryHandlePermission(record.handle, { write: false });
    const badge = document.createElement("span");
    badge.className = `permission-badge permission-${status}`;
    badge.textContent = recentPermissionLabel(status);

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = status === "granted" ? "開く" : "再接続";
    open.disabled = status === "denied";
    open.addEventListener("click", async () => {
      try {
        const granted = status === "granted" || await ensureHandlePermission(record.handle, {
          write: false,
          request: true
        });
        if (!granted) {
          setMessage("フォルダへのアクセスが許可されませんでした");
          return;
        }
        $("#recentFoldersDialog").close();
        await activateWorkspaceHandle(record.handle);
      } catch (error) {
        console.error(error);
        alert(`フォルダへ再接続できませんでした。\n${error.message || error}`);
      }
    });

    const forget = document.createElement("button");
    forget.type = "button";
    forget.textContent = "履歴から削除";
    forget.addEventListener("click", async () => {
      await removeRecentDirectory(record.id);
      await renderRecentFolders();
    });

    const actions = document.createElement("div");
    actions.className = "recent-folder-actions";
    actions.append(badge, open, forget);
    row.append(info, actions);
    list.append(row);
  }
}

function openRecentFoldersDialog() {
  if (!$("#recentFoldersDialog").open) $("#recentFoldersDialog").showModal();
  void renderRecentFolders();
}

function setupRecentFoldersDialog() {
  $("#recentFoldersClear").addEventListener("click", async () => {
    if (!confirm("最近使ったフォルダの履歴をすべて消去しますか？")) return;
    await clearRecentDirectories();
    await renderRecentFolders();
    setMessage("最近使ったフォルダの履歴を消去しました");
  });
}

function releaseGalleryUrls() {
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  galleryLoadMoreObserver?.disconnect();
  galleryLoadMoreObserver = null;
  for (const item of galleryItems) {
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = null;
  }
}

function clearGallery() {
  stopSlideshow();
  releaseGalleryUrls();
  galleryItems = [];
  slideshowIndex = 0;
  selectedGalleryIndex = -1;
  selectedGalleryIndices.clear();
  lastSelectedGalleryIndex = -1;
}

function setGalleryFiles(files) {
  clearGallery();
  folderWorkspace.useLegacyMode();
  galleryItems = [...files]
    .filter(file => file.type.startsWith("image/"))
    .sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }))
    .map(file => ({
      kind: "file",
      name: file.name,
      file,
      handle: null,
      url: URL.createObjectURL(file),
      size: file.size,
      lastModified: file.lastModified,
      mimeType: file.type
    }));
  slideshowIndex = 0;
  selectedGalleryIndex = -1;
}

async function activateWorkspaceHandle(handle, {
  remember = true,
  openView = "thumbnails"
} = {}) {
  state.setBusy(true);
  try {
    setMessage(`${handle.name} を読み込んでいます…`);
    await folderWorkspace.openRoot(handle);
    if (remember && recentHandleStoreAvailable()) {
      await saveRecentDirectory(handle, { preferredMode: "read", maxEntries: 10 }).catch(error => {
        console.debug("Recent directory handle could not be stored:", error);
      });
    }
    await rebuildWorkspaceGallery({ render: false });
    if (openView === "slideshow") openSlideshow();
    else await openThumbnails();
    setMessage(`${handle.name} をフォルダとして開きました`);
  } finally {
    state.setBusy(false);
    refreshUI();
  }
}

async function openWorkspaceFolder({ openView = "thumbnails" } = {}) {
  if (!fsCapabilities.directoryPicker) {
    alert("このブラウザではフォルダ直接アクセスを利用できません。複数ファイル選択をご利用ください。");
    return;
  }

  try {
    const handle = await pickWorkspaceDirectory({
      mode: "read",
      id: "jtrim-workspace",
      startIn: folderWorkspace.currentHandle || "pictures"
    });
    await activateWorkspaceHandle(handle, { openView });
  } catch (error) {
    if (error?.name === "AbortError") {
      setMessage("フォルダ選択をキャンセルしました");
      return;
    }
    console.error(error);
    alert(`フォルダを開けませんでした。\n${error.message || error}`);
    setMessage("フォルダを開けませんでした");
  }
}

async function rebuildWorkspaceGallery({ render = true } = {}) {
  releaseGalleryUrls();
  const entries = await folderWorkspace.visibleEntries(isLikelyImageName);
  galleryItems = entries.map(entry => ({
    ...entry,
    file: null,
    url: null
  }));
  selectedGalleryIndex = -1;
  selectedGalleryIndices.clear();
  lastSelectedGalleryIndex = -1;
  slideshowIndex = 0;
  renderWorkspaceChrome();
  if (render && $("#thumbnailDialog").open) await renderThumbnails();
}

function renderWorkspaceChrome() {
  const active = folderWorkspace.active;
  $("#galleryModeLabel").textContent = active
    ? `フォルダモード — ${folderWorkspace.pathLabel}`
    : "複数ファイルモード";
  $("#workspaceBrowserControls").hidden = !active;
  $("#galleryRefresh").hidden = !active;
  $("#galleryOpenFolder").disabled = !fsCapabilities.directoryPicker;
  $("#galleryOpenFolder").title = fsCapabilities.directoryPicker
    ? "フォルダを選択して開きます"
    : "このブラウザはFile System Access APIに対応していません";
  $("#workspacePermissionStatus").textContent = active
    ? `読み取り権限: ${folderWorkspace.permission.read === "granted" ? "許可済み" : folderWorkspace.permission.read}`
    : "";
  renderWorkspaceBreadcrumbs();
}

function renderWorkspaceBreadcrumbs() {
  const nav = $("#workspaceBreadcrumbs");
  nav.replaceChildren();
  if (!folderWorkspace.active) return;

  folderWorkspace.breadcrumbs.forEach((crumb, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-separator";
      sep.textContent = "›";
      nav.append(sep);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = crumb.name;
    button.disabled = index === folderWorkspace.breadcrumbs.length - 1;
    button.addEventListener("click", async () => {
      try {
        setMessage(`${crumb.name} を開いています…`);
        await folderWorkspace.navigateToBreadcrumb(index);
        await rebuildWorkspaceGallery();
        setMessage(folderWorkspace.pathLabel);
      } catch (error) {
        console.error(error);
        setMessage("フォルダを移動できませんでした");
      }
    });
    nav.append(button);
  });
}

async function ensureGalleryFile(item) {
  if (!item || item.kind !== "file") return null;
  if (item.file) return item.file;
  if (!item.handle) return null;
  const file = await getFileFromHandle(item.handle);
  item.file = file;
  item.size = file.size;
  item.lastModified = file.lastModified;
  item.mimeType = file.type;
  return file;
}

async function ensureGalleryUrl(item) {
  if (!item || item.kind !== "file") return null;
  if (item.url) return item.url;
  if (!isLikelyImageName(item.name)) return null;
  const file = await ensureGalleryFile(item);
  if (!file?.type?.startsWith("image/")) return null;
  item.url = URL.createObjectURL(file);
  return item.url;
}

function workspaceRelativePathFor(item) {
  return [...folderWorkspace.breadcrumbs.map(crumb => crumb.name), item.name].join("/");
}

async function openGalleryItem(item) {
  if (!item) return;
  if (item.kind === "directory") {
    try {
      setMessage(`${item.name} を開いています…`);
      await folderWorkspace.enterDirectory(item);
      await rebuildWorkspaceGallery();
      setMessage(folderWorkspace.pathLabel);
    } catch (error) {
      console.error(error);
      alert(`フォルダを開けませんでした。\n${error.message || error}`);
    }
    return;
  }

  if (!isLikelyImageName(item.name)) {
    setMessage("このファイルは画像として開けません");
    return;
  }

  const file = await ensureGalleryFile(item);
  if (!file?.type?.startsWith("image/")) {
    setMessage("このファイルはブラウザで画像として認識されませんでした");
    return;
  }

  $("#thumbnailDialog").close();
  await loadFile(file, item.handle ? {
    fileHandle: item.handle,
    parentDirectoryHandle: folderWorkspace.currentHandle,
    workspaceRelativePath: workspaceRelativePathFor(item)
  } : null);
}

function updateGallerySelectionUI() {
  $("#gallerySelectionCount").textContent = `選択 ${selectedGalleryIndices.size}件`;
  $("#galleryBatchSelected").disabled = ![...selectedGalleryIndices].some(index => {
    const item = galleryItems[index];
    return item?.kind === "file" && isLikelyImageName(item.name);
  });
  for (const node of $("#thumbnailGrid").querySelectorAll(".thumbnail-item")) {
    const index = Number(node.dataset.index);
    node.classList.toggle("selected", selectedGalleryIndices.has(index));
    node.setAttribute("aria-selected", selectedGalleryIndices.has(index) ? "true" : "false");
  }
}

function selectGalleryItem(index, {
  toggle = false,
  range = false,
  additive = false
} = {}) {
  if (index < 0 || index >= galleryItems.length) return;
  selectedGalleryIndex = index;

  if (range && lastSelectedGalleryIndex >= 0) {
    if (!additive) selectedGalleryIndices.clear();
    const from = Math.min(lastSelectedGalleryIndex, index);
    const to = Math.max(lastSelectedGalleryIndex, index);
    for (let i = from; i <= to; i++) selectedGalleryIndices.add(i);
  } else if (toggle) {
    if (selectedGalleryIndices.has(index)) selectedGalleryIndices.delete(index);
    else selectedGalleryIndices.add(index);
    lastSelectedGalleryIndex = index;
  } else {
    selectedGalleryIndices.clear();
    selectedGalleryIndices.add(index);
    lastSelectedGalleryIndex = index;
  }

  updateGallerySelectionUI();
}

function clearGallerySelection() {
  selectedGalleryIndex = -1;
  lastSelectedGalleryIndex = -1;
  selectedGalleryIndices.clear();
  updateGallerySelectionUI();
}

function formatGalleryMeta(item) {
  if (item.kind !== "file") return "フォルダ";
  const parts = [];
  if (item.size != null) {
    const size = item.size < 1024 * 1024
      ? `${(item.size / 1024).toFixed(0)} KB`
      : `${(item.size / 1024 / 1024).toFixed(1)} MB`;
    parts.push(size);
  }
  if (item.lastModified) parts.push(new Date(item.lastModified).toLocaleDateString("ja-JP"));
  return parts.join(" · ");
}

function createThumbnailObserver() {
  thumbnailObserver?.disconnect();
  if (typeof IntersectionObserver === "undefined") return null;
  thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      thumbnailObserver.unobserve(entry.target);
      const index = Number(entry.target.dataset.index);
      void loadThumbnail(index, entry.target);
    }
  }, {
    root: $("#thumbnailGrid"),
    rootMargin: "360px"
  });
  return thumbnailObserver;
}

async function loadThumbnail(index, button) {
  const item = galleryItems[index];
  if (!item || item.kind !== "file" || !isLikelyImageName(item.name)) return;
  try {
    const url = await ensureGalleryUrl(item);
    if (!url || !button.isConnected || galleryItems[index] !== item) return;
    const placeholder = button.querySelector(".thumbnail-loading");
    const img = document.createElement("img");
    img.src = url;
    img.alt = item.name;
    img.decoding = "async";
    placeholder?.replaceWith(img);
    const meta = button.querySelector(".thumbnail-meta");
    if (meta) meta.textContent = formatGalleryMeta(item);
  } catch {
    const placeholder = button.querySelector(".thumbnail-loading");
    if (placeholder) placeholder.textContent = "読込失敗";
  }
}

function createGalleryCard(item, index, observer) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `thumbnail-item${item.kind === "directory" ? " directory" : ""}`;
  button.title = item.name;
  button.dataset.index = String(index);
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", selectedGalleryIndices.has(index) ? "true" : "false");

  let preview;
  if (item.kind === "directory") {
    preview = document.createElement("div");
    preview.className = "thumbnail-folder-icon";
    preview.textContent = "📁";
  } else if (isLikelyImageName(item.name)) {
    preview = document.createElement("div");
    preview.className = "thumbnail-loading";
    preview.textContent = "読込待ち";
  } else {
    preview = document.createElement("div");
    preview.className = "thumbnail-folder-icon";
    preview.textContent = "📄";
  }

  const text = document.createElement("div");
  text.className = "thumbnail-text";
  const name = document.createElement("span");
  name.textContent = item.name;
  const meta = document.createElement("small");
  meta.className = "thumbnail-meta";
  meta.textContent = formatGalleryMeta(item);
  text.append(name, meta);

  button.append(preview, text);
  button.classList.toggle("selected", selectedGalleryIndices.has(index));
  button.addEventListener("click", event => {
    selectGalleryItem(index, {
      toggle: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
      additive: event.ctrlKey || event.metaKey
    });
  });
  button.addEventListener("dblclick", async () => {
    if (item.kind === "file") {
      const slides = getSlideshowItems();
      const slideIndex = slides.indexOf(item);
      if (slideIndex >= 0) slideshowIndex = slideIndex;
    }
    await openGalleryItem(item);
  });

  if (item.kind === "file" && isLikelyImageName(item.name)) {
    if (observer) observer.observe(button);
    else void loadThumbnail(index, button);
  }
  return button;
}

const GALLERY_CHUNK_SIZE = 240;

function appendGalleryChunk(observer) {
  const grid = $("#thumbnailGrid");
  grid.querySelector(".gallery-load-more-sentinel")?.remove();

  const end = Math.min(galleryItems.length, renderedGalleryCount + GALLERY_CHUNK_SIZE);
  const fragment = document.createDocumentFragment();
  for (let index = renderedGalleryCount; index < end; index++) {
    fragment.append(createGalleryCard(galleryItems[index], index, observer));
  }
  grid.append(fragment);
  renderedGalleryCount = end;
  updateGallerySelectionUI();

  if (renderedGalleryCount < galleryItems.length) {
    const sentinel = document.createElement("div");
    sentinel.className = "gallery-load-more-sentinel";
    sentinel.textContent = `${renderedGalleryCount.toLocaleString()} / ${galleryItems.length.toLocaleString()}件を表示中…`;
    grid.append(sentinel);
    galleryLoadMoreObserver?.observe(sentinel);
  }
}

function ensureGalleryIndexRendered(index, observer = thumbnailObserver) {
  while (index >= renderedGalleryCount && renderedGalleryCount < galleryItems.length) {
    appendGalleryChunk(observer);
  }
}

function createGalleryLoadMoreObserver(observer) {
  galleryLoadMoreObserver?.disconnect();
  if (typeof IntersectionObserver === "undefined") return null;
  galleryLoadMoreObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      galleryLoadMoreObserver.unobserve(entry.target);
      appendGalleryChunk(observer);
    }
  }, { root: $("#thumbnailGrid"), rootMargin: "700px" });
  return galleryLoadMoreObserver;
}

async function renderThumbnails() {
  const grid = $("#thumbnailGrid");
  thumbnailObserver?.disconnect();
  galleryLoadMoreObserver?.disconnect();
  grid.replaceChildren();
  renderedGalleryCount = 0;
  renderWorkspaceChrome();

  if (folderWorkspace.active) {
    $("#galleryCount").textContent = `${galleryItems.filter(item => item.kind === "file").length}ファイル / ${galleryItems.filter(item => item.kind === "directory").length}フォルダ`;
  } else {
    $("#galleryCount").textContent = `${galleryItems.length}ファイル`;
  }

  const observer = createThumbnailObserver();
  const loadMore = createGalleryLoadMoreObserver(observer);
  appendGalleryChunk(observer);
  if (!loadMore) {
    while (renderedGalleryCount < galleryItems.length) appendGalleryChunk(observer);
  }

  if (galleryItems.length && selectedGalleryIndex < 0) selectGalleryItem(0);
  else updateGallerySelectionUI();
}

async function openThumbnails() {
  if (!$("#thumbnailDialog").open) $("#thumbnailDialog").showModal();
  await renderThumbnails();
}

function requestGallery(action) {
  if (folderWorkspace.active) {
    if (action === "slideshow") openSlideshow();
    else void openThumbnails();
    return;
  }

  if (!galleryItems.length) {
    if (action === "thumbnails" && fsCapabilities.directoryPicker) {
      void openThumbnails();
      return;
    }
    galleryPendingAction = action;
    $("#galleryFileInput").click();
    return;
  }
  if (action === "slideshow") openSlideshow();
  else void openThumbnails();
}

function getSlideshowItems() {
  return galleryItems.filter(item =>
    item.kind === "file" &&
    (item.file?.type?.startsWith("image/") || isLikelyImageName(item.name))
  );
}

function nextSlideshowIndex(direction = 1) {
  const slides = getSlideshowItems();
  if (!slides.length) return null;

  if ($("#slideshowRandom").checked && slides.length > 1) {
    let next = slideshowIndex;
    for (let tries = 0; tries < 8 && next === slideshowIndex; tries++) {
      next = Math.floor(Math.random() * slides.length);
    }
    return next;
  }

  const candidate = slideshowIndex + direction;
  if ($("#slideshowLoop").checked) return (candidate + slides.length) % slides.length;
  if (candidate < 0 || candidate >= slides.length) return null;
  return candidate;
}

async function showSlide(index) {
  const slides = getSlideshowItems();
  if (!slides.length) {
    $("#slideshowImage").hidden = true;
    $("#slideshowEmpty").hidden = false;
    $("#slideshowName").textContent = "—";
    $("#slideshowPosition").textContent = "0 / 0";
    return;
  }

  if (index < 0 || index >= slides.length) {
    if ($("#slideshowLoop").checked) index = (index + slides.length) % slides.length;
    else index = Math.max(0, Math.min(slides.length - 1, index));
  }

  slideshowIndex = index;
  const item = slides[slideshowIndex];
  const generation = ++slideshowGeneration;
  $("#slideshowEmpty").hidden = false;
  $("#slideshowEmpty").textContent = "読み込み中…";

  try {
    const url = await ensureGalleryUrl(item);
    if (generation !== slideshowGeneration) return;
    if (!url) throw new Error("画像URLを生成できませんでした");
    $("#slideshowImage").hidden = false;
    $("#slideshowEmpty").hidden = true;
    $("#slideshowImage").src = url;
    $("#slideshowImage").alt = item.name;
    $("#slideshowName").textContent = item.name;
    $("#slideshowPosition").textContent = `${slideshowIndex + 1} / ${slides.length}`;

    const next = nextSlideshowIndex(1);
    if (next != null && next !== slideshowIndex) void ensureGalleryUrl(slides[next]);
  } catch {
    if (generation !== slideshowGeneration) return;
    $("#slideshowImage").hidden = true;
    $("#slideshowEmpty").hidden = false;
    $("#slideshowEmpty").textContent = "画像を読み込めませんでした。";
  }
}

async function advanceSlideshow(direction = 1) {
  const next = nextSlideshowIndex(direction);
  if (next == null) {
    stopSlideshow();
    return;
  }
  await showSlide(next);
}

function stopSlideshow() {
  if (slideshowTimer) clearInterval(slideshowTimer);
  slideshowTimer = null;
  const play = $("#slideshowPlay");
  if (play) play.textContent = "▶ 再生";
}

function startSlideshow() {
  stopSlideshow();
  const seconds = Math.max(1, Number($("#slideshowInterval").value) || 3);
  slideshowTimer = setInterval(() => void advanceSlideshow(1), seconds * 1000);
  $("#slideshowPlay").textContent = "⏸ 停止";
}

function toggleSlideshow() {
  if (slideshowTimer) stopSlideshow();
  else startSlideshow();
}

function openSlideshow() {
  void showSlide(slideshowIndex);
  if (!$("#slideshowDialog").open) $("#slideshowDialog").showModal();
  $("#slideshowFolder").disabled = !fsCapabilities.directoryPicker;
}

function selectedItemsForBatch() {
  return [...selectedGalleryIndices]
    .sort((a, b) => a - b)
    .map(index => galleryItems[index])
    .filter(item => item?.kind === "file" && isLikelyImageName(item.name))
    .map(item => ({
      name: item.name,
      relativePath: item.name,
      file: item.file || null,
      handle: item.handle || null,
      parentHandle: folderWorkspace.active ? folderWorkspace.currentHandle : null
    }));
}

function galleryColumns() {
  const grid = $("#thumbnailGrid");
  const first = grid.querySelector(".thumbnail-item");
  if (!first) return 1;
  const width = first.getBoundingClientRect().width;
  const gap = 12;
  return Math.max(1, Math.floor((grid.clientWidth + gap) / (width + gap)));
}

async function moveGallerySelection(nextIndex) {
  nextIndex = Math.max(0, Math.min(galleryItems.length - 1, nextIndex));
  ensureGalleryIndexRendered(nextIndex);
  selectGalleryItem(nextIndex);
  const node = $("#thumbnailGrid").querySelector(`.thumbnail-item[data-index="${nextIndex}"]`);
  node?.focus({ preventScroll: true });
  node?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function setupGallery() {
  $("#galleryOpenFolder").disabled = !fsCapabilities.directoryPicker;
  $("#galleryFileInput").addEventListener("change", event => {
    const files = event.target.files || [];
    setGalleryFiles(files);
    event.target.value = "";
    const action = galleryPendingAction || "thumbnails";
    galleryPendingAction = null;
    if (action === "slideshow") openSlideshow();
    else void openThumbnails();
  });

  $("#galleryOpenFolder").addEventListener("click", () => void openWorkspaceFolder());
  $("#galleryChooseFiles").addEventListener("click", () => {
    galleryPendingAction = "thumbnails";
    $("#galleryFileInput").click();
  });
  $("#galleryRefresh").addEventListener("click", async () => {
    if (!folderWorkspace.active) return;
    try {
      setMessage("フォルダを更新しています…");
      await folderWorkspace.refresh();
      await rebuildWorkspaceGallery();
      setMessage(folderWorkspace.pathLabel);
    } catch (error) {
      console.error(error);
      setMessage("フォルダを更新できませんでした");
    }
  });

  let searchTimer = null;
  $("#gallerySearch").addEventListener("input", event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      folderWorkspace.setFilter({ query: event.target.value });
      await rebuildWorkspaceGallery();
    }, 120);
  });
  $("#gallerySort").addEventListener("change", async event => {
    folderWorkspace.setSort(event.target.value);
    setMessage("並び替えています…");
    await rebuildWorkspaceGallery();
    setMessage(folderWorkspace.pathLabel);
  });
  $("#gallerySortDirection").addEventListener("click", async event => {
    const next = event.currentTarget.dataset.direction === "asc" ? "desc" : "asc";
    event.currentTarget.dataset.direction = next;
    event.currentTarget.textContent = next === "asc" ? "↑" : "↓";
    event.currentTarget.title = next === "asc" ? "昇順" : "降順";
    folderWorkspace.setSort(folderWorkspace.sort.field, next);
    await rebuildWorkspaceGallery();
  });
  $("#galleryImageOnly").addEventListener("change", async event => {
    folderWorkspace.setFilter({ imageOnly: event.target.checked });
    await rebuildWorkspaceGallery();
  });
  $("#galleryThumbSize").addEventListener("change", event => {
    $("#thumbnailGrid").dataset.thumbSize = event.target.value;
  });
  $("#thumbnailGrid").dataset.thumbSize = $("#galleryThumbSize").value;

  $("#galleryBatchSelected").addEventListener("click", () => {
    const selected = selectedItemsForBatch();
    if (!selected.length) return;
    batchItems = selected;
    batchSourceMode = "selection";
    $("#batchRecursive").checked = false;
    $("#thumbnailDialog").close();
    openBatchDialog();
  });

  $("#thumbnailGrid").addEventListener("keydown", async event => {
    if (!galleryItems.length) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectedGalleryIndices = new Set(galleryItems.map((_, index) => index));
      selectedGalleryIndex = Math.max(0, selectedGalleryIndex);
      updateGallerySelectionUI();
      return;
    }

    let next = selectedGalleryIndex < 0 ? 0 : selectedGalleryIndex;
    const columns = galleryColumns();
    if (event.key === "ArrowLeft") next -= 1;
    else if (event.key === "ArrowRight") next += 1;
    else if (event.key === "ArrowUp") next -= columns;
    else if (event.key === "ArrowDown") next += columns;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = galleryItems.length - 1;
    else if (event.key === "Enter" && selectedGalleryIndex >= 0) {
      event.preventDefault();
      await openGalleryItem(galleryItems[selectedGalleryIndex]);
      return;
    } else if (event.code === "Space" && selectedGalleryIndex >= 0) {
      event.preventDefault();
      selectGalleryItem(selectedGalleryIndex, { toggle: true });
      return;
    } else return;

    event.preventDefault();
    await moveGallerySelection(next);
  });

  $("#slideshowFiles").addEventListener("click", () => {
    galleryPendingAction = "slideshow";
    $("#galleryFileInput").click();
  });
  $("#slideshowFolder").addEventListener("click", async () => {
    $("#slideshowDialog").close();
    await openWorkspaceFolder({ openView: "slideshow" });
  });
  $("#slideshowPrev").addEventListener("click", () => void advanceSlideshow(-1));
  $("#slideshowNext").addEventListener("click", () => void advanceSlideshow(1));
  $("#slideshowPlay").addEventListener("click", toggleSlideshow);
  $("#slideshowInterval").addEventListener("change", () => {
    if (slideshowTimer) startSlideshow();
  });
  $("#slideshowRandom").addEventListener("change", () => {
    if (slideshowTimer) startSlideshow();
  });
  $("#slideshowFullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("#slideshowDialog").requestFullscreen();
    } catch (error) {
      console.debug("Fullscreen unavailable:", error);
    }
  });
  $("#slideshowClose").addEventListener("click", () => $("#slideshowDialog").close());
  $("#slideshowDialog").addEventListener("close", stopSlideshow);
  $("#slideshowDialog").addEventListener("cancel", stopSlideshow);
  $("#slideshowDialog").addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      void advanceSlideshow(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      void advanceSlideshow(1);
    } else if (event.code === "Space") {
      event.preventDefault();
      toggleSlideshow();
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      $("#slideshowFullscreen").click();
    }
  });

  renderWorkspaceChrome();
}


function writableImageType(type, fileName = "") {
  if (["image/jpeg", "image/png", "image/webp"].includes(type)) return type;
  const lower = String(fileName || "").toLowerCase();
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.webp$/.test(lower)) return "image/webp";
  return null;
}

function nameWithTypeExtension(name, type) {
  const base = String(name || "image").replace(/\.[^.]+$/, "");
  const ext = type === "image/jpeg" ? ".jpg" : type === "image/webp" ? ".webp" : ".png";
  return base + ext;
}

function currentSaveQuality(type) {
  if (type === "image/webp") return Number($("#saveWebpQuality").value) / 100;
  if (type === "image/jpeg") return Number($("#saveQuality").value) / 100;
  return .92;
}

async function encodeCurrentForSave(type, {
  preserveExif = true,
  respectTargetMode = false
} = {}) {
  const exifSegment = type === "image/jpeg" && preserveExif
    ? state.document?.exifSegment
    : null;

  if (
    type === "image/jpeg" &&
    respectTargetMode &&
    document.querySelector('input[name="jpegMode"]:checked')?.value === "target"
  ) {
    const targetKb = Math.max(1, Number($("#saveTargetKb").value) || 1);
    const result = await encodeJpegToTargetSize(canvas, targetKb * 1024, { exifSegment });
    return {
      blob: result.blob,
      detail: result.targetMet
        ? `${(result.blob.size / 1024).toFixed(1)}KB / 品質約${Math.round(result.quality * 100)}`
        : `品質1でも目標サイズ超過: ${(result.blob.size / 1024).toFixed(1)}KB`
    };
  }

  const blob = await encodeCanvas(canvas, type, currentSaveQuality(type), { exifSegment });
  return { blob, detail: `${(blob.size / 1024).toFixed(1)}KB` };
}

async function updateDocumentFileHandleAfterSave(handle, type) {
  const latest = await getFileFromHandle(handle);
  if (!state.document) return;
  state.document.fileHandle = handle;
  state.document.fileName = handle.name || latest.name || state.document.fileName;
  state.document.sourceFormat = type;
  state.document.sourceSnapshot = await createFileSnapshot(latest);
  state.markModified(false);
}

async function overwriteCurrentDocument() {
  if (!documentReady()) return;
  const doc = state.document;

  if (!doc.fileHandle) {
    openSaveDialog();
    return;
  }

  const type = writableImageType(doc.sourceFormat, doc.fileName);
  if (!type) {
    setMessage("この形式は直接上書きできないため、名前を付けて保存します");
    openSaveDialog();
    return;
  }

  try {
    const granted = await ensureHandlePermission(doc.fileHandle, { write: true, request: true });
    if (!granted) {
      setMessage("上書き保存の書き込み権限が許可されませんでした");
      return;
    }

    const latest = await getFileFromHandle(doc.fileHandle);
    const snapshot = doc.sourceSnapshot;
    const latestSnapshot = await createFileSnapshot(latest);
    const changedExternally = fileSnapshotChanged(snapshot, latestSnapshot);

    if (
      changedExternally &&
      !confirm("このファイルはJTrim Webで開いた後に変更されています。外部の変更を上書きして保存しますか？")
    ) {
      setMessage("上書き保存をキャンセルしました");
      return;
    }

    state.setBusy(true);
    setMessage(`${doc.fileName} を上書き保存しています…`);
    const encoded = await encodeCurrentForSave(type, {
      preserveExif: true,
      respectTargetMode: false
    });
    await writeBlobToFileHandle(doc.fileHandle, encoded.blob);
    await updateDocumentFileHandleAfterSave(doc.fileHandle, type);
    setMessage(`${doc.fileName} を上書き保存しました (${encoded.detail})`);
  } catch (error) {
    console.error(error);
    if (error?.name === "AbortError" || error?.name === "NotAllowedError") {
      setMessage("上書き保存をキャンセルしました");
      return;
    }
    alert(`上書き保存に失敗しました。\n${error.message || error}`);
    setMessage("上書き保存に失敗しました");
  } finally {
    state.setBusy(false);
    refreshUI();
  }
}

function openSaveDialog() {
  const hasExif = Boolean(state.document?.exifSegment);
  $("#savePreserveExif").disabled = !hasExif;
  $("#savePreserveExif").checked = hasExif;
  $("#saveExifStatus").textContent = hasExif
    ? "元JPEGのExifを保持できます（Orientationは1に正規化し、画像サイズタグを更新します）。"
    : "保持できるExif情報はありません。";
  $("#saveDialog").showModal();
}

function setupSaveDialog() {
  const typeSelect = $("#saveType");
  const updateSaveOptions = () => {
    const type = typeSelect.value;
    $("#jpegOptions").hidden = type !== "image/jpeg";
    $("#genericQualityRow").hidden = type !== "image/webp";
  };

  $("#saveQuality").addEventListener("input", event => {
    $("#saveQualityOutput").value = event.target.value;
  });
  $("#saveWebpQuality").addEventListener("input", event => {
    $("#saveWebpQualityOutput").value = event.target.value;
  });
  typeSelect.addEventListener("change", updateSaveOptions);
  updateSaveOptions();

  $("#saveOk").addEventListener("click", async event => {
    event.preventDefault();
    const type = typeSelect.value;
    const baseName = state.document?.fileName || "image";
    const preserveExif = type === "image/jpeg" && $("#savePreserveExif").checked;

    let targetHandle = null;
    if (fsCapabilities.saveFilePicker) {
      try {
        targetHandle = await pickSaveFileHandle({
          suggestedName: nameWithTypeExtension(baseName, type),
          type,
          id: "jtrim-save"
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          setMessage("保存をキャンセルしました");
          return;
        }
        console.error(error);
        alert(`保存先を選択できませんでした。\n${error.message || error}`);
        return;
      }
    }

    $("#saveDialog").close();

    try {
      state.setBusy(true);
      setMessage("保存ファイルを作成しています…");
      const encoded = await encodeCurrentForSave(type, {
        preserveExif,
        respectTargetMode: true
      });

      if (targetHandle) {
        await writeBlobToFileHandle(targetHandle, encoded.blob);
        await updateDocumentFileHandleAfterSave(targetHandle, type);
        if (state.document) {
          state.document.parentDirectoryHandle = null;
          state.document.workspaceRelativePath = targetHandle.name;
        }
        setMessage(`${targetHandle.name} に保存しました (${encoded.detail})`);
      } else {
        downloadBlob(encoded.blob, baseName, type);
        state.markModified(false);
        setMessage(`保存ファイルを作成しました (${encoded.detail})`);
      }
    } catch (error) {
      console.error(error);
      alert(`保存に失敗しました。\n${error.message || error}`);
      setMessage("保存に失敗しました");
    } finally {
      state.setBusy(false);
      refreshUI();
    }
  });
}

async function handleDroppedDataTransfer(dataTransfer) {
  if (!dataTransfer) return false;

  const handles = await getDroppedFileSystemHandles(dataTransfer);
  const directoryHandle = handles.find(handle => handle?.kind === "directory");
  if (directoryHandle) {
    await activateWorkspaceHandle(directoryHandle);
    return true;
  }

  const fileHandle = handles.find(handle => handle?.kind === "file" && isLikelyImageName(handle.name));
  if (fileHandle) {
    const file = await getFileFromHandle(fileHandle);
    if (file?.type?.startsWith("image/")) {
      await loadFile(file, {
        fileHandle,
        parentDirectoryHandle: null,
        workspaceRelativePath: file.name
      });
      return true;
    }
  }

  const files = [...(dataTransfer.files || [])].filter(file => file.type.startsWith("image/"));
  if (files.length === 1) {
    await loadFile(files[0]);
    return true;
  }
  if (files.length > 1) {
    setGalleryFiles(files);
    await openThumbnails();
    return true;
  }
  return false;
}

function setupFileInput() {
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (file) await loadFile(file);
    fileInput.value = "";
  });

  const allowDrop = event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  workspace.addEventListener("dragover", allowDrop);
  workspace.addEventListener("drop", async event => {
    event.preventDefault();
    try {
      await handleDroppedDataTransfer(event.dataTransfer);
    } catch (error) {
      console.error(error);
      alert(`ドロップした項目を開けませんでした。\n${error.message || error}`);
    }
  });

  $("#thumbnailGrid").addEventListener("dragover", allowDrop);
  $("#thumbnailGrid").addEventListener("drop", async event => {
    event.preventDefault();
    try {
      await handleDroppedDataTransfer(event.dataTransfer);
    } catch (error) {
      console.error(error);
      alert(`ドロップした項目を開けませんでした。\n${error.message || error}`);
    }
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
    else if (ctrl && !event.shiftKey && key === "s") command = "file.overwrite";
    else if (ctrl && event.altKey && key === "t") command = "file.thumbnails";
    else if (ctrl && key === "b") command = "file.batch";
    else if (ctrl && key === "w") command = "file.slideshow";
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
    else if (ctrl && key === "u") command = "image.coordinateCrop";
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
setupShapeCropDialog();
setupCoordinateCropDialog();
setupShiftDialog();
setupShadowDialog();
setupTextureDialog();
setupCaptureDialog();
setupDenoiseDialog();
setupTransparentColorDialog();
setupRedEyeDialog();
setupColorScaleDialog();
setupGradientDialog();
setupShadowHighlightDialog();
setupColorDepthDialog();
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
setupBatchDialog();
setupRecentFoldersDialog();
setupGallery();
setupFileInput();
setupZoom();
setupKeyboard();
setupBeforeUnload();

state.subscribe(() => refreshUI());
refreshUI();
setMessage("準備完了");
