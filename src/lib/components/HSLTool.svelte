<script lang="ts">
  import { _ } from 'tokimeki-i18n';
  import type { HSLAdjustment, HSLColorName, HSLRange } from '../types';
  import Slider from './Slider.svelte';
  import { haptic } from '../utils/haptics';

  interface Props {
    hsl: HSLAdjustment;
    onChange: (hsl: HSLAdjustment) => void;
  }

  let { hsl, onChange }: Props = $props();

  let activeColor = $state<HSLColorName>('red');

  const COLOR_MAP: { name: HSLColorName; hex: string; labelKey: string }[] = [
    { name: 'red', hex: '#FF3B30', labelKey: 'adjustments.hslRed' },
    { name: 'orange', hex: '#FF9500', labelKey: 'adjustments.hslOrange' },
    { name: 'yellow', hex: '#FFCC00', labelKey: 'adjustments.hslYellow' },
    { name: 'green', hex: '#34C759', labelKey: 'adjustments.hslGreen' },
    { name: 'aqua', hex: '#5AC8FA', labelKey: 'adjustments.hslAqua' },
    { name: 'blue', hex: '#007AFF', labelKey: 'adjustments.hslBlue' },
    { name: 'purple', hex: '#AF52DE', labelKey: 'adjustments.hslPurple' },
    { name: 'magenta', hex: '#FF2D55', labelKey: 'adjustments.hslMagenta' }
  ];

  let activeRange = $derived<HSLRange>(hsl[activeColor]);

  function selectColor(name: HSLColorName) {
    if (name === activeColor) return;
    haptic('selection');
    activeColor = name;
  }

  function handleSliderChange(property: keyof HSLRange, value: number) {
    const updatedRange: HSLRange = {
      ...hsl[activeColor],
      [property]: value
    };
    const updatedHsl: HSLAdjustment = {
      ...hsl,
      [activeColor]: updatedRange
    };
    onChange(updatedHsl);
  }
</script>

<div class="hsl-tool">
  <div class="color-selector" role="radiogroup" aria-label={$_('adjustments.hslColors')}>
    {#each COLOR_MAP as color (color.name)}
      <button
        role="radio"
        aria-checked={activeColor === color.name}
        aria-label={$_(color.labelKey)}
        class="color-dot"
        class:active={activeColor === color.name}
        style:--dot-color={color.hex}
        onclick={() => selectColor(color.name)}
      >
        <span class="dot-inner"></span>
      </button>
    {/each}
  </div>

  <div class="slider-list">
    <Slider
      label={$_('adjustments.hue')}
      value={activeRange.hue}
      min={-180}
      max={180}
      bipolar={true}
      suffix="°"
      onInput={(v) => handleSliderChange('hue', v)}
    />
    <Slider
      label={$_('adjustments.saturation')}
      value={activeRange.saturation}
      min={-100}
      max={100}
      bipolar={true}
      onInput={(v) => handleSliderChange('saturation', v)}
    />
    <Slider
      label={$_('adjustments.luminance')}
      value={activeRange.luminance}
      min={-100}
      max={100}
      bipolar={true}
      onInput={(v) => handleSliderChange('luminance', v)}
    />
  </div>
</div>

<style lang="postcss">
  .hsl-tool {
    display: flex;
    flex-direction: column;
    gap: var(--tk-space-4);
  }

  .color-selector {
    display: flex;
    justify-content: center;
    gap: var(--tk-space-3);
    padding: var(--tk-space-2) 0;
  }

  .color-dot {
    position: relative;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    border-radius: var(--tk-radius-full);
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--tk-dur-quick) var(--tk-ease-spring);
  }

  .color-dot:hover {
    transform: scale(1.1);
  }

  .color-dot:active {
    transform: scale(0.95);
  }

  .color-dot.active {
    box-shadow: 0 0 0 2px var(--tk-bg-base), 0 0 0 4px var(--dot-color);
  }

  .dot-inner {
    width: 18px;
    height: 18px;
    border-radius: var(--tk-radius-full);
    background: var(--dot-color);
    box-shadow: var(--tk-shadow-xs);
  }

  .slider-list {
    display: flex;
    flex-direction: column;
    gap: var(--tk-space-3);
  }
</style>
