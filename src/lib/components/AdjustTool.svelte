<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { AdjustmentsState } from '../types';
  import { X } from 'lucide-svelte';

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
      hue: 0,
      vignette: 0,
      sepia: 0,
      grayscale: 0
    });
  }
</script>

<div class="adjust-tool">
  <div class="tool-header">
    <h3>{$_('editor.adjust')}</h3>
    <button class="close-btn" onclick={onClose} title={$_('editor.close')}>
      <X size={20} />
    </button>
  </div>

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

    <!-- Hue -->
    <div class="adjustment-control">
      <label for="hue">
        <span>{$_('adjustments.hue')}</span>
        <span class="value">{adjustments.hue}°</span>
      </label>
      <input
        id="hue"
        type="range"
        min="-180"
        max="180"
        value={adjustments.hue}
        oninput={(e) => handleChange('hue', Number(e.currentTarget.value))}
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
  </div>

  <div class="tool-actions">
    <button class="btn btn-secondary" onclick={resetAll}>
      {$_('editor.reset')}
    </button>
  </div>
</div>

<style lang="postcss">
  .adjust-tool {
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

  .adjustments-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .adjustment-control {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .adjustment-control label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    color: #ccc;
  }

  .adjustment-control .value {
    color: #0066cc;
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
    background: #0066cc;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }

  .adjustment-control input[type='range']::-webkit-slider-thumb:hover {
    background: #0077dd;
    transform: scale(1.1);
  }

  .adjustment-control input[type='range']::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: #0066cc;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }

  .adjustment-control input[type='range']::-moz-range-thumb:hover {
    background: #0077dd;
    transform: scale(1.1);
  }

  .tool-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
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
