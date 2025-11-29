<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { AdjustmentsState, CropArea, TransformState, Viewport } from '../types';
  import { FILTER_PRESETS, applyFilterPreset, matchesFilterPreset } from '../utils/filters';
  import { X } from 'lucide-svelte';

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
  function applyAdjustmentsToCanvas(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    adjustments: AdjustmentsState
  ) {
    // Skip if no adjustments needed
    if (
      adjustments.exposure === 0 &&
      adjustments.contrast === 0 &&
      adjustments.highlights === 0 &&
      adjustments.shadows === 0 &&
      adjustments.brightness === 0 &&
      adjustments.saturation === 0 &&
      adjustments.hue === 0 &&
      adjustments.vignette === 0 &&
      adjustments.sepia === 0 &&
      adjustments.grayscale === 0
    ) {
      return;
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Pre-calculate adjustment factors
    const hasExposure = adjustments.exposure !== 0;
    const hasContrast = adjustments.contrast !== 0;
    const hasBrightness = adjustments.brightness !== 0;
    const hasSaturation = adjustments.saturation !== 0;
    const hasHue = adjustments.hue !== 0;
    const hasSepia = adjustments.sepia !== 0;
    const hasGrayscale = adjustments.grayscale !== 0;

    const exposureFactor = hasExposure ? Math.pow(2, adjustments.exposure / 100) : 1;
    const contrastFactor = hasContrast ? 1 + (adjustments.contrast / 200) : 1;
    const brightnessFactor = hasBrightness ? 1 + (adjustments.brightness / 200) : 1;
    const saturationFactor = hasSaturation ? adjustments.saturation / 100 : 0;
    const hueShift = adjustments.hue;
    const sepiaAmount = adjustments.sepia / 100;
    const grayscaleAmount = adjustments.grayscale / 100;

    const needsHSL = hasSaturation || hasHue;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // Apply brightness
      if (hasBrightness) {
        r *= brightnessFactor;
        g *= brightnessFactor;
        b *= brightnessFactor;
      }

      // Apply contrast
      if (hasContrast) {
        r = ((r - 128) * contrastFactor) + 128;
        g = ((g - 128) * contrastFactor) + 128;
        b = ((b - 128) * contrastFactor) + 128;
      }

      // Apply exposure
      if (hasExposure) {
        r *= exposureFactor;
        g *= exposureFactor;
        b *= exposureFactor;
      }

      // Apply saturation and hue via HSL
      if (needsHSL) {
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));

        const [h, s, l] = rgbToHsl(r, g, b);
        let newH = h;
        let newS = s;

        if (hasSaturation) {
          newS = Math.max(0, Math.min(100, s * (1 + saturationFactor)));
        }

        if (hasHue) {
          newH = (h + hueShift + 360) % 360;
        }

        [r, g, b] = hslToRgb(newH, newS, l);
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

      // Clamp final values
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }

    ctx.putImageData(imageData, 0, 0);
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

        if (ctx) {
          // Draw base image first
          ctx.drawImage(baseImg, 0, 0);

          // Apply filters via pixel manipulation (Safari-compatible)
          applyAdjustmentsToCanvas(ctx, canvas, presetAdjustments);

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
</script>

<div class="filter-tool">
  <div class="tool-header">
    <h3>{$_('editor.filter')}</h3>
    <button class="close-btn" onclick={onClose} title={$_('editor.close')}>
      <X size={20} />
    </button>
  </div>

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
</div>

<style lang="postcss">
  .filter-tool {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .tool-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .tool-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #fff;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    background: transparent;
    border: none;
    color: #999;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: #444;
    color: #fff;
  }

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
