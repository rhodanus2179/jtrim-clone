export const DEFAULT_PRINT_SETTINGS = Object.freeze({
  paper: "a4",
  orientation: "auto",
  scaleMode: "fit",
  scalePercent: 100,
  borderless: false,
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 10,
  marginLeftMm: 10,
  center: true
});

const PAPER_MM = {
  a4: [210, 297],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6]
};

export function normalizePrintSettings(input = {}) {
  const settings = { ...DEFAULT_PRINT_SETTINGS, ...input };
  if (!PAPER_MM[settings.paper]) settings.paper = "a4";
  if (!["auto", "portrait", "landscape"].includes(settings.orientation)) settings.orientation = "auto";
  if (!["fit", "percent", "stretch"].includes(settings.scaleMode)) settings.scaleMode = "fit";
  settings.scalePercent = Math.max(10, Math.min(500, Number(settings.scalePercent) || 100));
  for (const key of ["marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm"]) {
    settings[key] = Math.max(0, Math.min(100, Number(settings[key]) || 0));
  }
  settings.borderless = Boolean(settings.borderless);
  settings.center = Boolean(settings.center);
  return settings;
}

export function resolvedOrientation(settings, imageWidth, imageHeight) {
  const normalized = normalizePrintSettings(settings);
  if (normalized.orientation !== "auto") return normalized.orientation;
  return imageWidth > imageHeight ? "landscape" : "portrait";
}

export function pageSizeMm(settings, imageWidth = 1, imageHeight = 1) {
  const normalized = normalizePrintSettings(settings);
  const base = PAPER_MM[normalized.paper] || PAPER_MM.a4;
  return resolvedOrientation(normalized, imageWidth, imageHeight) === "landscape"
    ? { width: base[1], height: base[0] }
    : { width: base[0], height: base[1] };
}

export function printCss(settings, imageWidth, imageHeight) {
  const normalized = normalizePrintSettings(settings);
  const orientation = resolvedOrientation(normalized, imageWidth, imageHeight);
  const margins = normalized.borderless
    ? "0"
    : `${normalized.marginTopMm}mm ${normalized.marginRightMm}mm ${normalized.marginBottomMm}mm ${normalized.marginLeftMm}mm`;
  const paper = normalized.paper === "letter" ? "Letter" : normalized.paper === "legal" ? "Legal" : "A4";

  let imageRule = "max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;";
  if (normalized.scaleMode === "percent") {
    imageRule = `width:${normalized.scalePercent}%;height:auto;max-width:none;max-height:none;`;
  } else if (normalized.scaleMode === "stretch") {
    imageRule = "width:100%;height:100%;max-width:none;max-height:none;object-fit:fill;";
  }

  return `
@page { size: ${paper} ${orientation}; margin: ${margins}; }
@media print {
  body > *:not(.print-host) { display: none !important; }
  .print-host {
    display: flex !important;
    box-sizing: border-box;
    width: 100%;
    height: 100vh;
    align-items: ${normalized.center ? "center" : "flex-start"};
    justify-content: ${normalized.center ? "center" : "flex-start"};
    overflow: hidden;
  }
  .print-host img { ${imageRule} }
}
`;
}
