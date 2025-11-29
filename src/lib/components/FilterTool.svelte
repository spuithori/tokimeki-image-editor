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
          // Build CSS filter string (only basic filters)
          const filters = [];
          if (presetAdjustments.brightness !== 0) {
            filters.push(`brightness(${100 + presetAdjustments.brightness}%)`);
          }
          if (presetAdjustments.contrast !== 0) {
            filters.push(`contrast(${100 + presetAdjustments.contrast}%)`);
          }
          if (presetAdjustments.saturation !== 0) {
            filters.push(`saturate(${100 + presetAdjustments.saturation}%)`);
          }
          if (presetAdjustments.grayscale !== 0) {
            filters.push(`grayscale(${presetAdjustments.grayscale}%)`);
          }
          if (presetAdjustments.sepia !== 0) {
            filters.push(`sepia(${presetAdjustments.sepia}%)`);
          }
          if (presetAdjustments.hue !== 0) {
            filters.push(`hue-rotate(${presetAdjustments.hue}deg)`);
          }

          // Apply filters and draw
          ctx.filter = filters.length > 0 ? filters.join(' ') : 'none';
          ctx.drawImage(baseImg, 0, 0);

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
    overflow-y: auto;
    scrollbar-width: thin;
    padding-bottom: 1rem;
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
  }

  .preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
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
