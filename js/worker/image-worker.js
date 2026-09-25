import { nearestNeighborResize, resizeImageData } from "../engine/resample.js";
import {
  brightnessContrastImageData, gaussianBlurImageData,
  gammaImageData, rgbAdjustImageData, hsvAdjustImageData,
  sharpenImageData, mosaicImageData,
  posterizeImageData, solarizeImageData, thresholdImageData,
  embossImageData, edgeEnhanceImageData,
  histogramData, normalizeImageData, equalizeImageData,
  edgeExtractImageData, noiseImageData, diffuseImageData,
  glassImageData, pencilImageData, floodFillImageData,
  waveImageData, blockImageData, fadeImageData, oilPaintImageData,
  swirlImageData, radialWarpImageData, spotlightImageData,
  blindsImageData, supernovaImageData, rippleImageData,
  newspaperImageData, customFilterImageData,
  softenImageData, softLensImageData, motionBlurImageData,
  bevelImageData, silkScreenImageData,
  colorScaleImageData, rgbExchangeImageData, xorColorImageData,
  gradientImageData, shadowHighlightImageData, transparentColorImageData,
  usedColorCount, colorDepthImageData,
  redEyeImageData, denoiseImageData, densityExtractImageData
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
      case "wave":
        result = waveImageData(source, params.amplitude, params.wavelength, params.direction, params.selection);
        break;
      case "block":
        result = blockImageData(source, params.size, params.stagger, params.border, params.selection);
        break;
      case "fade":
        result = fadeImageData(source, params.strength, params.shape, params.color, params.selection);
        break;
      case "oilPaint":
        result = oilPaintImageData(source, params.radius, params.levels, params.selection);
        break;
      case "swirl":
        result = swirlImageData(source, params.degrees, params.selection);
        break;
      case "radialWarp":
        result = radialWarpImageData(source, params.strength, params.selection);
        break;
      case "spotlight":
        result = spotlightImageData(source, params.centerX, params.centerY, params.radius, params.strength, params.selection);
        break;
      case "blinds":
        result = blindsImageData(source, params.width, params.color, params.opacity, params.direction, params.selection);
        break;
      case "supernova":
        result = supernovaImageData(source, params.centerX, params.centerY, params.radius, params.rays, params.color, params.randomHue, params.selection);
        break;
      case "ripple":
        result = rippleImageData(source, params.amplitude, params.wavelength, params.selection);
        break;
      case "newspaper":
        result = newspaperImageData(source, params.cellSize, params.selection);
        break;
      case "customFilter":
        result = customFilterImageData(source, params.kernel, params.divisor, params.offset, params.selection);
        break;
      case "soften":
        result = softenImageData(source, params.selection);
        break;
      case "softLens":
        result = softLensImageData(source, params.strength, params.selection);
        break;
      case "motionBlur":
        result = motionBlurImageData(source, params.distance, params.angle, params.selection);
        break;
      case "bevel":
        result = bevelImageData(source, params.width, params.inset, params.selection);
        break;
      case "silkScreen":
        result = silkScreenImageData(source, params.cellSize, params.angle, params.selection);
        break;
      case "colorScale":
        result = colorScaleImageData(source, params.color, params.selection);
        break;
      case "rgbExchange":
        result = rgbExchangeImageData(source, params.selection);
        break;
      case "xorColor":
        result = xorColorImageData(source, params.selection);
        break;
      case "gradient":
        result = gradientImageData(source, params.startColor, params.endColor, params.direction, params.opacity, params.selection);
        break;
      case "shadowHighlight":
        result = shadowHighlightImageData(source, params.shadows, params.highlights, params.selection);
        break;
      case "transparentColor":
        result = transparentColorImageData(source, params.color, params.tolerance);
        break;
      case "colorDepth":
        result = colorDepthImageData(source, params.mode, params.dither);
        break;
      case "redEye":
        result = redEyeImageData(source, params.selection, params.strength);
        break;
      case "denoise":
        result = denoiseImageData(source, params.level, params.selection);
        break;
      case "densityExtract":
        result = densityExtractImageData(source, params.mode, params.selection);
        break;
      case "usedColorCount": {
        const count = usedColorCount(source);
        self.postMessage({ id, resultType: "scalar", payload: count });
        return;
      }
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
