<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { AdjustmentsState } from '../types';
  import ToolPanel from './ToolPanel.svelte';

  interface Props {
    adjustments: AdjustmentsState;
    onChange: (adjustments: Partial<AdjustmentsState>) => void;
    onClose: () => void;
  }

  let { adjustments, onChange, onClose }: Props = $props();

  function handleChange(key: keyof AdjustmentsState, value: number) {
    onChange({ [key]: value });
  }

  function resetAll() {
    onChange({
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
    });
  }

  // Prevent wheel events from propagating to canvas zoom handler
  function handleWheel(e: WheelEvent) {
    e.stopPropagation();
  }
</script>

<div class="adjust-tool" onwheel={handleWheel}>
  <ToolPanel title={$_('editor.adjust')} {onClose}>
    {#snippet children()}
      <div class="adjustments-grid">
    <!-- Exposure -->
    <div class="adjustment-control">
      <label for="exposure">
        <span>{$_('adjustments.exposure')}</span>
        <span class="value">{adjustments.exposure}</span>
      </label>
      <input
        id="exposure"
        type="range"
        min="-100"
        max="100"
        value={adjustments.exposure}
        oninput={(e) => handleChange('exposure', Number(e.currentTarget.value))}
      />
    </div>

    <!-- Brightness -->
    <div class="adjustment-control">
      <label for="brightness">
        <span>{$_('adjustments.brightness')}</span>
        <span class="value">{adjustments.brightness}</span>
      </label>
      <input
        id="brightness"
        type="range"
        min="-100"
        max="100"
        value={adjustments.brightness}
        oninput={(e) => handleChange('brightness', Number(e.currentTarget.value))}
      />
    </div>

    <!-- Contrast -->
    <div class="adjustment-control">
      <label for="contrast">
        <span>{$_('adjustments.contrast')}</span>
        <span class="value">{adjustments.contrast}</span>
      </label>
      <input
        id="contrast"
        type="range"
        min="-100"
        max="100"
        value={adjustments.contrast}
        oninput={(e) => handleChange('contrast', Number(e.currentTarget.value))}
      />
    </div>

    <!-- Highlights -->
    <div class="adjustment-control">
      <label for="highlights">
        <span>{$_('adjustments.highlights')}</span>
        <span class="value">{adjustments.highlights}</span>
      </label>
      <input
        id="highlights"
        type="range"
        min="-100"
        max="100"
        value={adjustments.highlights}
        oninput={(e) => handleChange('highlights', Number(e.currentTarget.value))}
      />
    </div>

    <!-- Shadows -->
    <div class="adjustment-control">
      <label for="shadows">
        <span>{$_('adjustments.shadows')}</span>
        <span class="value">{adjustments.shadows}</span>
      </label>
      <input
        id="shadows"
        type="range"
        min="-100"
        max="100"
        value={adjustments.shadows}
        oninput={(e) => handleChange('shadows', Number(e.currentTarget.value))}
      />
    </div>

    <!-- Saturation -->
    <div class="adjustment-control">
      <label for="saturation">
        <span>{$_('adjustments.saturation')}</span>
        <span class="value">{adjustments.saturation}</span>
      </label>
      <input
        id="saturation"
        type="range"
        min="-100"
        max="100"
        value={adjustments.saturation}
        oninput={(e) => handleChange('saturation', Number(e.currentTarget.value))}
      />
    </div>

    <!-- Temperature -->
    <div class="adjustment-control">
      <label for="temperature">
        <span>{$_('adjustments.temperature')}</span>
        <span class="value">{adjustments.temperature}</span>
      </label>
      <input
        id="temperature"
        type="range"
        min="-100"
        max="100"
        value={adjustments.temperature}
        oninput={(e) => handleChange('temperature', Number(e.currentTarget.value))}
      />
    </div>

    <!-- Vignette -->
    <div class="adjustment-control">
      <label for="vignette">
        <span>{$_('adjustments.vignette')}</span>
        <span class="value">{adjustments.vignette}</span>
      </label>
      <input
        id="vignette"
        type="range"
        min="-100"
        max="100"
        value={adjustments.vignette}
        oninput={(e) => handleChange('vignette', Number(e.currentTarget.value))}
      />
    </div>

    <!-- Blur -->
    <div class="adjustment-control">
      <label for="blur">
        <span>{$_('adjustments.blur')}</span>
        <span class="value">{adjustments.blur}</span>
      </label>
      <input
        id="blur"
        type="range"
        min="0"
        max="100"
        value={adjustments.blur}
        oninput={(e) => handleChange('blur', Number(e.currentTarget.value))}
      />
    </div>

    <!-- Film Grain -->
    <div class="adjustment-control">
      <label for="grain">
        <span>{$_('adjustments.grain')}</span>
        <span class="value">{adjustments.grain}</span>
      </label>
      <input
        id="grain"
        type="range"
        min="0"
        max="100"
        value={adjustments.grain}
        oninput={(e) => handleChange('grain', Number(e.currentTarget.value))}
      />
    </div>
      </div>
    {/snippet}

    {#snippet actions()}
      <button class="btn btn-secondary" onclick={resetAll}>
        {$_('editor.reset')}
      </button>
    {/snippet}
  </ToolPanel>
</div>

<style lang="postcss">
  .adjustments-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;

    @media (max-width: 767px) {
      grid-template-columns: 1fr;
      gap: 0.75rem;
      max-height: 35vh;
      overflow-y: auto;
    }
  }

  .adjustment-control {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    @media (max-width: 767px) {
      gap: 0.3rem;
    }
  }

  .adjustment-control label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    color: #ccc;

    @media (max-width: 767px) {
      font-size: 0.8rem;
    }
  }

  .adjustment-control .value {
    color: var(--primary-color, #63b97b);
    font-weight: 600;
    min-width: 3rem;
    text-align: right;
  }

  .adjustment-control input[type='range'] {
    width: 100%;
    height: 6px;
    background: #444;
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .adjustment-control input[type='range']::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--primary-color, #63b97b);
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }

  .adjustment-control input[type='range']::-webkit-slider-thumb:hover {
    background: var(--primary-color, #63b97b);
    transform: scale(1.1);
  }

  .adjustment-control input[type='range']::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--primary-color, #63b97b);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }

  .adjustment-control input[type='range']::-moz-range-thumb:hover {
    background: var(--primary-color, #63b97b);
    transform: scale(1.1);
  }

  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .btn-secondary {
    background: #666;
    color: #fff;
  }

  .btn-secondary:hover {
    background: #777;
  }
</style>
