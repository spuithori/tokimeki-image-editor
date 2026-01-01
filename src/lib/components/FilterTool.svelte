<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { AdjustmentsState, CropArea, TransformState, Viewport } from '../types';
  import { FILTER_PRESETS, applyFilterPreset, matchesFilterPreset } from '../utils/filters';
  import { applyGaussianBlur } from '../utils/adjustments';
  import ToolPanel from './ToolPanel.svelte';

  interface Props {
    image: HTMLImageElement | null;
    adjustments: AdjustmentsState;
    transform: TransformState;
    cropArea?: CropArea | null;
    onChange: (adjustments: AdjustmentsState) => void;
    onClose: () => void;
  }

  let { image, adjustments, transform, cropArea, onChange, onClose }: Props = $props();

  // Find currently selected filter (if any)
  let selectedFilterId = $derived(
    FILTER_PRESETS.find(preset => matchesFilterPreset(adjustments, preset))?.id || null
  );

  // Generate preview thumbnails for filters
  const PREVIEW_SIZE = 240;
  let filterPreviews = $state<Map<string, string>>(new Map());
  let baseThumbDataUrl: string | null = null;
  let isGenerating = $state(false);

  // Create a tiny thumbnail directly from original image (no transforms)
  function createSimpleThumb(): string | null {
    if (!image) return null;

    try {
      const canvas = document.createElement('canvas');
      const size = PREVIEW_SIZE;

      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // Calculate crop to center square
      const minDim = Math.min(image.width, image.height);
      const sx = (image.width - minDim) / 2;
      const sy = (image.height - minDim) / 2;

      // Draw center square of original image
      ctx.drawImage(
        image,
        sx, sy, minDim, minDim,
        0, 0, size, size
      );

      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (error) {
      console.error('Failed to create thumbnail:', error);
      return null;
    }
  }

  // Apply adjustments to canvas via pixel manipulation (Safari-compatible)
  // Must match the shader order and calculations EXACTLY
  function applyAdjustmentsToCanvas(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    adjustments: AdjustmentsState,
    sourceImageSize: { width: number; height: number }
  ) {
    // Skip if no adjustments needed
    if (
      adjustments.brightness === 0 &&
      adjustments.contrast === 0 &&
      adjustments.exposure === 0 &&
      adjustments.highlights === 0 &&
      adjustments.shadows === 0 &&
      adjustments.saturation === 0 &&
      adjustments.temperature === 0 &&
      adjustments.sepia === 0 &&
      adjustments.grayscale === 0 &&
      adjustments.vignette === 0 &&
      adjustments.blur === 0 &&
      adjustments.grain === 0
    ) {
      return;
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Pre-calculate adjustment factors
    const hasBrightness = adjustments.brightness !== 0;
    const hasContrast = adjustments.contrast !== 0;
    const hasExposure = adjustments.exposure !== 0;
    const hasShadows = adjustments.shadows !== 0;
    const hasHighlights = adjustments.highlights !== 0;
    const hasSaturation = adjustments.saturation !== 0;
    const hasTemperature = adjustments.temperature !== 0;
    const hasSepia = adjustments.sepia !== 0;
    const hasGrayscale = adjustments.grayscale !== 0;
    const hasVignette = adjustments.vignette !== 0;
    const hasBlur = adjustments.blur > 0;
    const hasGrain = adjustments.grain > 0;

    const brightnessFactor = hasBrightness ? 1 + (adjustments.brightness / 200) : 1;
    const contrastFactor = hasContrast ? 1 + (adjustments.contrast / 200) : 1;
    const exposureFactor = hasExposure ? Math.pow(2, adjustments.exposure / 100) : 1;
    const saturationFactor = hasSaturation ? adjustments.saturation / 100 : 0;
    const temperatureAmount = hasTemperature ? adjustments.temperature / 100 : 0;
    const sepiaAmount = adjustments.sepia / 100;
    const grayscaleAmount = adjustments.grayscale / 100;
    const vignetteFactor = hasVignette ? adjustments.vignette / 100 : 0;
    const grainAmount = hasGrain ? adjustments.grain / 100 : 0;

    // Canvas dimensions for vignette
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    for (let i = 0; i < data.length; i += 4) {
      // Normalize to 0-1 range (match shader)
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      // 1. Brightness (FIRST, like shader)
      if (hasBrightness) {
        r *= brightnessFactor;
        g *= brightnessFactor;
        b *= brightnessFactor;
      }

      // 2. Contrast (use 0.5 center for 0-1 range)
      if (hasContrast) {
        r = (r - 0.5) * contrastFactor + 0.5;
        g = (g - 0.5) * contrastFactor + 0.5;
        b = (b - 0.5) * contrastFactor + 0.5;
      }

      // 3. Exposure
      if (hasExposure) {
        r *= exposureFactor;
        g *= exposureFactor;
        b *= exposureFactor;
      }

      // 4. Shadows and Highlights
      if (hasShadows || hasHighlights) {
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        if (hasShadows) {
          const shadowMask = Math.pow(1.0 - luma, 2.0);
          r = r - r * (adjustments.shadows / 100) * shadowMask * 0.5;
          g = g - g * (adjustments.shadows / 100) * shadowMask * 0.5;
          b = b - b * (adjustments.shadows / 100) * shadowMask * 0.5;
        }

        if (hasHighlights) {
          const highlightMask = Math.pow(luma, 2.0);
          r = r + r * (adjustments.highlights / 100) * highlightMask * 0.5;
          g = g + g * (adjustments.highlights / 100) * highlightMask * 0.5;
          b = b + b * (adjustments.highlights / 100) * highlightMask * 0.5;
        }
      }

      // 5. Saturation (via HSL)
      if (hasSaturation) {
        // Clamp before HSL conversion
        r = Math.max(0, Math.min(1, r));
        g = Math.max(0, Math.min(1, g));
        b = Math.max(0, Math.min(1, b));

        const [h, s, l] = rgbToHsl(r * 255, g * 255, b * 255);
        const newS = Math.max(0, Math.min(100, s * (1 + saturationFactor)));
        [r, g, b] = hslToRgb(h, newS, l);
        // Result is 0-255, normalize back to 0-1
        r /= 255;
        g /= 255;
        b /= 255;
      }

      // 5.5. Color Temperature
      if (hasTemperature) {
        r = r + temperatureAmount * 0.1;
        b = b - temperatureAmount * 0.1;
      }

      // 6. Sepia
      if (hasSepia) {
        const tr = 0.393 * r + 0.769 * g + 0.189 * b;
        const tg = 0.349 * r + 0.686 * g + 0.168 * b;
        const tb = 0.272 * r + 0.534 * g + 0.131 * b;
        r = r * (1 - sepiaAmount) + tr * sepiaAmount;
        g = g * (1 - sepiaAmount) + tg * sepiaAmount;
        b = b * (1 - sepiaAmount) + tb * sepiaAmount;
      }

      // 7. Grayscale
      if (hasGrayscale) {
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = r * (1 - grayscaleAmount) + gray * grayscaleAmount;
        g = g * (1 - grayscaleAmount) + gray * grayscaleAmount;
        b = b * (1 - grayscaleAmount) + gray * grayscaleAmount;
      }

      // 8. Vignette
      if (hasVignette) {
        // Calculate pixel position from index
        const pixelIndex = i / 4;
        const x = (pixelIndex % canvas.width) / canvas.width;
        const y = Math.floor(pixelIndex / canvas.width) / canvas.height;
        const dx = x - 0.5;
        const dy = y - 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const vignetteAmount = Math.pow(dist * 1.4, 2.0);
        r = r * (1.0 + vignetteFactor * vignetteAmount * 1.5);
        g = g * (1.0 + vignetteFactor * vignetteAmount * 1.5);
        b = b * (1.0 + vignetteFactor * vignetteAmount * 1.5);
      }

      // Clamp values before grain processing
      data[i] = Math.max(0, Math.min(255, r * 255));
      data[i + 1] = Math.max(0, Math.min(255, g * 255));
      data[i + 2] = Math.max(0, Math.min(255, b * 255));
    }

    // Put adjusted image data back to canvas
    ctx.putImageData(imageData, 0, 0);

    // 8.5. Apply Gaussian blur to entire image if blur adjustment is enabled
    if (hasBlur) {
      const blurAmount = adjustments.blur / 100;
      // Map blur 0-100 to radius 0-10
      const blurRadius = blurAmount * 10.0;
      if (blurRadius > 0.1) {
        applyGaussianBlur(canvas, 0, 0, canvas.width, canvas.height, blurRadius);
      }
    }

    // 9. Film Grain - Applied after blur for sharp grain on top
    if (hasGrain) {
      // Get image data after blur has been applied
      const grainedData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const gData = grainedData.data;

      // Map canvas pixel to source image coordinates
      // The preview shows a center-cropped square of the original image
      const minDim = Math.min(sourceImageSize.width, sourceImageSize.height);
      const sx = (sourceImageSize.width - minDim) / 2;
      const sy = (sourceImageSize.height - minDim) / 2;

      // Helper function for hash
      const hash2d = (x: number, y: number) => {
        const p3x = (x * 0.1031) % 1;
        const p3y = (y * 0.1030) % 1;
        const p3z = (x * 0.0973) % 1;
        const dotP3 = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
        return ((p3x + p3y) * p3z + dotP3) % 1;
      };

      for (let i = 0; i < gData.length; i += 4) {
        let r = gData[i] / 255;
        let g = gData[i + 1] / 255;
        let b = gData[i + 2] / 255;

        const pixelIndex = i / 4;
        const canvasX = pixelIndex % canvas.width;
        const canvasY = Math.floor(pixelIndex / canvas.width);

        // Calculate corresponding position in source image
        const imageX = sx + (canvasX / canvas.width) * minDim;
        const imageY = sy + (canvasY / canvas.height) * minDim;

        // Calculate luminance for grain masking
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

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
        const strength = lumaMask * grainAmount * 0.5;
        r += grainNoise * strength;
        g += grainNoise * strength;
        b += grainNoise * strength;

        gData[i] = Math.max(0, Math.min(255, r * 255));
        gData[i + 1] = Math.max(0, Math.min(255, g * 255));
        gData[i + 2] = Math.max(0, Math.min(255, b * 255));
      }

      ctx.putImageData(grainedData, 0, 0);
    }
  }

  // RGB to HSL conversion
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

  // HSL to RGB conversion
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

  // Generate previews asynchronously
  async function generateFilterPreviews() {
    if (!image || isGenerating) return;

    isGenerating = true;
    filterPreviews.clear();

    // Create base thumbnail once
    baseThumbDataUrl = createSimpleThumb();
    if (!baseThumbDataUrl) {
      isGenerating = false;
      return;
    }

    // Load base image
    const baseImg = new Image();
    baseImg.src = baseThumbDataUrl;

    await new Promise((resolve) => {
      baseImg.onload = resolve;
      baseImg.onerror = resolve;
    });

    // Generate each preview with delays
    for (let i = 0; i < FILTER_PRESETS.length; i++) {
      // Yield to browser
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 10)));

      const preset = FILTER_PRESETS[i];
      const presetAdjustments = applyFilterPreset(preset);

      try {
        const canvas = document.createElement('canvas');
        canvas.width = PREVIEW_SIZE;
        canvas.height = PREVIEW_SIZE;
        const ctx = canvas.getContext('2d');

        if (ctx && image) {
          // Draw base image first
          ctx.drawImage(baseImg, 0, 0);

          // Apply filters via pixel manipulation (Safari-compatible)
          applyAdjustmentsToCanvas(ctx, canvas, presetAdjustments, {
            width: image.width,
            height: image.height
          });

          filterPreviews.set(preset.id, canvas.toDataURL('image/jpeg', 0.7));
          filterPreviews = new Map(filterPreviews);
        }
      } catch (error) {
        console.error(`Failed to generate preview for ${preset.id}:`, error);
      }
    }

    isGenerating = false;
  }

  generateFilterPreviews();

  function handleFilterSelect(filterId: string) {
    const preset = FILTER_PRESETS.find(p => p.id === filterId);
    if (preset) {
      const newAdjustments = applyFilterPreset(preset);
      onChange(newAdjustments);
    }
  }

  // Prevent wheel events from propagating to canvas zoom handler
  function handleWheel(e: WheelEvent) {
    e.stopPropagation();
  }
</script>

<div class="filter-tool" onwheel={handleWheel}>
  <ToolPanel title={$_('editor.filter')} {onClose}>
    {#snippet children()}
      <div class="filter-info">
        <p class="info-text">{$_('filters.info')}</p>
      </div>

      {#if isGenerating && filterPreviews.size === 0}
        <div class="loading-message">
          <p>Generating previews...</p>
        </div>
      {/if}

      <div class="filter-grid">
        {#each FILTER_PRESETS as preset}
          <button
            class="filter-card"
            class:active={selectedFilterId === preset.id}
            onclick={() => handleFilterSelect(preset.id)}
          >
            <div class="filter-preview">
              {#if filterPreviews.has(preset.id)}
                <img
                  src={filterPreviews.get(preset.id)}
                  alt={$_(preset.id === 'none' ? 'editor.none' : `filters.${preset.id}`)}
                  class="preview-image"
                />
                <div class="filter-name-overlay">
                  {$_(preset.id === 'none' ? 'editor.none' : `filters.${preset.id}`)}
                </div>
              {:else}
                <div class="filter-name-loading">
                  {$_(preset.id === 'none' ? 'editor.none' : `filters.${preset.id}`)}
                  {#if isGenerating}
                    <div class="loading-spinner"></div>
                  {/if}
                </div>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/snippet}
  </ToolPanel>
</div>

<style lang="postcss">
  .filter-grid {
    display: grid;
    grid-template-columns: repeat(2, 120px);
    gap: 1rem;
    padding-bottom: 1rem;

    @media (max-width: 767px) {
      grid-template-columns: repeat(3, 1fr);
      gap: 0.5rem;
    }
  }

  .filter-card {
    display: flex;
    flex-direction: column;
    padding: 0;
    background: #333;
    border: 2px solid #444;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    overflow: hidden;
    flex: 0 0 auto;

    @media (max-width: 767px) {
      border-width: 1px;
    }
  }

  .filter-card:hover {
    border-color: #555;
  }

  .filter-card.active {
    border-color: #0066cc;
  }

  .filter-preview {
    position: relative;
    width: 120px;
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    @media (max-width: 767px) {
      width: 100%;
      height: 0;
      padding-bottom: 100%;
    }
  }

  .preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;

    @media (max-width: 767px) {
      position: absolute;
      top: 0;
      left: 0;
    }
  }

  .filter-name-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: #fff;
    text-align: center;
    padding: 1rem;

    @media (max-width: 767px) {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 0.5rem;
      font-size: 0.75rem;
    }
  }

  .filter-name-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.6) 50%, transparent 100%);
    color: #fff;
    padding: 0.5rem 0.25rem 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-align: center;
    pointer-events: none;

    @media (max-width: 767px) {
      font-size: 0.65rem;
      padding: 0.3rem 0.2rem 0.2rem;
    }
  }

  .loading-message {
    text-align: center;
    padding: 1rem;
    color: #999;
    font-size: 0.9rem;
  }

  .loading-message p {
    margin: 0;
  }

  .loading-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #444;
    border-top-color: #0066cc;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .filter-info {
    padding: 0.75rem;
    background: rgba(0, 102, 204, 0.1);
    border-left: 3px solid var(--primary-color, #63b97b);
    border-radius: 4px;
  }

  .info-text {
    margin: 0;
    font-size: 0.85rem;
    color: #ccc;
  }
</style>
