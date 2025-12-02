import type { AdjustmentsState, Viewport, CropArea } from '../types';

/**
 * Create default adjustments state (all values at 0 = no adjustment)
 */
export function createDefaultAdjustments(): AdjustmentsState {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    brightness: 0,
    saturation: 0,
    temperature: 0,
    vignette: 0,
    sepia: 0,
    grayscale: 0,
    blur: 0,
    grain: 0
  };
}

/**
 * RGB to HSL color space conversion
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return [h * 360, s * 100, l * 100];
}

/**
 * HSL to RGB color space conversion
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;

  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [r * 255, g * 255, b * 255];
}

/**
 * Apply adjustments to a canvas context
 * NOTE: For Safari compatibility, we don't use ctx.filter anymore.
 * All adjustments are now applied via pixel manipulation in applyAllAdjustments.
 */
export function applyAdjustments(
  ctx: CanvasRenderingContext2D,
  adjustments: AdjustmentsState
): void {
  // No-op: All adjustments are now handled via pixel manipulation
  // This function is kept for backwards compatibility
}

/**
 * Apply ALL adjustments via pixel manipulation
 * Uses WebGPU acceleration when available, falls back to CPU otherwise
 * This works in all browsers including Safari (no ctx.filter needed)
 */
export async function applyAllAdjustments(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport,
  adjustments: AdjustmentsState,
  cropArea?: CropArea | null
): Promise<void> {
  // Skip if no adjustments needed
  if (
    adjustments.exposure === 0 &&
    adjustments.contrast === 0 &&
    adjustments.highlights === 0 &&
    adjustments.shadows === 0 &&
    adjustments.brightness === 0 &&
    adjustments.saturation === 0 &&
    adjustments.temperature === 0 &&
    adjustments.vignette === 0 &&
    adjustments.sepia === 0 &&
    adjustments.grayscale === 0 &&
    adjustments.blur === 0 &&
    adjustments.grain === 0
  ) {
    return;
  }

  // Calculate image dimensions for GPU
  const imgWidth = cropArea ? cropArea.width : img.width;
  const imgHeight = cropArea ? cropArea.height : img.height;
  const totalScale = viewport.scale * viewport.zoom;
  const scaledImageWidth = imgWidth * totalScale;
  const scaledImageHeight = imgHeight * totalScale;

  // NOTE: WebGPU compute shader approach is disabled because Canvas.svelte uses 2D context
  // A canvas cannot have both 2D and WebGPU contexts simultaneously
  // Future: Implement WebGPU render pipeline in a separate canvas layer

  // Use CPU implementation
  applyAllAdjustmentsCPU(canvas, img, viewport, adjustments, cropArea);
}

/**
 * CPU-based implementation of adjustments (original implementation)
 * Used as fallback when WebGPU is unavailable
 */
function applyAllAdjustmentsCPU(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport,
  adjustments: AdjustmentsState,
  cropArea?: CropArea | null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('Failed to get 2D context!');
    return;
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Pre-calculate adjustment factors
  const hasExposure = adjustments.exposure !== 0;
  const hasContrast = adjustments.contrast !== 0;
  const hasHighlights = adjustments.highlights !== 0;
  const hasShadows = adjustments.shadows !== 0;
  const hasBrightness = adjustments.brightness !== 0;
  const hasSaturation = adjustments.saturation !== 0;
  const hasTemperature = adjustments.temperature !== 0;
  const hasVignette = adjustments.vignette !== 0;
  const hasSepia = adjustments.sepia !== 0;
  const hasGrayscale = adjustments.grayscale !== 0;
  const hasBlur = adjustments.blur > 0;
  const hasGrain = adjustments.grain > 0;

  const exposureFactor = hasExposure ? Math.pow(2, adjustments.exposure / 100) : 1;
  const contrastFactor = hasContrast ? 1 + (adjustments.contrast / 200) : 1;
  const brightnessFactor = hasBrightness ? 1 + (adjustments.brightness / 200) : 1;
  const highlightsFactor = adjustments.highlights / 100;
  const shadowsFactor = adjustments.shadows / 100;
  const saturationFactor = hasSaturation ? adjustments.saturation / 100 : 0;
  const temperatureFactor = adjustments.temperature / 100;
  const sepiaAmount = adjustments.sepia / 100;
  const grayscaleAmount = adjustments.grayscale / 100;
  const grainAmount = hasGrain ? adjustments.grain / 100 : 0;

  // Vignette pre-calculations
  const imgWidth = cropArea ? cropArea.width : img.width;
  const imgHeight = cropArea ? cropArea.height : img.height;
  const totalScale = viewport.scale * viewport.zoom;
  const imageCenterX = canvas.width / 2 + viewport.offsetX;
  const imageCenterY = canvas.height / 2 + viewport.offsetY;
  const scaledImageHalfWidth = (imgWidth * totalScale) / 2;
  const scaledImageHalfHeight = (imgHeight * totalScale) / 2;
  const maxDistanceSquared = scaledImageHalfWidth * scaledImageHalfWidth +
    scaledImageHalfHeight * scaledImageHalfHeight;
  const vignetteFactor = adjustments.vignette / 100;
  const vignetteStrength = 1.5;

  const needsLuminance = hasHighlights || hasShadows;
  const needsHSL = hasSaturation;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Apply brightness (multiply all channels)
    if (hasBrightness) {
      r *= brightnessFactor;
      g *= brightnessFactor;
      b *= brightnessFactor;
    }

    // Apply contrast (scale around midpoint)
    if (hasContrast) {
      r = ((r - 128) * contrastFactor) + 128;
      g = ((g - 128) * contrastFactor) + 128;
      b = ((b - 128) * contrastFactor) + 128;
    }

    // Calculate luminance if needed
    let luminance = 0;
    if (needsLuminance) {
      luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Apply exposure
    if (hasExposure) {
      r *= exposureFactor;
      g *= exposureFactor;
      b *= exposureFactor;
    }

    // Apply highlights adjustment
    if (hasHighlights) {
      const highlightMask = Math.pow(luminance / 255, 2);
      const highlightAdjust = highlightsFactor * highlightMask * 50;
      r += highlightAdjust;
      g += highlightAdjust;
      b += highlightAdjust;
    }

    // Apply shadows adjustment
    if (hasShadows) {
      const shadowMask = Math.pow(1 - luminance / 255, 2);
      const shadowAdjust = shadowsFactor * shadowMask * 50;
      r -= shadowAdjust;
      g -= shadowAdjust;
      b -= shadowAdjust;
    }

    // Apply saturation and hue via HSL
    if (needsHSL) {
      // Clamp before HSL conversion
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      let [h, s, l] = rgbToHsl(r, g, b);

      // Adjust saturation
      if (hasSaturation) {
        s = Math.max(0, Math.min(100, s * (1 + saturationFactor)));
      }

      // Adjust hue
      /* if (hasHue) {
        h = (h + hueShift + 360) % 360;
      } */

      [r, g, b] = hslToRgb(h, s, l);
    }

    // Apply temperature
    if (hasTemperature) {
      r = r + temperatureFactor * 0.1 * 255;
      b = b - temperatureFactor * 0.1 * 255;
    }

    // Apply sepia
    if (hasSepia) {
      const tr = (0.393 * r + 0.769 * g + 0.189 * b);
      const tg = (0.349 * r + 0.686 * g + 0.168 * b);
      const tb = (0.272 * r + 0.534 * g + 0.131 * b);
      r = r * (1 - sepiaAmount) + tr * sepiaAmount;
      g = g * (1 - sepiaAmount) + tg * sepiaAmount;
      b = b * (1 - sepiaAmount) + tb * sepiaAmount;
    }

    // Apply grayscale
    if (hasGrayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = r * (1 - grayscaleAmount) + gray * grayscaleAmount;
      g = g * (1 - grayscaleAmount) + gray * grayscaleAmount;
      b = b * (1 - grayscaleAmount) + gray * grayscaleAmount;
    }

    // Apply vignette
    if (hasVignette) {
      const pixelIndex = i / 4;
      const x = pixelIndex % canvas.width;
      const y = Math.floor(pixelIndex / canvas.width);

      const dx = x - imageCenterX;
      const dy = y - imageCenterY;
      const distanceSquared = dx * dx + dy * dy;
      const normalizedDistanceSquared = distanceSquared / maxDistanceSquared;
      const vignetteAmount = normalizedDistanceSquared;
      const vignetteMultiplier = 1 + (vignetteFactor * vignetteAmount * vignetteStrength);

      r *= vignetteMultiplier;
      g *= vignetteMultiplier;
      b *= vignetteMultiplier;
    }

    // Clamp values before grain processing
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  // Put adjusted image data back to canvas
  ctx.putImageData(imageData, 0, 0);

  // Apply Gaussian blur to entire image if blur adjustment is enabled
  if (hasBlur) {
    const blurAmount = adjustments.blur / 100;
    // Map blur 0-100 to radius 0-10 (blur tool scale)
    const blurRadius = blurAmount * 10.0 * totalScale;
    if (blurRadius > 0.1) {
      applyGaussianBlur(canvas, 0, 0, canvas.width, canvas.height, blurRadius);
    }
  }

  // Apply film grain - Applied after blur for sharp grain on top
  if (hasGrain) {
    // Get image data after blur has been applied
    const grainedData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gData = grainedData.data;

    // Helper function for hash
    const hash2d = (x: number, y: number) => {
      const p3x = (x * 0.1031) % 1;
      const p3y = (y * 0.1030) % 1;
      const p3z = (x * 0.0973) % 1;
      const dotP3 = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
      return ((p3x + p3y) * p3z + dotP3) % 1;
    };

    for (let i = 0; i < gData.length; i += 4) {
      let r = gData[i];
      let g = gData[i + 1];
      let b = gData[i + 2];

      const pixelIndex = i / 4;
      const canvasX = pixelIndex % canvas.width;
      const canvasY = Math.floor(pixelIndex / canvas.width);

      // Convert canvas coordinates to image coordinates
      const imageX = ((canvasX - imageCenterX) / totalScale + imgWidth / 2);
      const imageY = ((canvasY - imageCenterY) / totalScale + imgHeight / 2);

      // Calculate luminance for grain masking
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      // Grain visibility mask: most visible in midtones
      let lumaMask = 1.0 - Math.abs(luma - 0.5) * 2.0;
      lumaMask = Math.pow(lumaMask, 0.5); // Softer falloff

      // Multi-scale grain for organic film look
      const fineGrain = hash2d(Math.floor(imageX / 2.5), Math.floor(imageY / 2.5)) - 0.5;
      const mediumGrain = hash2d(Math.floor(imageX / 5.5) + 123.45, Math.floor(imageY / 5.5) + 678.90) - 0.5;
      const coarseGrain = hash2d(Math.floor(imageX / 9.0) + 345.67, Math.floor(imageY / 9.0) + 890.12) - 0.5;

      // Combine grain layers
      const grainNoise = fineGrain * 0.5 + mediumGrain * 0.3 + coarseGrain * 0.2;

      // Strong grain intensity
      const strength = lumaMask * grainAmount * 0.5 * 255;
      r += grainNoise * strength;
      g += grainNoise * strength;
      b += grainNoise * strength;

      gData[i] = Math.max(0, Math.min(255, r));
      gData[i + 1] = Math.max(0, Math.min(255, g));
      gData[i + 2] = Math.max(0, Math.min(255, b));
    }

    ctx.putImageData(grainedData, 0, 0);
  }
}

/**
 * Apply Gaussian blur to a region of canvas via pixel manipulation (Safari-compatible)
 * Uses optimized separable box blur with running sums for O(n) performance
 */
export function applyGaussianBlur(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  if (radius <= 0) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Clamp region to canvas bounds
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  width = Math.min(canvas.width - x, Math.ceil(width));
  height = Math.min(canvas.height - y, Math.ceil(height));

  if (width <= 0 || height <= 0) return;

  // Get the region to blur
  const imageData = ctx.getImageData(x, y, width, height);
  const pixels = imageData.data;

  // Increase blur strength by using larger radius and more passes
  const boxRadius = Math.max(1, Math.round(radius / 2)); // Changed from /3 to /2 for stronger blur
  const passes = 3;

  // Use two buffers to avoid allocation in loops
  const buffer1 = new Uint8ClampedArray(pixels);
  const buffer2 = new Uint8ClampedArray(pixels.length);

  let srcBuffer = buffer1;
  let dstBuffer = buffer2;

  for (let pass = 0; pass < passes; pass++) {
    // Horizontal pass - using running sum for O(n) performance
    boxBlurHorizontal(srcBuffer, dstBuffer, width, height, boxRadius);

    // Swap buffers
    [srcBuffer, dstBuffer] = [dstBuffer, srcBuffer];

    // Vertical pass - using running sum for O(n) performance
    boxBlurVertical(srcBuffer, dstBuffer, width, height, boxRadius);

    // Swap buffers
    [srcBuffer, dstBuffer] = [dstBuffer, srcBuffer];
  }

  // Copy result back
  pixels.set(srcBuffer);
  ctx.putImageData(imageData, x, y);
}

/**
 * Fast horizontal box blur using running sum (O(n) complexity)
 */
function boxBlurHorizontal(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): void {
  const iarr = 1 / (radius + radius + 1);

  for (let row = 0; row < height; row++) {
    const rowOffset = row * width * 4;
    let ti = rowOffset;
    let li = ti;
    let ri = ti + radius * 4;

    // First pixel in row
    const fv_r = src[ti];
    const fv_g = src[ti + 1];
    const fv_b = src[ti + 2];
    const fv_a = src[ti + 3];

    // Last pixel in row
    const lv_r = src[rowOffset + (width - 1) * 4];
    const lv_g = src[rowOffset + (width - 1) * 4 + 1];
    const lv_b = src[rowOffset + (width - 1) * 4 + 2];
    const lv_a = src[rowOffset + (width - 1) * 4 + 3];

    // Initial sum
    let val_r = (radius + 1) * fv_r;
    let val_g = (radius + 1) * fv_g;
    let val_b = (radius + 1) * fv_b;
    let val_a = (radius + 1) * fv_a;

    for (let j = 0; j < radius; j++) {
      const offset = rowOffset + j * 4;
      val_r += src[offset];
      val_g += src[offset + 1];
      val_b += src[offset + 2];
      val_a += src[offset + 3];
    }

    // Process pixels
    for (let col = 0; col <= radius; col++) {
      val_r += src[ri] - fv_r;
      val_g += src[ri + 1] - fv_g;
      val_b += src[ri + 2] - fv_b;
      val_a += src[ri + 3] - fv_a;
      ri += 4;

      dst[ti] = Math.round(val_r * iarr);
      dst[ti + 1] = Math.round(val_g * iarr);
      dst[ti + 2] = Math.round(val_b * iarr);
      dst[ti + 3] = Math.round(val_a * iarr);
      ti += 4;
    }

    for (let col = radius + 1; col < width - radius; col++) {
      val_r += src[ri] - src[li];
      val_g += src[ri + 1] - src[li + 1];
      val_b += src[ri + 2] - src[li + 2];
      val_a += src[ri + 3] - src[li + 3];
      ri += 4;
      li += 4;

      dst[ti] = Math.round(val_r * iarr);
      dst[ti + 1] = Math.round(val_g * iarr);
      dst[ti + 2] = Math.round(val_b * iarr);
      dst[ti + 3] = Math.round(val_a * iarr);
      ti += 4;
    }

    for (let col = width - radius; col < width; col++) {
      val_r += lv_r - src[li];
      val_g += lv_g - src[li + 1];
      val_b += lv_b - src[li + 2];
      val_a += lv_a - src[li + 3];
      li += 4;

      dst[ti] = Math.round(val_r * iarr);
      dst[ti + 1] = Math.round(val_g * iarr);
      dst[ti + 2] = Math.round(val_b * iarr);
      dst[ti + 3] = Math.round(val_a * iarr);
      ti += 4;
    }
  }
}

/**
 * Fast vertical box blur using running sum (O(n) complexity)
 */
function boxBlurVertical(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): void {
  const iarr = 1 / (radius + radius + 1);

  for (let col = 0; col < width; col++) {
    const colOffset = col * 4;
    let ti = colOffset;
    let li = ti;
    let ri = ti + radius * width * 4;

    // First pixel in column
    const fv_r = src[ti];
    const fv_g = src[ti + 1];
    const fv_b = src[ti + 2];
    const fv_a = src[ti + 3];

    // Last pixel in column
    const lv_r = src[colOffset + (height - 1) * width * 4];
    const lv_g = src[colOffset + (height - 1) * width * 4 + 1];
    const lv_b = src[colOffset + (height - 1) * width * 4 + 2];
    const lv_a = src[colOffset + (height - 1) * width * 4 + 3];

    // Initial sum
    let val_r = (radius + 1) * fv_r;
    let val_g = (radius + 1) * fv_g;
    let val_b = (radius + 1) * fv_b;
    let val_a = (radius + 1) * fv_a;

    for (let j = 0; j < radius; j++) {
      const offset = colOffset + j * width * 4;
      val_r += src[offset];
      val_g += src[offset + 1];
      val_b += src[offset + 2];
      val_a += src[offset + 3];
    }

    // Process pixels
    for (let row = 0; row <= radius; row++) {
      val_r += src[ri] - fv_r;
      val_g += src[ri + 1] - fv_g;
      val_b += src[ri + 2] - fv_b;
      val_a += src[ri + 3] - fv_a;
      ri += width * 4;

      dst[ti] = Math.round(val_r * iarr);
      dst[ti + 1] = Math.round(val_g * iarr);
      dst[ti + 2] = Math.round(val_b * iarr);
      dst[ti + 3] = Math.round(val_a * iarr);
      ti += width * 4;
    }

    for (let row = radius + 1; row < height - radius; row++) {
      val_r += src[ri] - src[li];
      val_g += src[ri + 1] - src[li + 1];
      val_b += src[ri + 2] - src[li + 2];
      val_a += src[ri + 3] - src[li + 3];
      ri += width * 4;
      li += width * 4;

      dst[ti] = Math.round(val_r * iarr);
      dst[ti + 1] = Math.round(val_g * iarr);
      dst[ti + 2] = Math.round(val_b * iarr);
      dst[ti + 3] = Math.round(val_a * iarr);
      ti += width * 4;
    }

    for (let row = height - radius; row < height; row++) {
      val_r += lv_r - src[li];
      val_g += lv_g - src[li + 1];
      val_b += lv_b - src[li + 2];
      val_a += lv_a - src[li + 3];
      li += width * 4;

      dst[ti] = Math.round(val_r * iarr);
      dst[ti + 1] = Math.round(val_g * iarr);
      dst[ti + 2] = Math.round(val_b * iarr);
      dst[ti + 3] = Math.round(val_a * iarr);
      ti += width * 4;
    }
  }
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use applyAllAdjustments instead
 */
export function applyPixelAdjustments(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport,
  adjustments: AdjustmentsState,
  cropArea?: CropArea | null
): void {
  // Skip if no pixel adjustments needed
  if (
    adjustments.exposure === 0 &&
    adjustments.highlights === 0 &&
    adjustments.shadows === 0 &&
    adjustments.vignette === 0
  ) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Pre-calculate adjustment factors
  const hasExposure = adjustments.exposure !== 0;
  const hasHighlights = adjustments.highlights !== 0;
  const hasShadows = adjustments.shadows !== 0;
  const hasVignette = adjustments.vignette !== 0;

  const exposureFactor = hasExposure ? Math.pow(2, adjustments.exposure / 100) : 1;
  const highlightsFactor = adjustments.highlights / 100;
  const shadowsFactor = adjustments.shadows / 100;

  // Vignette pre-calculations (based on image dimensions, not canvas)
  const imgWidth = cropArea ? cropArea.width : img.width;
  const imgHeight = cropArea ? cropArea.height : img.height;
  const totalScale = viewport.scale * viewport.zoom;

  // Image center on canvas (accounting for viewport offset)
  const imageCenterX = canvas.width / 2 + viewport.offsetX;
  const imageCenterY = canvas.height / 2 + viewport.offsetY;

  // Max distance based on scaled image dimensions
  const scaledImageHalfWidth = (imgWidth * totalScale) / 2;
  const scaledImageHalfHeight = (imgHeight * totalScale) / 2;
  const maxDistanceSquared = scaledImageHalfWidth * scaledImageHalfWidth +
    scaledImageHalfHeight * scaledImageHalfHeight;

  const vignetteFactor = adjustments.vignette / 100;
  const vignetteStrength = 1.5;

  const needsLuminance = hasHighlights || hasShadows;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Calculate luminance only if needed for highlights/shadows
    let luminance = 0;
    if (needsLuminance) {
      luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Apply exposure (multiply all channels)
    if (hasExposure) {
      r *= exposureFactor;
      g *= exposureFactor;
      b *= exposureFactor;
    }

    // Apply highlights adjustment (affect bright pixels more)
    if (hasHighlights) {
      const highlightMask = Math.pow(luminance / 255, 2);
      const highlightAdjust = highlightsFactor * highlightMask * 50;
      r += highlightAdjust;
      g += highlightAdjust;
      b += highlightAdjust;
    }

    // Apply shadows adjustment (affect dark pixels more)
    if (hasShadows) {
      const shadowMask = Math.pow(1 - luminance / 255, 2);
      const shadowAdjust = shadowsFactor * shadowMask * 50;
      r -= shadowAdjust;
      g -= shadowAdjust;
      b -= shadowAdjust;
    }

    // Apply vignette (darken or brighten edges based on distance from image center)
    if (hasVignette) {
      const pixelIndex = i / 4;
      const x = pixelIndex % canvas.width;
      const y = Math.floor(pixelIndex / canvas.width);

      // Calculate distance from image center (not canvas center)
      const dx = x - imageCenterX;
      const dy = y - imageCenterY;
      const distanceSquared = dx * dx + dy * dy;
      const normalizedDistanceSquared = distanceSquared / maxDistanceSquared;

      // Use smooth falloff curve - already squared, so power of 2 total
      const vignetteAmount = normalizedDistanceSquared;

      // Negative vignette = darken edges, Positive = brighten edges
      const vignetteMultiplier = 1 + (vignetteFactor * vignetteAmount * vignetteStrength);

      r *= vignetteMultiplier;
      g *= vignetteMultiplier;
      b *= vignetteMultiplier;
    }

    // Clamp values to 0-255
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  ctx.putImageData(imageData, 0, 0);
}
