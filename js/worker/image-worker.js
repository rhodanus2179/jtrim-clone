import { nearestNeighborResize, resizeImageData } from "../engine/resample.js";
import {
  brightnessContrastImageData, gaussianBlurImageData,
  gammaImageData, rgbAdjustImageData, hsvAdjustImageData,
  sharpenImageData, mosaicImageData,
  posterizeImageData, solarizeImageData, thresholdImageData,
  embossImageData, edgeEnhanceImageData,
  histogramData, normalizeImageData, equalizeImageData,
  edgeExtractImageData, noiseImageData, diffuseImageData,
  glassImageData, pencilImageData, floodFillImageData
} from "../engine/pixel.js";

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
      case "gamma":
        result = gammaImageData(source, params.gamma, params.selection);
        break;
      case "rgbAdjust":
        result = rgbAdjustImageData(source, params.red, params.green, params.blue, params.selection);
        break;
      case "hsvAdjust":
        result = hsvAdjustImageData(source, params.hue, params.saturation, params.value, params.selection);
        break;
      case "sharpen":
        result = sharpenImageData(source, params.level, params.selection);
        break;
      case "mosaic":
        result = mosaicImageData(source, params.blockSize, params.selection);
        break;
      case "posterize":
        result = posterizeImageData(source, params.levels, params.selection);
        break;
      case "solarize":
        result = solarizeImageData(source, params.threshold, params.selection);
        break;
      case "threshold":
        result = thresholdImageData(source, params.threshold, params.selection);
        break;
      case "emboss":
        result = embossImageData(source, params.level, params.selection, params.color);
        break;
      case "edgeEnhance":
        result = edgeEnhanceImageData(source, params.level, params.selection);
        break;
      case "normalize":
        result = normalizeImageData(source, params.selection);
        break;
      case "equalize":
        result = equalizeImageData(source, params.selection);
        break;
      case "edgeExtract":
        result = edgeExtractImageData(source, params.level, params.selection);
        break;
      case "noise":
        result = noiseImageData(source, params.amount, params.color, params.selection);
        break;
      case "diffuse":
        result = diffuseImageData(source, params.radius, params.selection);
        break;
      case "glass":
        result = glassImageData(source, params.size, params.direction, params.selection);
        break;
      case "pencil":
        result = pencilImageData(source, params.selection);
        break;
      case "floodFill":
        result = floodFillImageData(source, params.x, params.y, params.color, params.tolerance, params.opacity);
        break;
      case "histogram": {
        const histogram = histogramData(source, params.selection);
        self.postMessage({ id, resultType: "histogram", payload: histogram });
        return;
      }
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
