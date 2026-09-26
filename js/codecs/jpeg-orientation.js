const MATRICES = {
  identity: [1, 0, 0, 1],
  flipH: [-1, 0, 0, 1],
  flipV: [1, 0, 0, -1],
  rotate180: [-1, 0, 0, -1],
  transpose: [0, 1, 1, 0],
  rotate90: [0, 1, -1, 0],
  transverse: [0, -1, -1, 0],
  rotate270: [0, -1, 1, 0]
};

const ORIENTATION_TO_OPERATION = {
  1: "identity",
  2: "flipH",
  3: "rotate180",
  4: "flipV",
  5: "transpose",
  6: "rotate90",
  7: "transverse",
  8: "rotate270"
};

function multiply(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3]
  ];
}

function sameMatrix(a, b) {
  return a.every((value, index) => value === b[index]);
}

export function operationForExifOrientation(orientation) {
  return ORIENTATION_TO_OPERATION[orientation] || "identity";
}

export function composeJpegTransform(userOperation, exifOrientation = 1) {
  const user = MATRICES[userOperation] || MATRICES.identity;
  const orientation = MATRICES[operationForExifOrientation(exifOrientation)];
  const composed = multiply(user, orientation);
  for (const [name, matrix] of Object.entries(MATRICES)) {
    if (sameMatrix(composed, matrix)) return name;
  }
  throw new Error("JPEG transform composition failed");
}

export function jpegtranArgumentsForOperation(operation) {
  switch (operation) {
    case "identity": return [];
    case "rotate90": return ["-rotate", "90"];
    case "rotate180": return ["-rotate", "180"];
    case "rotate270": return ["-rotate", "270"];
    case "flipH": return ["-flip", "horizontal"];
    case "flipV": return ["-flip", "vertical"];
    case "transpose": return ["-transpose"];
    case "transverse": return ["-transverse"];
    default: throw new Error(`Unknown JPEG transform: ${operation}`);
  }
}
