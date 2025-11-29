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
    hue: 0,
    vignette: 0,
    sepia: 0,
    grayscale: 0
  };
}

/**
 * Apply adjustments to a canvas context using filters and pixel manipulation
 */
export function applyAdjustments(
  ctx: CanvasRenderingContext2D,
  adjustments: AdjustmentsState
): void {
  // Build CSS filter string for adjustments that can be handled by ctx.filter
  const filters: string[] = [];

  // Brightness: -100 to +100 -> 0.5 to 1.5 (1 = no change)
  if (adjustments.brightness !== 0) {
    const brightnessValue = 1 + (adjustments.brightness / 200);
    filters.push(`brightness(${brightnessValue})`);
  }

  // Contrast: -100 to +100 -> 0.5 to 1.5 (1 = no change)
  if (adjustments.contrast !== 0) {
    const contrastValue = 1 + (adjustments.contrast / 200);
    filters.push(`contrast(${contrastValue})`);
  }

  // Saturation: -100 to +100 -> 0 to 2 (1 = no change)
  if (adjustments.saturation !== 0) {
    const saturationValue = 1 + (adjustments.saturation / 100);
    filters.push(`saturate(${saturationValue})`);
  }

  // Hue: -180 to +180 degrees
  if (adjustments.hue !== 0) {
    filters.push(`hue-rotate(${adjustments.hue}deg)`);
  }

  // Sepia: 0 to 100 -> 0% to 100%
  if (adjustments.sepia !== 0) {
    filters.push(`sepia(${adjustments.sepia}%)`);
  }

  // Grayscale: 0 to 100 -> 0% to 100%
  if (adjustments.grayscale !== 0) {
    filters.push(`grayscale(${adjustments.grayscale}%)`);
  }

  // Apply CSS filters if any
  if (filters.length > 0) {
    ctx.filter = filters.join(' ');
  } else {
    ctx.filter = 'none';
  }
}

/**
 * Apply pixel-level adjustments (exposure, highlights, shadows, vignette)
 * These require direct pixel manipulation and should be applied after drawing
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
