import { nearestNeighborResize, resizeImageData } from "../engine/resample.js";
import { brightnessContrastImageData, gaussianBlurImageData } from "../engine/pixel.js";

self.onmessage = event => {
  const { id, operation, width, height, buffer, params = {} } = event.data;
  try {
    const source = new ImageData(new Uint8ClampedArray(buffer), width, height);
    let result;

    switch (operation) {
      case "resize":
        result = params.resample === false
          ? nearestNeighborResize(source, params.width, params.height)
          : resizeImageData(source, params.width, params.height, params.method);
        break;
      case "brightnessContrast":
        result = brightnessContrastImageData(source, params.brightness, params.contrast, params.selection);
        break;
      case "gaussianBlur":
        result = gaussianBlurImageData(source, params.level, params.selection);
        break;
      default:
        throw new Error(`Unknown image operation: ${operation}`);
    }

    self.postMessage({
      id,
      width: result.width,
      height: result.height,
      buffer: result.data.buffer
    }, [result.data.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
